import type {
  ConnState,
  Device,
  FileMeta,
  IncomingRequest,
  Platform,
  TransferFile,
} from '../types';
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_BLOCK_SIZE,
  ROOM_CODE_LENGTH,
  ROOM_CODE_ALPHABET,
  type SignalingEnvelope,
  type IceServerConfig,
} from '@shareapp/shared';
import { SignalingLadderClient } from '../core/signaling/index.js';
import {
  probeNetwork,
  generateEphemeralDeviceId,
  type ProbeResult,
} from '../core/discovery/index.js';
import { PeerSession, type PeerSignal, type PeerPathStats } from '../core/peer/index.js';
import { ConnectionLadderOrchestrator } from '../core/path/index.js';
import { TrustManager } from '../core/trust/index.js';
import { EncryptedServerRelayTransport } from '../core/trust/relay_transport.js';
import { FileSenderPipeline } from '../transfer/sender/index.js';
import { FileReceiverPipeline } from '../transfer/receiver/index.js';
import {
  createBlockWriter,
  checkStorageQuota,
  MemoryBlockWriter,
  type BlockWriter,
} from '../transfer/storage/index.js';
import { TransferJournal } from '../transfer/resume/journal.js';
import { BlockBitmap } from '../transfer/resume/bitmap.js';
import { haptics } from '../haptics/index.js';
import type { DetectedDeviceProfile } from '../utils/deviceDetector.js';

// ---------------------------------------------------------------------------
// Helpers and Utilities
// ---------------------------------------------------------------------------

export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* noop */
  }
}

