import type {
  ConnState,
  Device,
  FileMeta,
  IncomingRequest,
  Platform,
  TransferFile,
  ChatMessage,
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
  type BlockWriter,
} from '../transfer/storage/index.js';
import { TransferJournal } from '../transfer/resume/journal.js';
import { BlockBitmap } from '../transfer/resume/bitmap.js';
import { haptics } from '../haptics/index.js';
import { soundEffects } from '../utils/soundEffects.js';
import { detectDeviceProfileSync, type DetectedDeviceProfile } from '../utils/deviceDetector.js';
import { saveToPersonalSpace } from '../utils/personalSpace.js';

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
    const existingTabId = sessionStorage.getItem('mog_tab_device_id');
    if (existingTabId && /^[\w-]{8,64}$/.test(existingTabId)) {
      return existingTabId;
    }
  } catch {}

  let baseId = safeGet('mog_device_id');
  if (!baseId || !/^[\w-]{8,64}$/.test(baseId)) {
    baseId = generateEphemeralDeviceId();
    safeSet('mog_device_id', baseId);
  }

  // Check if another tab in the same browser is actively heartbeating with baseId
  let finalId = baseId;
  try {
    const lastActive = Number(localStorage.getItem('mog_device_active_ts') || '0');
    const activeHolder = localStorage.getItem('mog_device_active_tab') || '';
    const myTabToken =
      sessionStorage.getItem('mog_tab_token') || Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('mog_tab_token', myTabToken);

    if (activeHolder && activeHolder !== myTabToken && Date.now() - lastActive < 4500) {
      // Another tab in this browser is open right now; derive a secondary tab ID
      finalId = `${baseId.slice(0, 24)}_${myTabToken.slice(0, 6)}`;
    } else {
      localStorage.setItem('mog_device_active_tab', myTabToken);
      localStorage.setItem('mog_device_active_ts', String(Date.now()));
    }
    sessionStorage.setItem('mog_tab_device_id', finalId);
  } catch {}

  return finalId;
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
  private probeResult: ProbeResult = {
    v4Ip: null,
    v6Ip: null,
    stunV4Ip: null,
    stunV6Ip: null,
    networkKeys: ['local-lan'],
    warnings: {
      isVpnDetected: false,
      isPrivateRelayDetected: false,
      isIpv6ProbeFailed: false,
    },
  };
  private iceServers: IceServerConfig[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  private visiblePeers = new Map<string, Device>();
  private roomPeers = new Map<string, Device>();
  private peerLastUpdated = new Map<string, number>();
  private currentRoomCode: string | null = null;
  private roomPassphrase: string | null = null;

  private peerBundles = new Map<string, PeerConnectionBundle>();

  private activeSenders = new Map<string, FileSenderPipeline>();
  private activeReceivers = new Map<string, FileReceiverPipeline>();
  private activeWriters = new Map<string, BlockWriter>();
  private transferFiles = new Map<string, TransferFile>();
  private transferBitmaps = new Map<string, BlockBitmap>();
  private requestRetryTimers = new Map<string, ReturnType<typeof setInterval>>();

  private journal: TransferJournal;
  private destroyed = false;
  private seenCtl = new Set<string>();
  private latencyMs: number | null = null;
  private lastPingSent = 0;
  private relayFrameCounter = 0;
  private pendingRoomAction: (() => void) | null = null;

  private subscribers = new Set<() => void>();
  private pendingIncomingReq: IncomingRequest | null = null;
  private chatHistory: ChatMessage[] = [];

  constructor(
    deviceName?: string,
    platform?: Platform,
    callbacks?: Partial<NetworkCallbacks>,
    serverUrlOverride: string | null = null,
    deviceProfile?: Partial<DetectedDeviceProfile>
  ) {
    const detected = detectDeviceProfileSync();
    const savedName = safeGet('mog_device_name');
    this.deviceId = getPersistentDeviceId();
    this.deviceName = deviceName || savedName || detected.suggestedName || 'MogShare Node';
    this.platform = platform || detected.platform || 'web';
    this.deviceProfile = deviceProfile || detected;
    this.journal = new TransferJournal();

    this.callbacks = {
      onStateChange: (s, d) => {
        callbacks?.onStateChange?.(s, d);
        this.notifySubscribers();
      },
      onPeersChanged: (p) => {
        callbacks?.onPeersChanged?.(p);
        this.notifySubscribers();
      },
      onRoomCreated: (c) => {
        callbacks?.onRoomCreated?.(c);
        this.notifySubscribers();
      },
      onRoomJoined: (c) => {
        callbacks?.onRoomJoined?.(c);
        this.notifySubscribers();
      },
      onRoomLeft: () => {
        callbacks?.onRoomLeft?.();
        this.notifySubscribers();
      },
      onRoomPeers: (p) => {
        callbacks?.onRoomPeers?.(p);
        this.notifySubscribers();
      },
      onRoomError: (m) => {
        callbacks?.onRoomError?.(m);
        this.notifySubscribers();
      },
      onIncomingRequest: (req) => {
        this.pendingIncomingReq = req;
        callbacks?.onIncomingRequest?.(req);
        this.notifySubscribers();
      },
      onTransferUpdate: (t) => {
        if (t.status === 'completed' && t.direction === 'receiving' && t.fileBlob) {
          void saveToPersonalSpace({
            id: t.id,
            transferId: t.id,
            name: t.name,
            size: t.size,
            type: t.type,
            senderName: t.peerName || 'Peer',
            senderId: t.peerId,
            receivedAt: Date.now(),
            blob: t.fileBlob,
            blobUrl: t.blobUrl,
          }).catch(() => undefined);
        }
        callbacks?.onTransferUpdate?.(t);
        this.notifySubscribers();
      },
      onClipboardReceived: (fromDevice, content, timestamp, meta) => {
        this.chatHistory.push({
          id: `msg_${timestamp}_${Math.random().toString(36).slice(2, 7)}`,
          senderId: meta?.fromId || 'peer',
          senderName: fromDevice,
          text: content,
          timestamp,
          isSelf: false,
        });
        callbacks?.onClipboardReceived?.(fromDevice, content, timestamp, meta);
        this.notifySubscribers();
      },
      onError: (m) => {
        callbacks?.onError?.(m);
        this.notifySubscribers();
      },
    };

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

  private notifySubscribers() {
    for (const sub of this.subscribers) {
      try {
        sub();
      } catch {}
    }
  }

  public subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  public getPeers(): Device[] {
    const combined: Device[] = [];
    for (const [id, p] of this.visiblePeers) {
      if (id !== this.deviceId) combined.push(p);
    }
    for (const [id, entry] of this.localBusPeers) {
      if (id !== this.deviceId && !this.visiblePeers.has(id)) {
        combined.push(entry.device);
      }
    }
    for (const [id, p] of this.roomPeers) {
      if (id !== this.deviceId) {
        combined.push({ ...p, discoveryMethod: 'Online Room' });
      }
    }
    return this.deduplicateDeviceList(combined);
  }

  public getTransfers(): TransferFile[] {
    return Array.from(this.transferFiles.values()).sort(
      (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
    );
  }

  public getIncomingRequest(): IncomingRequest | null {
    return this.pendingIncomingReq;
  }

  public getChatMessages(): ChatMessage[] {
    return this.chatHistory;
  }

  public getRoomCode(): string | null {
    return this.currentRoomCode;
  }

  public getLocalInfo(): { id: string; name: string; platform: Platform; model?: string } {
    return {
      id: this.deviceId,
      name: this.deviceName,
      platform: this.platform,
      model: this.deviceProfile?.model,
    };
  }

  public async sendFiles(peerId: string, files: File[]): Promise<void> {
    const peer =
      this.getPeers().find((p) => p.id === peerId) ||
      ({ id: peerId, name: 'Connected Peer', platform: 'web', status: 'online' } as Device);
    for (const file of files) {
      await this.sendFile(peer, file);
    }
  }

  public rescanPeers(): void {
    this.rescan();
  }

  public async acceptRequest(): Promise<void> {
    const req = this.pendingIncomingReq;
    if (!req) return;
    this.pendingIncomingReq = null;
    this.notifySubscribers();
    await this.respondToRequest(req, true);
  }

  public async declineRequest(): Promise<void> {
    const req = this.pendingIncomingReq;
    if (!req) return;
    this.pendingIncomingReq = null;
    this.notifySubscribers();
    await this.respondToRequest(req, false);
  }

  public sendChatMessage(peerId: string, text: string): void {
    const timestamp = Date.now();
    this.chatHistory.push({
      id: `msg_${timestamp}_${Math.random().toString(36).slice(2, 7)}`,
      senderId: peerId,
      senderName: this.deviceName,
      text,
      timestamp,
      isSelf: true,
    });
    this.sendDirectMessage(peerId, text);
    this.notifySubscribers();
  }

  public setDeviceName(name: string): void {
    safeSet('mog_device_name', name);
    this.updateProfile(name, this.platform, this.deviceProfile);
    this.notifySubscribers();
  }

  public clearFinishedTransfers(): void {
    for (const [id, t] of this.transferFiles.entries()) {
      if (
        t.status === 'completed' ||
        t.status === 'failed' ||
        t.status === 'cancelled' ||
        t.status === 'declined'
      ) {
        this.transferFiles.delete(id);
      }
    }
    this.notifySubscribers();
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
    const rung = this.signaling?.getActiveRung();
    if (rung === 'ws') return 'Live';
    if (rung === 'sse') return 'Stream';
    if (rung === 'poll') return 'Cloud';
    return 'Local';
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
      this.signaling.send('rescan', {
        name: this.deviceName,
        platform: this.platform,
        model: this.deviceProfile?.model,
      });
      this.signaling.send('ping', { clientTime: this.lastPingSent });
    } else if (this.state !== 'connecting') {
      void this.initialize();
    }
    this.broadcastLocalBusPresence(true);
    this.emitVisiblePeers();
  }

  /**
   * Deduplicates peers by both ID and hardware signature (name + platform + model)
   * so the same Android/iOS/desktop device never appears twice after re-scanning or room sharing.
   */
  private deduplicateDeviceList(rawList: Device[]): Device[] {
    const byId = new Map<string, Device>();
    for (const d of rawList) {
      if (!d || !d.id || d.id === this.deviceId) continue;
      byId.set(d.id, d);
    }

    const sorted = Array.from(byId.values()).sort((a, b) => {
      const tA = this.peerLastUpdated.get(a.id) || 0;
      const tB = this.peerLastUpdated.get(b.id) || 0;
      return tB - tA;
    });

    const bySignature = new Map<string, Device>();
    for (const d of sorted) {
      const isLocalTab = this.localBusPeers.has(d.id);
      const sig = isLocalTab
        ? `tab:${d.id}`
        : `hw:${d.name.trim().toLowerCase()}|${d.platform}|${(d.model || '').trim().toLowerCase()}`;
      if (!bySignature.has(sig)) {
        bySignature.set(sig, d);
      } else {
        const existing = bySignature.get(sig)!;
        const dOpen = this.peerBundles.get(d.id)?.peerSession.data.readyState === 'open';
        const exOpen = this.peerBundles.get(existing.id)?.peerSession.data.readyState === 'open';
        if (dOpen && !exOpen) {
          bySignature.set(sig, d);
        }
      }
    }

    return Array.from(bySignature.values());
  }

  private emitVisiblePeers() {
    const combined: Device[] = [];
    for (const [id, p] of this.visiblePeers) {
      if (id !== this.deviceId) combined.push(p);
    }
    for (const [id, entry] of this.localBusPeers) {
      if (id !== this.deviceId && !this.visiblePeers.has(id)) {
        combined.push(entry.device);
      }
    }
    this.callbacks.onPeersChanged(this.deduplicateDeviceList(combined));
  }

  private emitRoomPeers() {
    const list = Array.from(this.roomPeers.values()).filter((p) => p.id !== this.deviceId);
    this.callbacks.onRoomPeers(this.deduplicateDeviceList(list));
  }

  /**
   * Pre-warms the WebRTC PeerSession as soon as a peer is discovered so that
   * by the time the user taps Send, the Direct Local Wi-Fi DataChannel is already open!
   */
  private prewarmPeer(remoteDeviceId: string) {
    if (!remoteDeviceId || remoteDeviceId === this.deviceId) return;
    const bundle = this.getOrCreatePeerBundle(remoteDeviceId);
    if (!bundle.peerSession.isPolite) {
      void bundle.peerSession.ensureNegotiationStarted();
    }
  }

  // -------------------------------------------------------------------------
  // Same-Browser Multi-Tab BroadcastChannel Bus
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
            this.peerLastUpdated.set(msg.from, Date.now());
            const dev: Device = {
              id: msg.from,
              name: msg.name || 'Local Tab',
              platform: msg.platform || 'web',
              model: msg.model,
              os: msg.os,
              browser: msg.browser,
              deviceType: msg.deviceType,
              batteryLevel: msg.batteryLevel,
              isCharging: msg.isCharging,
              status: 'online',
              connType: 'Local Wi-Fi · Zero Data',
              rttMs: 1,
            };
            const isNew = !this.localBusPeers.has(msg.from) && !this.visiblePeers.has(msg.from);
            this.localBusPeers.set(msg.from, { device: dev, lastSeen: Date.now() });
            if (isNew) {
              haptics.play('deviceFound');
              soundEffects.play('devicePaired');
              this.prewarmPeer(msg.from);
            }
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
            if (msg.binary instanceof Uint8Array) {
              this.handleDataFrame(msg.binary);
              break;
            }
            if (msg.binary instanceof ArrayBuffer) {
              this.handleDataFrame(new Uint8Array(msg.binary));
              break;
            }
            const bundle = this.getOrCreatePeerBundle(msg.from);
            if (msg.encrypted && bundle.hasDerivedSharedKey) {
              void bundle.relayTransport.handleIncomingRelayFrame(msg.data as string);
            } else if (typeof msg.data === 'string') {
              this.handleDataFrame(base64ToUint8(msg.data));
            }
            break;
          }
          case 'clipboard': {
            soundEffects.play('messageReceived');
            this.callbacks.onClipboardReceived(
              msg.fromName || 'Local Device',
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
        try {
          const myTabToken = sessionStorage.getItem('mog_tab_token');
          if (myTabToken && localStorage.getItem('mog_device_active_tab') === myTabToken) {
            localStorage.setItem('mog_device_active_ts', String(Date.now()));
          }
        } catch {}
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
      }, 3500);

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
  // Instant Signaling Initialization (Zero Blocking on STUN/IPv6 Probes)
  // -------------------------------------------------------------------------
  private async initialize() {
    this.setState('connecting', 'Connecting to discovery network…');

    try {
      if (this.signaling) {
        this.signaling.destroy();
      }

      // 1. Connect WebSocket IMMEDIATELY so devices appear in <100ms
      this.signaling = new SignalingLadderClient(this.deviceId, this.serverUrl, {
        onMessage: (envelope) => this.handleSignalingEnvelope(envelope),
        onStateChange: (state, _rung) => {
          if (state === 'connected') {
            this.sendJoinMessage();
            if (this.currentRoomCode) {
              this.signaling?.send('join-room', {
                roomCode: this.currentRoomCode,
                password: this.roomPassphrase || undefined,
                name: this.deviceName,
                platform: this.platform,
                model: this.deviceProfile?.model,
              });
            }
            this.setState('ready', 'Connected');
            if (this.pendingRoomAction) {
              const act = this.pendingRoomAction;
              this.pendingRoomAction = null;
              act();
            }
          } else if (state === 'connecting') {
            this.setState('connecting', 'Connecting…');
          } else {
            this.setState('reconnecting', 'Reconnecting…');
          }
        },
        onError: (err) => {
          this.callbacks.onError(err.message);
        },
      });

      const connectPromise = this.signaling.connect();

      // 2. Run TURN credentials & dual-stack STUN network probe in parallel in background
      void (async () => {
        await this.fetchTurnCredentials();
        const probed = await probeNetwork(this.serverUrl, this.iceServers);
        if (this.destroyed) return;
        this.probeResult = probed;
        if (this.signaling && this.state === 'ready') {
          this.sendJoinMessage();
        }
      })();

      await connectPromise;
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
    if (!this.signaling) return;
    this.signaling.send('join', {
      name: this.deviceName,
      platform: this.platform,
      model: this.deviceProfile?.model,
      os: this.deviceProfile?.os,
      browser: this.deviceProfile?.browser,
      deviceType: this.deviceProfile?.deviceType,
      batteryLevel: this.deviceProfile?.batteryLevel,
      isCharging: this.deviceProfile?.isCharging,
      networkKeys: this.probeResult?.networkKeys || ['local-lan'],
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
    connType = 'Local Wi-Fi · Zero Data'
  ): Device {
    this.peerLastUpdated.set(p.id, Date.now());
    const existing = this.visiblePeers.get(p.id) || this.roomPeers.get(p.id);
    const bundle = this.peerBundles.get(p.id);
    const isDirectOpen = bundle?.peerSession.data.readyState === 'open';
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
      connType: isDirectOpen ? 'Local Wi-Fi · Zero Data' : existing?.connType || connType,
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
        const hadPeers = this.visiblePeers.size > 0;
        let foundNew = false;
        const nextIds = new Set<string>();
        for (const p of peers) {
          if (p.id !== this.deviceId) {
            nextIds.add(p.id);
            if (!this.visiblePeers.has(p.id)) foundNew = true;
            this.visiblePeers.set(p.id, this.mapRawPeerToDevice(p, 'Local Wi-Fi · Zero Data'));
            this.prewarmPeer(p.id);
          }
        }
        for (const oldId of Array.from(this.visiblePeers.keys())) {
          if (!nextIds.has(oldId)) this.visiblePeers.delete(oldId);
        }
        if (foundNew && (!hadPeers || peers.length > 0)) {
          haptics.play('deviceFound');
          soundEffects.play('devicePaired');
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
          // Remove any older entry in visiblePeers with the exact same name+platform+model
          for (const [oldId, oldPeer] of Array.from(this.visiblePeers.entries())) {
            if (
              oldId !== p.id &&
              oldPeer.name === p.name &&
              oldPeer.platform === p.platform &&
              (oldPeer.model || '') === (p.model || '')
            ) {
              this.visiblePeers.delete(oldId);
            }
          }
          const isNew = !this.visiblePeers.has(p.id);
          this.visiblePeers.set(p.id, this.mapRawPeerToDevice(p, 'Local Wi-Fi · Zero Data'));
          this.prewarmPeer(p.id);
          if (isNew) {
            haptics.play('deviceFound');
            soundEffects.play('devicePaired');
          }
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
        soundEffects.play('devicePaired');
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
        this.roomPeers.clear();
        for (const p of peers) {
          if (p.id !== this.deviceId) {
            this.roomPeers.set(p.id, this.mapRawPeerToDevice(p, 'Online Room'));
            this.prewarmPeer(p.id);
          }
        }
        soundEffects.play('devicePaired');
        this.callbacks.onRoomJoined(code);
        this.emitRoomPeers();
        break;
      }

      case 'room-join-failed': {
        soundEffects.play('error');
        this.callbacks.onRoomError((payload.error as string) || 'Failed to join room');
        break;
      }

      case 'peer-left-room': {
        const pId = payload.peerId as string;
        if (pId) {
          this.roomPeers.delete(pId);
          this.emitRoomPeers();
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
        soundEffects.play('messageReceived');
        this.callbacks.onClipboardReceived(fromName, content, ts, {
          fromId: payload.fromId as string | undefined,
          isDirect: Boolean(payload.isDirect),
        });
        break;
      }

      case 'peer-joined-room': {
        const pId = (payload.peerId as string) || (payload.id as string);
        if (pId && pId !== this.deviceId) {
          for (const [oldId, oldPeer] of Array.from(this.roomPeers.entries())) {
            if (
              oldId !== pId &&
              oldPeer.name === (payload.name as string) &&
              oldPeer.platform === ((payload.platform as Platform) || 'web')
            ) {
              this.roomPeers.delete(oldId);
            }
          }
          const isNew = !this.roomPeers.has(pId);
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
              'Online Room'
            )
          );
          this.prewarmPeer(pId);
          if (isNew) {
            haptics.play('deviceFound');
            soundEffects.play('devicePaired');
          }
          this.emitRoomPeers();
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
          if (bundle.hasDerivedSharedKey) {
            void bundle.relayTransport
              .handleIncomingRelayFrame(payload.data)
              .catch(() => {
                try {
                  this.handleDataFrame(base64ToUint8(payload.data as string));
                } catch {}
              });
          } else {
            try {
              this.handleDataFrame(base64ToUint8(payload.data));
            } catch {}
          }
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
          peer.connType =
            badge.toLowerCase().includes('local') || badge.toLowerCase().includes('direct')
              ? 'Local Wi-Fi · Zero Data'
              : 'Cloud Bridge';
          this.emitVisiblePeers();
          if (this.roomPeers.has(remoteDeviceId)) {
            this.emitRoomPeers();
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
          if (this.roomPeers.has(remoteDeviceId)) {
            this.emitRoomPeers();
          }
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
      onDataOpen: () => {
        const peer =
          this.visiblePeers.get(remoteDeviceId) ||
          this.roomPeers.get(remoteDeviceId) ||
          this.localBusPeers.get(remoteDeviceId)?.device;
        if (peer) {
          peer.connType = 'Local Wi-Fi · Zero Data';
          this.emitVisiblePeers();
          if (this.roomPeers.has(remoteDeviceId)) {
            this.emitRoomPeers();
          }
        }
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

  private sendCtlReliable(remoteDeviceId: string, msg: Record<string, any>) {
    const envelopeWithId = {
      ...msg,
      _msgId:
        msg._msgId ||
        `${this.deviceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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

  /**
   * High-speed hybrid transport:
   * - Uses synchronous WebRTC DataChannel burst when open (0ms await overhead).
   * - Uses direct binary BroadcastChannel for local same-browser tabs.
   * - Streams immediately over WebSocket relay while WebRTC negotiates in parallel,
   *   and upgrades mid-transfer to Direct Wi-Fi the instant DataChannel opens!
   */
  private sendDataFrameHybrid(
    remoteDeviceId: string,
    bundle: PeerConnectionBundle,
    frame: Uint8Array,
    transfer: TransferFile
  ): Promise<void> | void {
    const ps = bundle.peerSession;

    // 1. Direct WebRTC DataChannel (Synchronous fast-path for maximum LAN/Wi-Fi throughput!)
    if (ps.data.readyState === 'open') {
      transfer.channel = 'direct';
      ps.sendData(frame);
      return;
    }

    // 2. Same-browser multi-tab BroadcastChannel binary fast-path
    if (this.localBus && this.localBusPeers.has(remoteDeviceId)) {
      transfer.channel = 'direct';
      try {
        this.localBus.postMessage({
          kind: 'relay-frame',
          from: this.deviceId,
          to: remoteDeviceId,
          binary: frame,
        });
        return;
      } catch {
        /* fallback below */
      }
    }

    // 3. Kick WebRTC negotiation in background so it upgrades to Direct as soon as ICE completes
    void ps.ensureNegotiationStarted();

    // 4. High-speed pipelined WebSocket relay (only yield every 8 frames so throughput stays fast)
    transfer.channel = 'relay';
    const b64 = uint8ToBase64(frame);
    this.signaling?.send('relay-frame', { data: b64, raw: true }, remoteDeviceId);

    this.relayFrameCounter++;
    if (this.relayFrameCounter % 8 === 0) {
      return new Promise((r) => setTimeout(r, 2));
    }
  }

  private clearRequestRetry(transferId: string) {
    const t = this.requestRetryTimers.get(transferId);
    if (t) {
      clearInterval(t);
      this.requestRetryTimers.delete(transferId);
    }
  }

  // -------------------------------------------------------------------------
  // Control Protocol Dispatch (ctl channel)
  // -------------------------------------------------------------------------
  private handleCtlMessage(remoteDeviceId: string, data: any) {
    if (!data || typeof data !== 'object') return;
    const { type, payload, _msgId } = data;

    if (_msgId) {
      if (this.seenCtl.has(_msgId)) return;
      this.seenCtl.add(_msgId);
      if (this.seenCtl.size > 3000) {
        const first = this.seenCtl.values().next().value;
        if (first) this.seenCtl.delete(first);
      }
    }

    switch (type) {
      case 'request-transfer': {
        const transferId = payload.transferId as string;
        const bundle = this.getOrCreatePeerBundle(remoteDeviceId);

        if (this.activeReceivers.has(transferId)) {
          this.sendCtlReliable(remoteDeviceId, {
            type: 'accept-transfer',
            payload: {
              transferId,
              receiverPubKey: bundle.localPublicKey,
            },
          });
          return;
        }

        const reqKey = `req_prompt:${transferId}`;
        if (this.seenCtl.has(reqKey)) return;
        this.seenCtl.add(reqKey);

        if (payload.senderPubKey) {
          bundle.trustManager
            .deriveSharedKey(payload.senderPubKey as string)
            .then(() => {
              bundle.hasDerivedSharedKey = true;
            })
            .catch(() => undefined);
        }

        const req: IncomingRequest = {
          id: transferId,
          transferId,
          fromId: remoteDeviceId,
          fromName: (payload.senderName as string) || 'Nearby Device',
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
        soundEffects.play('incomingRequest');
        this.callbacks.onIncomingRequest(req);
        break;
      }

      case 'accept-transfer': {
        const transferId = payload.transferId as string;
        this.clearRequestRetry(transferId);

        const acceptKey = `accepted:${transferId}`;
        if (this.seenCtl.has(acceptKey)) return;
        this.seenCtl.add(acceptKey);

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
          soundEffects.play('transferStart');
          void sender.start();
        }
        break;
      }

      case 'decline-transfer': {
        const transferId = payload.transferId as string;
        this.clearRequestRetry(transferId);
        const t = this.transferFiles.get(transferId);
        if (t) {
          t.status = 'declined';
          this.callbacks.onTransferUpdate({ ...t });
        }
        soundEffects.play('error');
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
        soundEffects.play('messageReceived');
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
    const transferId = `xfer_${Math.random().toString(36).slice(2, 10)}`;
    const bundle = this.getOrCreatePeerBundle(peer.id);

    void bundle.peerSession.ensureNegotiationStarted();

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

    const updateSenderMetrics = (
      bytes: number,
      totalBytes: number,
      speedBps: number,
      isAcked: boolean
    ) => {
      if (bytes < (transfer.bytesTransferred || 0) && !isAcked) return;
      transfer.bytesTransferred = bytes;
      const maxPct = isAcked ? 99 : 95;
      transfer.progress =
        totalBytes > 0 ? Math.min(maxPct, Math.round((bytes / totalBytes) * 100)) : 100;
      if (speedBps > 0) {
        transfer.speedBytesPerSec =
          transfer.speedBytesPerSec > 0
            ? transfer.speedBytesPerSec * 0.65 + speedBps * 0.35
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
        sendDataChannel: (frame) => {
          return this.sendDataFrameHybrid(peer.id, bundle, frame, transfer);
        },
        sendCtlMessage: (msg) => {
          this.sendCtlReliable(peer.id, msg as Record<string, any>);
        },
        getBufferedAmount: () => bundle.peerSession.getBufferedAmount(),
        waitForBufferedAmountLow: () => bundle.peerSession.waitForBufferedAmountLow(),
        onChunkProgress: (sentBytes, totalBytes, speedBps) => {
          updateSenderMetrics(sentBytes, totalBytes, speedBps, false);
        },
        onAckedProgress: (acknowledgedBytes, totalBytes, speedBps) => {
          updateSenderMetrics(acknowledgedBytes, totalBytes, speedBps, true);
        },
        onBlockCompleted: () => {},
        onFileCompleted: () => {
          this.clearRequestRetry(transferId);
          transfer.status = 'completed';
          transfer.progress = 100;
          transfer.bytesTransferred = file.size;
          transfer.speedBytesPerSec = 0;
          transfer.etaSeconds = 0;
          this.callbacks.onTransferUpdate({ ...transfer });
          haptics.play('complete');
          soundEffects.play('transferComplete');
          this.activeSenders.delete(transferId);
        },
        onError: (err) => {
          this.clearRequestRetry(transferId);
          transfer.status = 'failed';
          transfer.error = err.message;
          this.callbacks.onTransferUpdate({ ...transfer });
          haptics.play('error');
          soundEffects.play('error');
          this.activeSenders.delete(transferId);
        },
      },
      { chunkSize: DEFAULT_CHUNK_SIZE, blockSize: DEFAULT_BLOCK_SIZE }
    );

    this.activeSenders.set(transferId, senderPipeline);

    const buildReqPayload = () => ({
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
    });

    this.sendCtlReliable(peer.id, buildReqPayload());

    let attempts = 0;
    const retryTimer = setInterval(() => {
      attempts++;
      const cur = this.transferFiles.get(transferId);
      if (!cur || cur.status !== 'waiting' || attempts > 10) {
        this.clearRequestRetry(transferId);
        return;
      }
      this.sendCtlReliable(peer.id, buildReqPayload());
    }, 1500);
    this.requestRetryTimers.set(transferId, retryTimer);
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

    void bundle.peerSession.ensureNegotiationStarted();

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

    const isDirect = bundle.peerSession.data.readyState === 'open';
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
      channel: isDirect ? 'direct' : 'direct',
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
          if (dt >= 0.2) {
            const instSpeed = (verifiedBytes - lastSampleBytes) / dt;
            transfer.speedBytesPerSec =
              transfer.speedBytesPerSec > 0
                ? transfer.speedBytesPerSec * 0.65 + instSpeed * 0.35
                : instSpeed;
            lastSampleTime = now;
            lastSampleBytes = verifiedBytes;
          } else if (transfer.speedBytesPerSec === 0) {
            const elapsed = Math.max(0.05, (now - receiveStartTime) / 1000);
            transfer.speedBytesPerSec = verifiedBytes / elapsed;
          }
          transfer.speed = transfer.speedBytesPerSec;
          transfer.channel =
            bundle.peerSession.data.readyState === 'open' || this.localBusPeers.has(req.fromId)
              ? 'direct'
              : 'relay';
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
          soundEffects.play('transferComplete');
          this.activeReceivers.delete(transferId);
          this.activeWriters.delete(transferId);
        },
        onError: (err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
          this.callbacks.onTransferUpdate({ ...transfer });
          haptics.play('error');
          soundEffects.play('error');
          this.activeReceivers.delete(transferId);
          this.activeWriters.delete(transferId);
        },
      },
      DEFAULT_BLOCK_SIZE
    );

    this.activeReceivers.set(transferId, receiverPipeline);
    soundEffects.play('transferStart');

    this.sendCtlReliable(req.fromId, {
      type: 'accept-transfer',
      payload: {
        transferId,
        receiverPubKey: bundle.localPublicKey,
      },
    });
  }

  public cancelTransfer(id: string, notifyRemote = true) {
    this.clearRequestRetry(id);
    const sender = this.activeSenders.get(id);
    if (sender) sender.cancel();

    const writer = this.activeWriters.get(id);
    if (writer) void writer.abort();

    const t = this.transferFiles.get(id);
    if (t) {
      if (notifyRemote && t.peerId) {
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
    this.signaling?.send('create-room', {
      password,
      name: this.deviceName,
      platform: this.platform,
      model: this.deviceProfile?.model,
    });
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
    this.signaling?.send('join-room', {
      roomCode: norm,
      password,
      name: this.deviceName,
      platform: this.platform,
      model: this.deviceProfile?.model,
    });
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
  }

  public sendDirectMessage(peerId: string, text: string) {
    const timestamp = Date.now();
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
    for (const t of this.requestRetryTimers.values()) clearInterval(t);
    this.requestRetryTimers.clear();
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