export function supportsStreamSave(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

export function normalizeRoomCode(raw: string): string {
  let str = String(raw || '').toUpperCase();
  if (str.includes('#')) {
    str = str.split('#')[1];
  }
  str = str.replace(/^ROOM[=/]/i, '');
  const clean = str
    .replace(new RegExp(`[^${ROOM_CODE_ALPHABET}]`, 'g'), '')
    .slice(0, ROOM_CODE_LENGTH);
  return clean;
}

export function getPersistentDeviceId(): string {
  try {
    const tabId = sessionStorage.getItem('mog_tab_device_id');
    if (tabId && /^[\w-]{8,64}$/.test(tabId)) return tabId;
  } catch {}

  const id = generateEphemeralDeviceId();
  try {
    sessionStorage.setItem('mog_tab_device_id', id);
  } catch {}
  safeSet('mog_device_id', id);
  return id;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export interface NetworkCallbacks {
  onStateChange: (state: ConnState, detail?: string) => void;
  onPeersChanged: (peers: Device[]) => void;
  onRoomCreated: (code: string) => void;
  onRoomJoined: (code: string) => void;
  onRoomLeft: () => void;
  onRoomPeers: (peers: Device[]) => void;
  onRoomError: (msg: string) => void;
  onIncomingRequest: (req: IncomingRequest) => void;
  onTransferUpdate: (t: TransferFile) => void;
  onClipboardReceived: (
    fromDevice: string,
    content: string,
    timestamp: number,
    meta?: { fromId?: string; isDirect?: boolean }
  ) => void;
  onError: (msg: string) => void;
}

interface PeerConnectionBundle {
  peerSession: PeerSession;
  orchestrator: ConnectionLadderOrchestrator;
  trustManager: TrustManager;
  localPublicKey: string | null;
  hasDerivedSharedKey: boolean;
  relayTransport: EncryptedServerRelayTransport;
  pathStats?: PeerPathStats;
}

export const VIRTUAL_DEMO_PEER_ID = 'virtual_demo_peer';

export class NetworkService {
  private deviceId: string;
  private deviceName: string;
  private platform: Platform;
  private deviceProfile?: Partial<DetectedDeviceProfile>;
  private callbacks: NetworkCallbacks;
  private serverUrl: string;

  private signaling: SignalingLadderClient | null = null;
  private localBus: BroadcastChannel | null = null;
  private localBusPeers = new Map<string, { device: Device; lastSeen: number }>();
  private localBusTimer: ReturnType<typeof setInterval> | null = null;

  private state: ConnState = 'idle';
  private probeResult: ProbeResult | null = null;
  private iceServers: IceServerConfig[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  private visiblePeers = new Map<string, Device>();
  private roomPeers = new Map<string, Device>();
  private demoPeerEnabled = false;
  private currentRoomCode: string | null = null;
  private roomPassphrase: string | null = null;

  private peerBundles = new Map<string, PeerConnectionBundle>();

  private activeSenders = new Map<string, FileSenderPipeline>();
  private activeReceivers = new Map<string, FileReceiverPipeline>();
  private activeWriters = new Map<string, BlockWriter>();
  private transferFiles = new Map<string, TransferFile>();
  private transferBitmaps = new Map<string, BlockBitmap>();

  private journal: TransferJournal;
  private destroyed = false;
  private seenCtl = new Set<string>();
  private latencyMs: number | null = null;
  private lastPingSent = 0;
  private pendingRoomAction: (() => void) | null = null;

  constructor(
    deviceName: string,
    platform: Platform,
    callbacks: NetworkCallbacks,
    serverUrlOverride: string | null = null,
    deviceProfile?: Partial<DetectedDeviceProfile>
  ) {
    this.deviceId = getPersistentDeviceId();
    this.deviceName = deviceName;
    this.platform = platform;
    this.deviceProfile = deviceProfile;
    this.callbacks = callbacks;
    this.journal = new TransferJournal();

    const envUrl = (import.meta as any).env?.VITE_SERVER_URL as string | undefined;
    const storedUrl =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('mog_server_url') || undefined
        : undefined;
    this.serverUrl =
      serverUrlOverride ||
      storedUrl ||
      envUrl ||
      (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');

    this.initLocalBroadcastBus();
    void this.initialize();
  }

  public getDeviceId(): string {
    return this.deviceId;
  }

  public getActiveUrl(): string {
    return this.serverUrl;
  }

  public getLatencyMs(): number | null {
    return this.latencyMs;
  }

  public getActiveTransportRung(): string {
    return this.signaling?.getActiveRung()?.toUpperCase() || 'LOCAL';
  }

  public updateProfile(
    name: string,
    platform: Platform,
    profile?: Partial<DetectedDeviceProfile>
  ) {
    this.deviceName = name;
    this.platform = platform;
    if (profile) {
      this.deviceProfile = { ...this.deviceProfile, ...profile };
    }
    if (this.signaling && this.state === 'ready') {
      this.signaling.send('update-profile', {
        name: this.deviceName,
        platform: this.platform,
        model: this.deviceProfile?.model,
        os: this.deviceProfile?.os,
        browser: this.deviceProfile?.browser,
        deviceType: this.deviceProfile?.deviceType,
        batteryLevel: this.deviceProfile?.batteryLevel,
        isCharging: this.deviceProfile?.isCharging,
      });
    }
    this.broadcastLocalBusPresence();
  }

  public setCustomServerUrl(url: string | null) {
    this.serverUrl =
      url || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');
    safeSet('mog_server_url', url || '');
    void this.initialize();
  }

  public rescan() {
    if (this.signaling && this.state === 'ready') {
      this.lastPingSent = Date.now();
      this.signaling.send('rescan', {});
      this.signaling.send('ping', { clientTime: this.lastPingSent });
    } else if (this.state !== 'connecting') {
      void this.initialize();
    }
    this.broadcastLocalBusPresence(true);
    this.emitVisiblePeers();
  }

  public setDemoPeerEnabled(enabled: boolean) {
    this.demoPeerEnabled = enabled;
    this.emitVisiblePeers();
  }

  public isDemoPeerEnabled(): boolean {
    return this.demoPeerEnabled;
  }

  private emitVisiblePeers() {
    const merged = new Map<string, Device>();
    for (const [id, p] of this.visiblePeers) {
      if (id !== this.deviceId) merged.set(id, p);
    }
    for (const [id, entry] of this.localBusPeers) {
      if (id !== this.deviceId && !merged.has(id)) {
        merged.set(id, entry.device);
      }
    }
    if (this.demoPeerEnabled) {
      merged.set(VIRTUAL_DEMO_PEER_ID, {
        id: VIRTUAL_DEMO_PEER_ID,
        name: 'Galaxy S25 Ultra (Demo Peer)',
        platform: 'android',
        model: 'Samsung Galaxy S25 Ultra',
        os: 'Android 15',
        browser: 'Chrome',
        deviceType: 'phone',
        batteryLevel: 92,
        isCharging: true,
        isSimulated: true,
        status: 'online',
        connType: 'Direct Loopback (0.4ms)',
        rttMs: 1,
      });
    }
    this.callbacks.onPeersChanged(Array.from(merged.values()));
  }

  // -------------------------------------------------------------------------
  // Same-Browser Multi-Tab BroadcastChannel Bus (Zero-Latency Local Discovery)
  // -------------------------------------------------------------------------
  private initLocalBroadcastBus() {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.localBus = new BroadcastChannel('mog_share_local_bus_v3');
      this.localBus.onmessage = (ev) => {
        const msg = ev.data;
        if (!msg || typeof msg !== 'object' || msg.from === this.deviceId) return;
        if (msg.to && msg.to !== this.deviceId) return;

        switch (msg.kind) {
          case 'presence': {
            const dev: Device = {
              id: msg.from,
              name: msg.name || 'Local Tab Peer',
              platform: msg.platform || 'web',
              model: msg.model,
              os: msg.os,
              browser: msg.browser,
              deviceType: msg.deviceType,
              batteryLevel: msg.batteryLevel,
              isCharging: msg.isCharging,
              status: 'online',
              connType: 'Direct (same device)',
              rttMs: 1,
            };
            const isNew = !this.localBusPeers.has(msg.from) && !this.visiblePeers.has(msg.from);
            this.localBusPeers.set(msg.from, { device: dev, lastSeen: Date.now() });
            if (isNew) haptics.play('deviceFound');
            this.emitVisiblePeers();
            if (msg.replyRequested) {
              this.broadcastLocalBusPresence(false);
            }
            break;
          }
          case 'bye': {
            this.localBusPeers.delete(msg.from);
            this.emitVisiblePeers();
            break;
          }
          case 'signal': {
            const bundle = this.getOrCreatePeerBundle(msg.from);
            if (msg.signal) {
              void bundle.peerSession.handleSignal(msg.signal as PeerSignal);
            }
            if (msg.ctl) {
              this.handleCtlMessage(msg.from, msg.ctl);
            }
            break;
          }
          case 'relay-frame': {
            const bundle = this.getOrCreatePeerBundle(msg.from);
            if (msg.encrypted) {
              void bundle.relayTransport.handleIncomingRelayFrame(msg.data as string);
            } else if (typeof msg.data === 'string') {
              this.handleDataFrame(base64ToUint8(msg.data));
            }
            break;
          }
          case 'clipboard': {
            this.callbacks.onClipboardReceived(
              msg.fromName || 'Local Tab',
              msg.content || '',
              msg.timestamp || Date.now(),
              { fromId: msg.from, isDirect: Boolean(msg.to) }
            );
            break;
          }
        }
      };

      this.broadcastLocalBusPresence(true);
      this.localBusTimer = setInterval(() => {
        this.broadcastLocalBusPresence(false);
        const now = Date.now();
        let changed = false;
        for (const [id, entry] of this.localBusPeers) {
          if (now - entry.lastSeen > 12_000) {
            this.localBusPeers.delete(id);
            changed = true;
          }
        }
        if (changed) this.emitVisiblePeers();
      }, 4000);

      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', () => {
          try {
            this.localBus?.postMessage({ kind: 'bye', from: this.deviceId });
          } catch {}
        });
      }
    } catch {
      /* BroadcastChannel unavailable */
    }
  }

  private broadcastLocalBusPresence(replyRequested = false) {
    if (!this.localBus) return;
    try {
      this.localBus.postMessage({
        kind: 'presence',
        from: this.deviceId,
        name: this.deviceName,
        platform: this.platform,
        model: this.deviceProfile?.model,
        os: this.deviceProfile?.os,
        browser: this.deviceProfile?.browser,
        deviceType: this.deviceProfile?.deviceType,
        batteryLevel: this.deviceProfile?.batteryLevel,
        isCharging: this.deviceProfile?.isCharging,
        replyRequested,
      });
    } catch {}
  }

  // -------------------------------------------------------------------------
  // Signaling Initialization
  // -------------------------------------------------------------------------
  private async initialize() {
    this.setState('connecting', 'Probing network identity (dual-stack v4/v6)...');

    try {
      await this.fetchTurnCredentials();

      this.probeResult = await probeNetwork(this.serverUrl, this.iceServers);

      if (this.probeResult.warnings.message) {
        this.callbacks.onError(this.probeResult.warnings.message);
      }

      if (this.signaling) {
        this.signaling.destroy();
      }

      this.signaling = new SignalingLadderClient(this.deviceId, this.serverUrl, {
        onMessage: (envelope) => this.handleSignalingEnvelope(envelope),
        onStateChange: (state, rung) => {
          if (state === 'connected') {
            this.sendJoinMessage();
            if (this.currentRoomCode) {
              this.signaling?.send('join-room', {
                roomCode: this.currentRoomCode,
                password: this.roomPassphrase || undefined,
              });
            }
            this.setState('ready', `Connected via ${rung.toUpperCase()} transport`);
            if (this.pendingRoomAction) {
              const act = this.pendingRoomAction;
              this.pendingRoomAction = null;
              act();
            }
          } else if (state === 'connecting') {
            this.setState('connecting', `Connecting via ${rung.toUpperCase()} ladder...`);
          } else {
            this.setState('reconnecting', 'Signaling dropped, reconnecting ladder...');
          }
        },
        onError: (err) => {
          this.callbacks.onError(err.message);
        },
      });

      await this.signaling.connect();
    } catch (err: unknown) {
      this.setState('error', (err as Error).message);
    }
  }

  private async fetchTurnCredentials() {
    try {
      const res = await fetch(`${this.serverUrl}/api/turn-credentials`);
      if (res.ok) {
        const data = await res.json();
        if (data.iceServers && Array.isArray(data.iceServers)) {
          const base = this.iceServers.filter((s) => !(s as { username?: string }).username);
          this.iceServers = [...base, ...data.iceServers];
        }
      }
    } catch {
      // Fallback to STUN defaults
    }
  }

  private sendJoinMessage() {
    if (!this.signaling || !this.probeResult) return;
    this.signaling.send('join', {
      name: this.deviceName,
      platform: this.platform,
      model: this.deviceProfile?.model,
      os: this.deviceProfile?.os,
      browser: this.deviceProfile?.browser,
      deviceType: this.deviceProfile?.deviceType,
      batteryLevel: this.deviceProfile?.batteryLevel,
      isCharging: this.deviceProfile?.isCharging,
      networkKeys: this.probeResult.networkKeys,
      resumeToken: this.signaling.getResumeToken(),
    });
    this.lastPingSent = Date.now();
    this.signaling.send('ping', { clientTime: this.lastPingSent });
  }

  private mapRawPeerToDevice(
    p: {
      id: string;
      name?: string;
      platform?: Platform;
      model?: string;
      os?: string;
      browser?: string;
      deviceType?: string;
      batteryLevel?: number;
      isCharging?: boolean;
    },
    connType = 'Direct (same network)'
  ): Device {
    const existing = this.visiblePeers.get(p.id) || this.roomPeers.get(p.id);
    return {
      id: p.id,
      name: p.name || existing?.name || `Device (${p.id.slice(0, 4)})`,
      platform: p.platform || existing?.platform || 'web',
      model: p.model ?? existing?.model,
      os: p.os ?? existing?.os,
      browser: p.browser ?? existing?.browser,
      deviceType: p.deviceType ?? existing?.deviceType,
      batteryLevel: p.batteryLevel ?? existing?.batteryLevel,
      isCharging: p.isCharging ?? existing?.isCharging,
      status: 'online',
      connType: existing?.connType || connType,
      rttMs: existing?.rttMs,
      availableBitrateBps: existing?.availableBitrateBps,
    };
  }

  private handleSignalingEnvelope(envelope: SignalingEnvelope) {
    const { type, payload, from } = envelope;

    switch (type) {
      case 'pong': {
        const clientTime = payload?.clientTime as number | undefined;
        if (typeof clientTime === 'number' && clientTime > 0) {
          this.latencyMs = Math.max(1, Date.now() - clientTime);
        } else if (this.lastPingSent > 0) {
          this.latencyMs = Math.max(1, Date.now() - this.lastPingSent);
        }
        break;
      }

      case 'error': {
        const msg = (payload?.message as string) || (payload?.error as string) || 'Server error';
        this.callbacks.onError(msg);
        break;
      }

      case 'group-presence': {
        const peers =
          (payload.peers as Array<{
            id: string;
            name: string;
            platform: Platform;
            model?: string;
            os?: string;
            browser?: string;
            deviceType?: string;
            batteryLevel?: number;
            isCharging?: boolean;
          }>) || [];
        this.visiblePeers.clear();
        for (const p of peers) {
          if (p.id !== this.deviceId) {
            this.visiblePeers.set(p.id, this.mapRawPeerToDevice(p, 'Direct (same network)'));
          }
        }
        this.emitVisiblePeers();
        break;
      }

      case 'peer-discovered': {
        const p = payload as {
          id: string;
          name: string;
          platform: Platform;
          model?: string;
          os?: string;
          browser?: string;
          deviceType?: string;
          batteryLevel?: number;
          isCharging?: boolean;
        };
        if (p.id && p.id !== this.deviceId) {
          const isNew = !this.visiblePeers.has(p.id);
          this.visiblePeers.set(p.id, this.mapRawPeerToDevice(p, 'Direct (same network)'));
          if (isNew) haptics.play('deviceFound');
          this.emitVisiblePeers();
        }
        break;
      }

      case 'peer-left': {
        const pId = payload.deviceId as string;
        if (pId) {
          this.visiblePeers.delete(pId);
          this.emitVisiblePeers();
        }
        break;
      }

      case 'room-created': {
        const code = payload.roomCode as string;
        this.currentRoomCode = code;
        this.callbacks.onRoomCreated(code);
        break;
      }

      case 'room-joined': {
        const code = payload.roomCode as string;
        this.currentRoomCode = code;
        const peers =
          (payload.peers as Array<{
            id: string;
            name?: string;
            platform?: Platform;
            model?: string;
            os?: string;
            browser?: string;
            deviceType?: string;
            batteryLevel?: number;
            isCharging?: boolean;
          }>) || [];
        for (const p of peers) {
          if (p.id !== this.deviceId) {
            this.roomPeers.set(p.id, this.mapRawPeerToDevice(p, 'Direct (internet)'));
          }
        }
        this.callbacks.onRoomJoined(code);
        this.callbacks.onRoomPeers(Array.from(this.roomPeers.values()));
        break;
      }

      case 'room-join-failed': {
        this.callbacks.onRoomError((payload.error as string) || 'Failed to join room');
        break;
      }

      case 'peer-left-room': {
        const pId = payload.peerId as string;
        if (pId) {
          this.roomPeers.delete(pId);
          this.callbacks.onRoomPeers(Array.from(this.roomPeers.values()));
        }
        break;
      }

      case 'room-left': {
        this.currentRoomCode = null;
        this.roomPeers.clear();
        this.callbacks.onRoomLeft();
        break;
      }

      case 'clipboard-received': {
        const fromName = (payload.fromDevice as string) || 'Device';
        const content = (payload.content as string) || '';
        const ts = (payload.timestamp as number) || Date.now();
        this.callbacks.onClipboardReceived(fromName, content, ts, {
          fromId: payload.fromId as string | undefined,
          isDirect: Boolean(payload.isDirect),
        });
        break;
      }

      case 'peer-joined-room': {
        const pId = (payload.peerId as string) || (payload.id as string);
        if (pId && pId !== this.deviceId) {
          this.roomPeers.set(
            pId,
            this.mapRawPeerToDevice(
              {
                id: pId,
                name: payload.name as string | undefined,
                platform: (payload.platform as Platform) || 'web',
                model: payload.model as string | undefined,
                os: payload.os as string | undefined,
                browser: payload.browser as string | undefined,
                deviceType: payload.deviceType as string | undefined,
                batteryLevel: payload.batteryLevel as number | undefined,
                isCharging: payload.isCharging as boolean | undefined,
              },
              'Direct (internet)'
            )
          );
          this.callbacks.onRoomPeers(Array.from(this.roomPeers.values()));
        }
        break;
      }

      case 'signal': {
        if (!from) return;
        const bundle = this.getOrCreatePeerBundle(from);
        if (payload.signal) {
          void bundle.peerSession.handleSignal(payload.signal as PeerSignal);
        }
        if (payload.ctl) {
          this.handleCtlMessage(from, payload.ctl);
        }
        break;
      }

      case 'relay-frame': {
        if (!from) return;
        const bundle = this.getOrCreatePeerBundle(from);
        if (payload.raw === true && typeof payload.data === 'string') {
          this.handleDataFrame(base64ToUint8(payload.data));
        } else if (typeof payload.data === 'string') {
          void bundle.relayTransport
            .handleIncomingRelayFrame(payload.data)
            .catch(() => {
              // Fallback if frame was unencrypted base64
              try {
                this.handleDataFrame(base64ToUint8(payload.data as string));
              } catch {}
            });
        }
        break;
      }

      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // WebRTC & Peer Session Management
  // -------------------------------------------------------------------------
  private getOrCreatePeerBundle(remoteDeviceId: string): PeerConnectionBundle {
    let bundle = this.peerBundles.get(remoteDeviceId);
    if (bundle) return bundle;

    const trustManager = new TrustManager();
    const orchestrator = new ConnectionLadderOrchestrator({
      onStatusChange: () => {},
      onPathBadgeChange: (badge) => {
        const peer =
          this.visiblePeers.get(remoteDeviceId) ||
          this.roomPeers.get(remoteDeviceId) ||
          this.localBusPeers.get(remoteDeviceId)?.device;
        if (peer) {
          peer.connType = badge.toLowerCase().includes('direct') ? 'direct' : 'relay';
          this.emitVisiblePeers();
          if (this.roomPeers.has(remoteDeviceId)) {
            this.callbacks.onRoomPeers(Array.from(this.roomPeers.values()));
          }
        }
      },
      onStats: (stats) => {
        const peer =
          this.visiblePeers.get(remoteDeviceId) ||
          this.roomPeers.get(remoteDeviceId) ||
          this.localBusPeers.get(remoteDeviceId)?.device;
        if (peer) {
          peer.rttMs = stats.rttMs;
          peer.availableBitrateBps = stats.availableBitrateBps;
          this.emitVisiblePeers();
        }
      },
    });

    const peerSession = new PeerSession({
      localDeviceId: this.deviceId,
      remoteDeviceId,
      iceServers: this.iceServers as RTCIceServer[],
      onSignal: (signal) => {
        this.signaling?.send('signal', { signal }, remoteDeviceId);
        try {
          this.localBus?.postMessage({
            kind: 'signal',
            from: this.deviceId,
            to: remoteDeviceId,
            signal,
          });
        } catch {}
      },
      onCtlMessage: (data) => {
        let parsed = data;
        if (typeof data === 'string') {
          try {
            parsed = JSON.parse(data);
          } catch {}
        }
        this.handleCtlMessage(remoteDeviceId, parsed);
      },
      onDataFrame: (frame) => {
        this.handleDataFrame(frame);
      },
      onPathStats: (stats) => {
        orchestrator.handlePathStats(stats);
      },
      onConnectionChange: (connState) => {
        orchestrator.handlePeerConnectionState(connState);
      },
    });

    orchestrator.attachPeerSession(peerSession);

    const relayTransport = new EncryptedServerRelayTransport(trustManager, (ciphertextB64) => {
      this.signaling?.send('relay-frame', { data: ciphertextB64 }, remoteDeviceId);
      try {
        this.localBus?.postMessage({
          kind: 'relay-frame',
          from: this.deviceId,
          to: remoteDeviceId,
          encrypted: true,
          data: ciphertextB64,
        });
      } catch {}
    });

    relayTransport.onFrame((frame) => {
      this.handleDataFrame(frame);
    });

    bundle = {
      peerSession,
      orchestrator,
      trustManager,
      localPublicKey: null,
      hasDerivedSharedKey: false,
      relayTransport,
    };

    trustManager
      .init()
      .then((pub) => {
        bundle!.localPublicKey = pub;
      })
      .catch(() => undefined);

    this.peerBundles.set(remoteDeviceId, bundle);
    return bundle;
  }

  /**
   * Sends a control message reliably with deduplication id.
   * Uses the WebRTC ctl channel if already open; otherwise sends immediately via signaling + localBus.
   */
  private sendCtlReliable(remoteDeviceId: string, msg: Record<string, any>) {
    const envelopeWithId = {
      ...msg,
      _msgId: msg._msgId || `${this.deviceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    const bundle = this.getOrCreatePeerBundle(remoteDeviceId);
    if (bundle.peerSession.ctl.readyState === 'open') {
      bundle.peerSession.sendCtl(envelopeWithId);
    } else {
      this.signaling?.send('signal', { ctl: envelopeWithId }, remoteDeviceId);
      try {
        this.localBus?.postMessage({
          kind: 'signal',
          from: this.deviceId,
          to: remoteDeviceId,
          ctl: envelopeWithId,
        });
      } catch {}
    }
  }

  private async sendDataFrameHybrid(
    remoteDeviceId: string,
    bundle: PeerConnectionBundle,
    frame: Uint8Array,
    transfer: TransferFile
  ): Promise<void> {
    const ps = bundle.peerSession;

    // 1. Fast path: WebRTC DataChannel already open
    if (ps.data.readyState === 'open') {
      transfer.channel = 'direct';
      ps.sendData(frame);
      return;
    }

    // 2. Wait briefly (up to 3.5s) on first block for WebRTC DataChannel to open
    if (transfer.channel !== 'relay') {
      const opened = await ps.whenDataOpen(3500);
      if (opened && ps.data.readyState === 'open') {
        transfer.channel = 'direct';
        ps.sendData(frame);
        return;
      }
      // Switch to high-speed relay fallback automatically so transfer never fails!
      transfer.channel = 'relay';
    }

    // 3. Relay fallback (E2E encrypted if ECDH key derived, or raw base64 on non-secure LAN)
    if (bundle.hasDerivedSharedKey) {
      await bundle.relayTransport.send(frame);
    } else {
      const b64 = uint8ToBase64(frame);
      this.signaling?.send('relay-frame', { data: b64, raw: true }, remoteDeviceId);
      try {
        this.localBus?.postMessage({
          kind: 'relay-frame',
          from: this.deviceId,
          to: remoteDeviceId,
          encrypted: false,
          data: b64,
        });
      } catch {}
    }
  }

  // -------------------------------------------------------------------------
  // Control Protocol Dispatch (ctl channel)
  // -------------------------------------------------------------------------
  private handleCtlMessage(remoteDeviceId: string, data: any) {
    if (!data || typeof data !== 'object') return;
    const { type, payload, _msgId } = data;

    // Deduplicate all control messages
    const dedupKey =
      _msgId ||
      (type === 'request-transfer' || type === 'accept-transfer' || type === 'decline-transfer'
        ? `${type}:${payload?.transferId}`
        : null);
    if (dedupKey) {
      if (this.seenCtl.has(dedupKey)) return;
      this.seenCtl.add(dedupKey);
      if (this.seenCtl.size > 2000) {
        const first = this.seenCtl.values().next().value;
        if (first) this.seenCtl.delete(first);
      }
    }

    switch (type) {
      case 'request-transfer': {
        const bundle = this.getOrCreatePeerBundle(remoteDeviceId);
        if (payload.senderPubKey) {
          bundle.trustManager
            .deriveSharedKey(payload.senderPubKey as string)
            .then(() => {
              bundle.hasDerivedSharedKey = true;
            })
            .catch(() => undefined);
        }

        const req: IncomingRequest = {
          id: payload.transferId,
          transferId: payload.transferId,
          fromId: remoteDeviceId,
          fromName: (payload.senderName as string) || 'Nearby Peer',
          fromPlatform: (payload.senderPlatform as Platform) || 'web',
          fromModel: payload.senderModel as string | undefined,
          meta: payload.meta as FileMeta,
          sasNumeric: payload.sasNumeric,
          sasEmoji: payload.sasEmoji,
          isTrusted: payload.isTrusted,
          senderPubKey: payload.senderPubKey,
          receivedAt: Date.now(),
        };

        haptics.play('incomingRequest');
        this.callbacks.onIncomingRequest(req);
        break;
      }

      case 'accept-transfer': {
        const transferId = payload.transferId as string;
        const bundle = this.getOrCreatePeerBundle(remoteDeviceId);
        if (payload.receiverPubKey) {
          bundle.trustManager
            .deriveSharedKey(payload.receiverPubKey as string)
            .then(() => {
              bundle.hasDerivedSharedKey = true;
            })
            .catch(() => undefined);
        }
        const sender = this.activeSenders.get(transferId);
        if (sender) {
          const t = this.transferFiles.get(transferId);
          if (t) {
            t.status = 'transferring';
            this.callbacks.onTransferUpdate({ ...t });
          }
          void sender.start();
        }
        break;
      }

      case 'decline-transfer': {
        const transferId = payload.transferId as string;
        const t = this.transferFiles.get(transferId);
        if (t) {
          t.status = 'declined';
          this.callbacks.onTransferUpdate({ ...t });
        }
        this.activeSenders.delete(transferId);
        break;
      }

      case 'block-end': {
        const receiver = this.activeReceivers.get(payload.transferId);
        if (receiver) {
          receiver.handleBlockEnd(payload);
        }
        break;
      }

      case 'block-ack': {
        const sender = this.activeSenders.get(payload.transferId);
        if (sender) {
          sender.handleBlockAck(payload.blockIndex, payload.verified);
        }
        break;
      }

      case 'credit-grant': {
        const sender = this.activeSenders.get(payload.transferId);
        if (sender) {
          sender.grantCredits(payload.credits);
        }
        break;
      }

      case 'block-retry': {
        const sender = this.activeSenders.get(payload.transferId);
        if (sender && typeof payload.blockIndex === 'number') {
          sender.retryBlock(payload.blockIndex);
        }
        break;
      }

      case 'cancel-transfer': {
        const transferId = payload.transferId as string;
        this.cancelTransfer(transferId, false);
        break;
      }

      case 'clipboard': {
        const senderPeer =
          this.visiblePeers.get(remoteDeviceId) ||
          this.roomPeers.get(remoteDeviceId) ||
          this.localBusPeers.get(remoteDeviceId)?.device;
        this.callbacks.onClipboardReceived(
          senderPeer?.name || (payload.senderName as string) || 'Device',
          payload.content as string,
          (payload.timestamp as number) || Date.now(),
          { fromId: remoteDeviceId, isDirect: Boolean(payload.isDirect) }
        );
        break;
      }

      default:
        break;
    }
  }

  private handleDataFrame(rawFrame: Uint8Array) {
    for (const receiver of this.activeReceivers.values()) {
      receiver.handleDataFrame(rawFrame);
    }
  }

  // -------------------------------------------------------------------------
  // Public Transfer APIs
  // -------------------------------------------------------------------------
  public async sendFile(peer: Device, file: File): Promise<void> {
    if (peer.id === VIRTUAL_DEMO_PEER_ID || peer.isSimulated) {
      await this.sendFileToDemoPeer(peer, file);
      return;
    }

    const transferId = `xfer_${Math.random().toString(36).slice(2, 10)}`;
    const bundle = this.getOrCreatePeerBundle(peer.id);

    if (!bundle.localPublicKey) {
      try {
        bundle.localPublicKey = await bundle.trustManager.init();
      } catch {
        /* non-secure context */
      }
    }

    let sas: { sasNumeric: string; sasEmoji: string; isTrusted: boolean } = {
      sasNumeric: '',
      sasEmoji: '',
      isTrusted: false,
    };
    try {
      sas = await bundle.trustManager.computeVerificationSAS(
        '00:11:22:33',
        '44:55:66:77',
        bundle.localPublicKey || 'pubA',
        'pubB'
      );
    } catch {}

    let blobUrl: string | undefined;
    try {
      blobUrl = URL.createObjectURL(file);
    } catch {}

    const transfer: TransferFile = {
      id: transferId,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      fileBlob: file,
      blobUrl,
      progress: 0,
      speedBytesPerSec: 0,
      speed: 0,
      etaSeconds: 0,
      direction: 'sending',
      status: 'waiting',
      bytesTransferred: 0,
      peerId: peer.id,
      peerName: peer.name,
      channel: 'direct',
      createdAt: Date.now(),
    };
    this.transferFiles.set(transferId, transfer);
    this.callbacks.onTransferUpdate({ ...transfer });

    const updateSenderMetrics = (bytes: number, totalBytes: number, speedBps: number) => {
      transfer.bytesTransferred = bytes;
      transfer.progress = totalBytes > 0 ? Math.min(99, Math.round((bytes / totalBytes) * 100)) : 100;
      if (speedBps > 0) {
        transfer.speedBytesPerSec =
          transfer.speedBytesPerSec > 0
            ? transfer.speedBytesPerSec * 0.6 + speedBps * 0.4
            : speedBps;
        transfer.speed = transfer.speedBytesPerSec;
        const remaining = Math.max(0, totalBytes - bytes);
        transfer.etaSeconds = remaining / transfer.speedBytesPerSec;
      }
      transfer.status = 'transferring';
      this.callbacks.onTransferUpdate({ ...transfer });
    };

    const senderPipeline = new FileSenderPipeline(
      file,
      transferId,
      0,
      {
        sendDataChannel: async (frame) => {
          await this.sendDataFrameHybrid(peer.id, bundle, frame, transfer);
        },
        sendCtlMessage: (msg) => {
          this.sendCtlReliable(peer.id, msg as Record<string, any>);
        },
        getBufferedAmount: () => bundle.peerSession.getBufferedAmount(),
        waitForBufferedAmountLow: () => bundle.peerSession.waitForBufferedAmountLow(),
        onChunkProgress: (sentBytes, totalBytes, speedBps) => {
          updateSenderMetrics(sentBytes, totalBytes, speedBps);
        },
        onAckedProgress: (acknowledgedBytes, totalBytes, speedBps) => {
          updateSenderMetrics(acknowledgedBytes, totalBytes, speedBps);
        },
        onBlockCompleted: () => {},
        onFileCompleted: () => {
          transfer.status = 'completed';
          transfer.progress = 100;
          transfer.bytesTransferred = file.size;
          transfer.speedBytesPerSec = 0;
          transfer.etaSeconds = 0;
          this.callbacks.onTransferUpdate({ ...transfer });
          haptics.play('complete');
          this.activeSenders.delete(transferId);
        },
        onError: (err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
          this.callbacks.onTransferUpdate({ ...transfer });
          haptics.play('error');
          this.activeSenders.delete(transferId);
        },
      },
      { chunkSize: DEFAULT_CHUNK_SIZE, blockSize: DEFAULT_BLOCK_SIZE }
    );

    this.activeSenders.set(transferId, senderPipeline);

    const reqPayload = {
      type: 'request-transfer',
      payload: {
        transferId,
        senderName: this.deviceName,
        senderPlatform: this.platform,
        senderModel: this.deviceProfile?.model,
        senderPubKey: bundle.localPublicKey,
        meta: {
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          lastModified: file.lastModified,
        },
        sasNumeric: sas.sasNumeric,
        sasEmoji: sas.sasEmoji,
        isTrusted: sas.isTrusted,
      },
    };
    this.sendCtlReliable(peer.id, reqPayload);
  }

  /**
   * Executes a real loopback transfer pipeline with the simulated Demo Peer so users can
   * test sending and receiving files on a single machine with 1 click.
   */
  private async sendFileToDemoPeer(peer: Device, file: File): Promise<void> {
    const transferId = `demo_${Math.random().toString(36).slice(2, 10)}`;
    let blobUrl: string | undefined;
    try {
      blobUrl = URL.createObjectURL(file);
    } catch {}

    const transfer: TransferFile = {
      id: transferId,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      fileBlob: file,
      blobUrl,
      progress: 0,
      speedBytesPerSec: 0,
      etaSeconds: 0,
      direction: 'sending',
      status: 'transferring',
      bytesTransferred: 0,
      peerId: peer.id,
      peerName: peer.name,
      channel: 'direct',
      createdAt: Date.now(),
    };
    this.transferFiles.set(transferId, transfer);
    this.callbacks.onTransferUpdate({ ...transfer });

    const writer = new MemoryBlockWriter(file.type || 'application/octet-stream');
    let demoReceiver: FileReceiverPipeline;

    const senderPipeline = new FileSenderPipeline(
      file,
      transferId,
      0,
      {
        sendDataChannel: async (frame) => {
          await new Promise((r) => setTimeout(r, 4));
          demoReceiver.handleDataFrame(frame);
        },
        sendCtlMessage: (msg: any) => {
          if (msg.type === 'block-end') {
            demoReceiver.handleBlockEnd(msg.payload);
          }
        },
        getBufferedAmount: () => 0,
        waitForBufferedAmountLow: async () => {},
        onChunkProgress: (sentBytes, totalBytes, speedBps) => {
          transfer.bytesTransferred = sentBytes;
          transfer.progress = totalBytes > 0 ? Math.min(99, Math.round((sentBytes / totalBytes) * 100)) : 100;
          transfer.speedBytesPerSec = speedBps;
          transfer.etaSeconds = speedBps > 0 ? Math.max(0, (totalBytes - sentBytes) / speedBps) : 0;
          this.callbacks.onTransferUpdate({ ...transfer });
        },
        onAckedProgress: (acked, totalBytes, speedBps) => {
          transfer.bytesTransferred = acked;
          transfer.progress = totalBytes > 0 ? Math.min(99, Math.round((acked / totalBytes) * 100)) : 100;
          if (speedBps > 0) transfer.speedBytesPerSec = speedBps;
          this.callbacks.onTransferUpdate({ ...transfer });
        },
        onBlockCompleted: () => {},
        onFileCompleted: () => {
          transfer.status = 'completed';
          transfer.progress = 100;
          transfer.bytesTransferred = file.size;
          transfer.speedBytesPerSec = 0;
          transfer.etaSeconds = 0;
          this.callbacks.onTransferUpdate({ ...transfer });
          haptics.play('complete');
          this.activeSenders.delete(transferId);
        },
        onError: (err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
          this.callbacks.onTransferUpdate({ ...transfer });
          this.activeSenders.delete(transferId);
        },
      },
      { chunkSize: DEFAULT_CHUNK_SIZE, blockSize: DEFAULT_BLOCK_SIZE }
    );

    demoReceiver = new FileReceiverPipeline(
      transferId,
      file.size,
      writer,
      {
        sendCtlMessage: (msg: any) => {
          if (msg.type === 'block-ack') {
            senderPipeline.handleBlockAck(msg.payload.blockIndex, msg.payload.verified);
          } else if (msg.type === 'credit-grant') {
            senderPipeline.grantCredits(msg.payload.credits);
          }
        },
        onProgress: () => {},
        onBlockVerified: () => {},
        onFileComplete: () => {},
        onError: () => {},
      },
      DEFAULT_BLOCK_SIZE
    );

    this.activeSenders.set(transferId, senderPipeline);
    await senderPipeline.start();
  }

  /**
   * Simulates receiving a sample file from the Demo Peer so the user can test
   * the incoming file prompt, receive pipeline, and Personal Space Vault.
   */
  public async simulateIncomingSampleFile(): Promise<void> {
    const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="50%" stop-color="#1e1b4b"/>
          <stop offset="100%" stop-color="#06b6d4"/>
        </linearGradient>
      </defs>
      <rect width="800" height="500" rx="28" fill="url(#bg)"/>
      <circle cx="650" cy="120" r="140" fill="#38bdf8" opacity="0.18"/>
      <circle cx="160" cy="390" r="180" fill="#818cf8" opacity="0.22"/>
      <text x="60" y="210" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="48" font-weight="800">MogShare P2P Verified</text>
      <text x="60" y="265" fill="#bae6fd" font-family="monospace" font-size="22">SHA-256 Block Integrity · WebRTC DataChannel</text>
      <text x="60" y="320" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="18">Received from Galaxy S25 Ultra (Demo Peer) at ${new Date().toLocaleTimeString()}</text>
    </svg>`;
    const blob = new Blob([sampleSvg], { type: 'image/svg+xml' });
    const file = new File([blob], `MogShare-Demo-Poster-${Date.now().toString().slice(-4)}.svg`, {
      type: 'image/svg+xml',
    });
    const transferId = `demo_in_${Math.random().toString(36).slice(2, 10)}`;

    const writer = new MemoryBlockWriter(file.type);
    const receiveTransfer: TransferFile = {
      id: transferId,
      name: file.name,
      size: file.size,
      type: file.type,
      progress: 0,
      speedBytesPerSec: 0,
      etaSeconds: 0,
      direction: 'receiving',
      status: 'transferring',
      bytesTransferred: 0,
      peerId: VIRTUAL_DEMO_PEER_ID,
      peerName: 'Galaxy S25 Ultra (Demo Peer)',
      channel: 'direct',
      createdAt: Date.now(),
    };
    this.transferFiles.set(transferId, receiveTransfer);
    this.callbacks.onTransferUpdate({ ...receiveTransfer });

    let receiverPipeline: FileReceiverPipeline;
    const senderPipeline = new FileSenderPipeline(
      file,
      transferId,
      0,
      {
        sendDataChannel: async (frame) => {
          await new Promise((r) => setTimeout(r, 15));
          receiverPipeline.handleDataFrame(frame);
        },
        sendCtlMessage: (msg: any) => {
          if (msg.type === 'block-end') {
            receiverPipeline.handleBlockEnd(msg.payload);
          }
        },
        getBufferedAmount: () => 0,
        waitForBufferedAmountLow: async () => {},
        onAckedProgress: () => {},
        onBlockCompleted: () => {},
        onFileCompleted: () => {},
        onError: () => {},
      },
      { chunkSize: 1024, blockSize: 4096 }
    );

    const startTime = Date.now();
    receiverPipeline = new FileReceiverPipeline(
      transferId,
      file.size,
      writer,
      {
        sendCtlMessage: (msg: any) => {
          if (msg.type === 'block-ack') {
            senderPipeline.handleBlockAck(msg.payload.blockIndex, msg.payload.verified);
          } else if (msg.type === 'credit-grant') {
            senderPipeline.grantCredits(msg.payload.credits);
          }
        },
        onProgress: (verifiedBytes, totalBytes) => {
          const elapsed = Math.max(0.05, (Date.now() - startTime) / 1000);
          receiveTransfer.bytesTransferred = verifiedBytes;
          receiveTransfer.progress = Math.min(99, Math.round((verifiedBytes / totalBytes) * 100));
          receiveTransfer.speedBytesPerSec = verifiedBytes / elapsed;
          receiveTransfer.etaSeconds = 0;
          this.callbacks.onTransferUpdate({ ...receiveTransfer });
        },
        onBlockVerified: () => {},
        onFileComplete: (output) => {
          receiveTransfer.status = 'completed';
          receiveTransfer.progress = 100;
          receiveTransfer.bytesTransferred = file.size;
          receiveTransfer.speedBytesPerSec = 0;
          if (output) {
            receiveTransfer.fileBlob = output;
            receiveTransfer.blobUrl = URL.createObjectURL(output);
          }
          this.callbacks.onTransferUpdate({ ...receiveTransfer });
          haptics.play('complete');
        },
        onError: (err) => {
          receiveTransfer.status = 'failed';
          receiveTransfer.error = err.message;
          this.callbacks.onTransferUpdate({ ...receiveTransfer });
        },
      },
      4096
    );

    await senderPipeline.start();
  }

  public async respondToRequest(req: IncomingRequest, accept: boolean): Promise<void> {
    const bundle = this.getOrCreatePeerBundle(req.fromId);
    const transferId = req.transferId || req.id || '';

    if (!accept) {
      this.sendCtlReliable(req.fromId, {
        type: 'decline-transfer',
        payload: { transferId },
      });
      return;
    }

    if (!bundle.localPublicKey) {
      try {
        bundle.localPublicKey = await bundle.trustManager.init();
      } catch {}
    }
    if (req.senderPubKey && !bundle.hasDerivedSharedKey) {
      try {
        await bundle.trustManager.deriveSharedKey(req.senderPubKey);
        bundle.hasDerivedSharedKey = true;
      } catch {}
    }

    const quotaCheck = await checkStorageQuota(req.meta.size);
    if (!quotaCheck.sufficient) {
      this.callbacks.onError(quotaCheck.error || 'Insufficient storage quota');
      this.sendCtlReliable(req.fromId, {
        type: 'decline-transfer',
        payload: { transferId, reason: 'E_QUOTA' },
      });
      return;
    }

    const writer = await createBlockWriter({
      fileName: req.meta.name,
      fileSize: req.meta.size,
      mimeType: req.meta.type,
      transferId,
    });
    this.activeWriters.set(transferId, writer);

    const transfer: TransferFile = {
      id: transferId,
      name: req.meta.name,
      size: req.meta.size,
      type: req.meta.type,
      progress: 0,
      speedBytesPerSec: 0,
      etaSeconds: 0,
      direction: 'receiving',
      status: 'transferring',
      bytesTransferred: 0,
      speed: 0,
      peerId: req.fromId,
      peerName: req.fromName,
      channel: 'direct',
      createdAt: Date.now(),
    };
    this.transferFiles.set(transferId, transfer);
    this.callbacks.onTransferUpdate({ ...transfer });

    const totalBlocks = Math.max(1, Math.ceil(req.meta.size / DEFAULT_BLOCK_SIZE));
    const bitmap = new BlockBitmap(totalBlocks);
    this.transferBitmaps.set(transferId, bitmap);

    const receiveStartTime = Date.now();
    let lastSampleTime = receiveStartTime;
    let lastSampleBytes = 0;

    const receiverPipeline = new FileReceiverPipeline(
      transferId,
      req.meta.size,
      writer,
      {
        sendCtlMessage: (msg) => {
          this.sendCtlReliable(req.fromId, msg as Record<string, any>);
        },
        onProgress: (verifiedBytes, totalBytes) => {
          const now = Date.now();
          const dt = (now - lastSampleTime) / 1000;
          if (dt >= 0.25) {
            const instSpeed = (verifiedBytes - lastSampleBytes) / dt;
            transfer.speedBytesPerSec =
              transfer.speedBytesPerSec > 0
                ? transfer.speedBytesPerSec * 0.6 + instSpeed * 0.4
                : instSpeed;
            lastSampleTime = now;
            lastSampleBytes = verifiedBytes;
          } else if (transfer.speedBytesPerSec === 0) {
            const elapsed = Math.max(0.05, (now - receiveStartTime) / 1000);
            transfer.speedBytesPerSec = verifiedBytes / elapsed;
          }
          transfer.speed = transfer.speedBytesPerSec;
          const remaining = Math.max(0, totalBytes - verifiedBytes);
          transfer.etaSeconds =
            transfer.speedBytesPerSec > 0 ? remaining / transfer.speedBytesPerSec : 0;
          transfer.bytesTransferred = verifiedBytes;
          transfer.progress =
            totalBytes > 0 ? Math.min(99, Math.round((verifiedBytes / totalBytes) * 100)) : 100;
          transfer.status = 'transferring';
          this.callbacks.onTransferUpdate({ ...transfer });
        },
        onBlockVerified: (blockIndex) => {
          bitmap.markVerified(blockIndex);
          void this.journal.recordProgress({
            transferId,
            fileName: req.meta.name,
            fileSize: req.meta.size,
            lastModified: req.meta.lastModified || Date.now(),
            blockSize: DEFAULT_BLOCK_SIZE,
            totalBlocks,
            bitmapBase64: bitmap.toBase64(),
            direction: 'receiving',
            peerDeviceId: req.fromId,
            updatedAt: Date.now(),
          });
        },
        onFileComplete: (output) => {
          transfer.status = 'completed';
          transfer.progress = 100;
          transfer.bytesTransferred = req.meta.size;
          transfer.speedBytesPerSec = 0;
          transfer.etaSeconds = 0;
          if (output) {
            transfer.fileBlob = output;
            transfer.blobUrl = URL.createObjectURL(output);
          }
          this.callbacks.onTransferUpdate({ ...transfer });
          haptics.play('complete');
          this.activeReceivers.delete(transferId);
          this.activeWriters.delete(transferId);
        },
        onError: (err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
          this.callbacks.onTransferUpdate({ ...transfer });
          haptics.play('error');
          this.activeReceivers.delete(transferId);
          this.activeWriters.delete(transferId);
        },
      },
      DEFAULT_BLOCK_SIZE
    );

    this.activeReceivers.set(transferId, receiverPipeline);

    this.sendCtlReliable(req.fromId, {
      type: 'accept-transfer',
      payload: {
        transferId,
        receiverPubKey: bundle.localPublicKey,
      },
    });
  }

  public cancelTransfer(id: string, notifyRemote = true) {
    const sender = this.activeSenders.get(id);
    if (sender) sender.cancel();

    const writer = this.activeWriters.get(id);
    if (writer) void writer.abort();

    const t = this.transferFiles.get(id);
    if (t) {
      if (notifyRemote && t.peerId && t.peerId !== VIRTUAL_DEMO_PEER_ID) {
        this.sendCtlReliable(t.peerId, {
          type: 'cancel-transfer',
          payload: { transferId: id },
        });
      }
      t.status = 'cancelled';
      t.speedBytesPerSec = 0;
      t.etaSeconds = 0;
      this.callbacks.onTransferUpdate({ ...t });
    }

    this.activeSenders.delete(id);
    this.activeReceivers.delete(id);
    this.activeWriters.delete(id);
  }

  public pauseTransfer(id: string) {
    const sender = this.activeSenders.get(id);
    if (sender) sender.pause();

    const t = this.transferFiles.get(id);
    if (t) {
      t.status = 'paused';
      t.speedBytesPerSec = 0;
      this.callbacks.onTransferUpdate({ ...t });
    }
  }

  public resumeTransfer(id: string) {
    const sender = this.activeSenders.get(id);
    if (sender) sender.resume();

    const t = this.transferFiles.get(id);
    if (t) {
      t.status = 'transferring';
      this.callbacks.onTransferUpdate({ ...t });
    }
  }

  // -------------------------------------------------------------------------
  // Rooms & Direct Messaging
  // -------------------------------------------------------------------------
  public createRoom(password?: string) {
    if (this.state !== 'ready') {
      this.pendingRoomAction = () => this.createRoom(password);
      return;
    }
    this.signaling?.send('create-room', { password });
  }

  public joinRoom(code: string, password?: string) {
    const norm = normalizeRoomCode(code);
    if (norm.length !== ROOM_CODE_LENGTH) {
      this.callbacks.onRoomError(`Room code must be ${ROOM_CODE_LENGTH} characters.`);
      return;
    }
    if (this.state !== 'ready') {
      this.pendingRoomAction = () => this.joinRoom(norm, password);
      return;
    }
    this.signaling?.send('join-room', { roomCode: norm, password });
  }

  public leaveRoom() {
    if (this.currentRoomCode) {
      this.signaling?.send('leave-room', { roomCode: this.currentRoomCode });
    }
    this.currentRoomCode = null;
    this.roomPeers.clear();
    this.callbacks.onRoomLeft();
  }

  public async setRoomPassphrase(passphrase: string | null) {
    this.roomPassphrase = passphrase;
  }

  public broadcastClipboard(content: string) {
    const timestamp = Date.now();
    const payload = { content, timestamp, senderName: this.deviceName, isDirect: false };
    for (const [, bundle] of this.peerBundles) {
      if (bundle.peerSession.ctl.readyState === 'open') {
        bundle.peerSession.sendCtl({ type: 'clipboard', payload });
      }
    }
    this.signaling?.send('broadcast-clipboard', payload);
    try {
      this.localBus?.postMessage({
        kind: 'clipboard',
        from: this.deviceId,
        fromName: this.deviceName,
        content,
        timestamp,
      });
    } catch {}

    if (this.demoPeerEnabled) {
      setTimeout(() => {
        this.callbacks.onClipboardReceived(
          'Galaxy S25 Ultra (Demo Peer)',
          `Echo from Demo Peer: Received your snippet (${content.slice(0, 48)}${content.length > 48 ? '…' : ''})`,
          Date.now(),
          { fromId: VIRTUAL_DEMO_PEER_ID, isDirect: true }
        );
      }, 600);
    }
  }

  public sendDirectMessage(peerId: string, text: string) {
    const timestamp = Date.now();
    if (peerId === VIRTUAL_DEMO_PEER_ID) {
      setTimeout(() => {
        this.callbacks.onClipboardReceived(
          'Galaxy S25 Ultra (Demo Peer)',
          `Got your message: "${text}" — P2P channel is healthy and ready for transfers!`,
          Date.now(),
          { fromId: VIRTUAL_DEMO_PEER_ID, isDirect: true }
        );
      }, 500);
      return;
    }

    const payload = {
      content: text,
      timestamp,
      senderName: this.deviceName,
      targetPeerId: peerId,
      isDirect: true,
    };
    const bundle = this.getOrCreatePeerBundle(peerId);
    if (bundle.peerSession.ctl.readyState === 'open') {
      bundle.peerSession.sendCtl({ type: 'clipboard', payload });
    } else {
      this.signaling?.send('broadcast-clipboard', payload);
      try {
        this.localBus?.postMessage({
          kind: 'clipboard',
          from: this.deviceId,
          to: peerId,
          fromName: this.deviceName,
          content: text,
          timestamp,
        });
      } catch {}
    }
  }

  public getCurrentRoomCode(): string | null {
    return this.currentRoomCode;
  }

  public getRoomPassphrase(): string | null {
    return this.roomPassphrase;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public getState(): ConnState {
    return this.state;
  }

  private setState(state: ConnState, detail?: string) {
    this.state = state;
    this.callbacks.onStateChange(state, detail);
  }

  public destroy() {
    this.destroyed = true;
    if (this.localBusTimer) {
      clearInterval(this.localBusTimer);
      this.localBusTimer = null;
    }
    if (this.localBus) {
      try {
        this.localBus.postMessage({ kind: 'bye', from: this.deviceId });
        this.localBus.close();
      } catch {}
      this.localBus = null;
    }
    if (this.currentRoomCode) {
      this.signaling?.send('leave-room', { roomCode: this.currentRoomCode });
    }
    if (this.signaling) {
      this.signaling.destroy();
      this.signaling = null;
    }
    for (const bundle of this.peerBundles.values()) {
      bundle.peerSession.close();
      bundle.relayTransport.close();
    }
    this.peerBundles.clear();
    this.activeSenders.clear();
    this.activeReceivers.clear();
    this.activeWriters.clear();
    this.setState('disconnected');
  }
}
