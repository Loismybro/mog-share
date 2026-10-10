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
  DEFAULT_CREDIT_WINDOW_BLOCKS,
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

// ---------------------------------------------------------------------------
// Helpers and Utilities
// ---------------------------------------------------------------------------

export function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* noop */ }
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
  onClipboardReceived: (fromDevice: string, content: string, timestamp: number) => void;
  onError: (msg: string) => void;
}

interface PeerConnectionBundle {
  peerSession: PeerSession;
  orchestrator: ConnectionLadderOrchestrator;
  trustManager: TrustManager;
  relayTransport: EncryptedServerRelayTransport;
  pathStats?: PeerPathStats;
}

export class NetworkService {
  private deviceId: string;
  private deviceName: string;
  private platform: Platform;
  private callbacks: NetworkCallbacks;
  private serverUrl: string;

  private signaling: SignalingLadderClient | null = null;
  private state: ConnState = 'idle';
  private probeResult: ProbeResult | null = null;
  private iceServers: IceServerConfig[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  private visiblePeers = new Map<string, Device>();
  private roomPeers = new Map<string, Device>();
  private currentRoomCode: string | null = null;
  private roomPassphrase: string | null = null;

  // Active WebRTC / Relay sessions per peerId
  private peerBundles = new Map<string, PeerConnectionBundle>();

  // Active Transfers: transferId -> pipelines
  private activeSenders = new Map<string, FileSenderPipeline>();
  private activeReceivers = new Map<string, FileReceiverPipeline>();
  private activeWriters = new Map<string, BlockWriter>();
  private transferFiles = new Map<string, TransferFile>();
  private transferBitmaps = new Map<string, BlockBitmap>();

  private journal: TransferJournal;
  private destroyed = false;
  private latencyMs: number | null = null;
  private lastPingSent = 0;
  private pendingRoomAction: (() => void) | null = null;

  constructor(
    deviceName: string,
    platform: Platform,
    callbacks: NetworkCallbacks,
    serverUrlOverride: string | null = null
  ) {
    this.deviceId = getPersistentDeviceId();
    this.deviceName = deviceName;
    this.platform = platform;
    this.callbacks = callbacks;
    this.journal = new TransferJournal();

    const envUrl = (import.meta as any).env?.VITE_SERVER_URL as string | undefined;
    this.serverUrl = serverUrlOverride || envUrl || window.location.origin;

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

  public updateProfile(name: string, platform: Platform) {
    this.deviceName = name;
    this.platform = platform;
    if (this.signaling && this.state === 'ready') {
      this.signaling.send('update-profile', {
        name: this.deviceName,
        platform: this.platform,
      });
    }
  }

  public setCustomServerUrl(url: string | null) {
    this.serverUrl = url || window.location.origin;
    safeSet('mog_server_url', this.serverUrl);
    void this.initialize();
  }

  private async initialize() {
    this.setState('connecting', 'Probing network identity (dual-stack v4/v6)...');

    try {
      // 1. Fetch dynamic ephemeral TURN credentials from server
      await this.fetchTurnCredentials();

      // 2. Dual-stack probe for local network grouping keys
      this.probeResult = await probeNetwork(this.serverUrl, this.iceServers);

      if (this.probeResult.warnings.message) {
        this.callbacks.onError(this.probeResult.warnings.message);
      }

      // 3. Connect via Signaling Ladder Client (WS -> SSE+POST -> Long-Poll)
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
          this.iceServers = data.iceServers;
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
      networkKeys: this.probeResult.networkKeys,
      resumeToken: this.signaling.getResumeToken(),
    });
    this.lastPingSent = Date.now();
    this.signaling.send('ping', { clientTime: this.lastPingSent });
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
        const peers = (payload.peers as Array<{ id: string; name: string; platform: Platform }>) || [];
        this.visiblePeers.clear();
        for (const p of peers) {
          if (p.id !== this.deviceId) {
            this.visiblePeers.set(p.id, {
              id: p.id,
              name: p.name,
              platform: p.platform || 'web',
              connType: 'Direct (same network)',
            });
          }
        }
        this.callbacks.onPeersChanged(Array.from(this.visiblePeers.values()));
        break;
      }

      case 'peer-discovered': {
        const p = payload as { id: string; name: string; platform: Platform };
        if (p.id && p.id !== this.deviceId) {
          this.visiblePeers.set(p.id, {
            id: p.id,
            name: p.name,
            platform: p.platform || 'web',
            connType: 'Direct (same network)',
          });
          haptics.play('deviceFound');
          this.callbacks.onPeersChanged(Array.from(this.visiblePeers.values()));
        }
        break;
      }

      case 'peer-left': {
        const pId = payload.deviceId as string;
        if (pId) {
          this.visiblePeers.delete(pId);
          this.callbacks.onPeersChanged(Array.from(this.visiblePeers.values()));
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
        const peers = (payload.peers as Array<{ id: string; name?: string; platform?: Platform }>) || [];
        for (const p of peers) {
          if (p.id !== this.deviceId) {
            this.roomPeers.set(p.id, {
              id: p.id,
              name: p.name || `Device (${p.id.slice(0, 4)})`,
              platform: p.platform || 'web',
              connType: 'Direct (internet)',
            });
          }
        }
        this.callbacks.onRoomJoined(code);
        if (this.roomPeers.size > 0) {
          this.callbacks.onRoomPeers(Array.from(this.roomPeers.values()));
        }
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
        this.callbacks.onClipboardReceived(fromName, content, ts);
        break;
      }

      case 'peer-joined-room': {
        const pId = payload.peerId as string;
        if (pId && pId !== this.deviceId) {
          this.roomPeers.set(pId, {
            id: pId,
            name: (payload.name as string) || `Device (${pId.slice(0, 4)})`,
            platform: 'web',
            connType: 'Direct (internet)',
          });
          this.callbacks.onRoomPeers(Array.from(this.roomPeers.values()));
        }
        break;
      }

      case 'signal': {
        if (!from) return;
        const bundle = this.getOrCreatePeerBundle(from);
        if (payload.signal) {
          bundle.peerSession.handleSignal(payload.signal as PeerSignal);
        }
        if (payload.ctl) {
          this.handleCtlMessage(from, payload.ctl);
        }
        break;
      }

      case 'relay-frame': {
        if (!from) return;
        const bundle = this.getOrCreatePeerBundle(from);
        void bundle.relayTransport.handleIncomingRelayFrame(payload.data as string);
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
    void trustManager.init();

    const orchestrator = new ConnectionLadderOrchestrator({
      onStatusChange: (_status, _detail) => {
        // live detail
      },
      onPathBadgeChange: (badge, _pathType) => {
        const peer = this.visiblePeers.get(remoteDeviceId) || this.roomPeers.get(remoteDeviceId);
        if (peer) {
          peer.connType = badge.toLowerCase().includes('direct') ? 'direct' : 'relay';
          this.callbacks.onPeersChanged(Array.from(this.visiblePeers.values()));
        }
      },
      onStats: (stats) => {
        const peer = this.visiblePeers.get(remoteDeviceId) || this.roomPeers.get(remoteDeviceId);
        if (peer) {
          peer.rttMs = stats.rttMs;
          peer.availableBitrateBps = stats.availableBitrateBps;
          this.callbacks.onPeersChanged(Array.from(this.visiblePeers.values()));
        }
      },
    });

    const peerSession = new PeerSession({
      localDeviceId: this.deviceId,
      remoteDeviceId,
      iceServers: this.iceServers as RTCIceServer[],
      onSignal: (signal) => {
        this.signaling?.send('signal', { signal }, remoteDeviceId);
      },
      onCtlMessage: (data) => {
        this.handleCtlMessage(remoteDeviceId, data);
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
    });

    relayTransport.onFrame((frame) => {
      this.handleDataFrame(frame);
    });

    bundle = {
      peerSession,
      orchestrator,
      trustManager,
      relayTransport,
    };

    this.peerBundles.set(remoteDeviceId, bundle);
    return bundle;
  }

  // -------------------------------------------------------------------------
  // Control Protocol Dispatch (ctl channel)
  // -------------------------------------------------------------------------
  private handleCtlMessage(remoteDeviceId: string, data: any) {
    if (!data || typeof data !== 'object') return;
    const { type, payload } = data;

    switch (type) {
      case 'request-transfer': {
        const req: IncomingRequest = {
          id: payload.transferId,
          transferId: payload.transferId,
          fromId: remoteDeviceId,
          fromName: (payload.senderName as string) || 'Nearby Peer',
          fromPlatform: (payload.senderPlatform as Platform) || 'web',
          meta: payload.meta as FileMeta,
          sasNumeric: payload.sasNumeric,
          sasEmoji: payload.sasEmoji,
          isTrusted: payload.isTrusted,
          receivedAt: Date.now(),
        };

        haptics.play('incomingRequest');
        this.callbacks.onIncomingRequest(req);
        break;
      }

      case 'accept-transfer': {
        const transferId = payload.transferId as string;
        const sender = this.activeSenders.get(transferId);
        if (sender) {
          const t = this.transferFiles.get(transferId);
          if (t) {
            t.status = 'in_progress';
            this.callbacks.onTransferUpdate(t);
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
          this.callbacks.onTransferUpdate(t);
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
        this.cancelTransfer(transferId);
        break;
      }

      case 'clipboard': {
        const senderPeer = this.visiblePeers.get(remoteDeviceId) || this.roomPeers.get(remoteDeviceId);
        this.callbacks.onClipboardReceived(
          senderPeer?.name || 'Device',
          payload.content as string,
          payload.timestamp as number
        );
        break;
      }

      default:
        break;
    }
  }

  private handleDataFrame(rawFrame: Uint8Array) {
    // Dispatch to receiver pipelines
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

    const sas = await bundle.trustManager.computeVerificationSAS(
      '00:11:22:33',
      '44:55:66:77',
      'pubA',
      'pubB'
    );

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
      status: 'pending',
      bytesTransferred: 0,
      peerId: peer.id,
      peerName: peer.name,
      channel: 'direct',
      createdAt: Date.now(),
    };
    this.transferFiles.set(transferId, transfer);
    this.callbacks.onTransferUpdate(transfer);

    const senderPipeline = new FileSenderPipeline(
      file,
      transferId,
      0,
      {
        sendDataChannel: (frame) => {
          if (bundle.peerSession.data.readyState === 'open') {
            bundle.peerSession.sendData(frame);
          } else {
            void bundle.relayTransport.send(frame);
          }
        },
        sendCtlMessage: (msg) => {
          bundle.peerSession.sendCtl(msg);
          if (bundle.peerSession.ctl.readyState !== 'open') {
            this.signaling?.send('signal', { ctl: msg }, peer.id);
          }
        },
        getBufferedAmount: () => bundle.peerSession.getBufferedAmount(),
        waitForBufferedAmountLow: () => bundle.peerSession.waitForBufferedAmountLow(),
        onAckedProgress: (acknowledgedBytes, _totalBytes, speedBps) => {
          transfer.bytesTransferred = acknowledgedBytes;
          transfer.speed = speedBps;
          transfer.status = 'in_progress';
          this.callbacks.onTransferUpdate(transfer);
        },
        onBlockCompleted: (_blockIndex) => {
          // Log progression
        },
        onFileCompleted: () => {
          transfer.status = 'completed';
          transfer.bytesTransferred = file.size;
          transfer.speed = 0;
          this.callbacks.onTransferUpdate(transfer);
          haptics.play('complete');
          this.activeSenders.delete(transferId);
        },
        onError: (err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
          this.callbacks.onTransferUpdate(transfer);
          haptics.play('error');
          this.activeSenders.delete(transferId);
        },
      },
      { chunkSize: DEFAULT_CHUNK_SIZE, blockSize: DEFAULT_BLOCK_SIZE }
    );

    this.activeSenders.set(transferId, senderPipeline);

    // Send transfer request to remote peer over ctl channel with signaling fallback
    const reqPayload = {
      type: 'request-transfer',
      payload: {
        transferId,
        senderName: this.deviceName,
        senderPlatform: this.platform,
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
    bundle.peerSession.sendCtl(reqPayload);
    if (bundle.peerSession.ctl.readyState !== 'open') {
      this.signaling?.send('signal', { ctl: reqPayload }, peer.id);
    }
  }

  public async respondToRequest(req: IncomingRequest, accept: boolean): Promise<void> {
    const bundle = this.getOrCreatePeerBundle(req.fromId);
    const transferId = req.transferId || req.id || '';
    const sendCtlSafe = (msg: unknown) => {
      bundle.peerSession.sendCtl(msg);
      if (bundle.peerSession.ctl.readyState !== 'open') {
        this.signaling?.send('signal', { ctl: msg }, req.fromId);
      }
    };

    if (!accept) {
      sendCtlSafe({
        type: 'decline-transfer',
        payload: { transferId },
      });
      return;
    }

    // 1. Check storage quota
    const quotaCheck = await checkStorageQuota(req.meta.size);
    if (!quotaCheck.sufficient) {
      this.callbacks.onError(quotaCheck.error || 'Insufficient storage quota');
      bundle.peerSession.sendCtl({
        type: 'decline-transfer',
        payload: { transferId, reason: 'E_QUOTA' },
      });
      return;
    }

    // 2. Pick optimal storage writer (FSA -> OPFS -> Memory)
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
      status: 'in_progress',
      bytesTransferred: 0,
      speed: 0,
      peerId: req.fromId,
      peerName: req.fromName,
      channel: 'direct',
      createdAt: Date.now(),
    };
    this.transferFiles.set(transferId, transfer);
    this.callbacks.onTransferUpdate(transfer);

    const totalBlocks = Math.max(1, Math.ceil(req.meta.size / DEFAULT_BLOCK_SIZE));
    const bitmap = new BlockBitmap(totalBlocks);
    this.transferBitmaps.set(transferId, bitmap);

    const receiverPipeline = new FileReceiverPipeline(
      transferId,
      req.meta.size,
      writer,
      {
        sendCtlMessage: (msg) => {
          sendCtlSafe(msg);
        },
        onProgress: (verifiedBytes, _totalBytes) => {
          transfer.bytesTransferred = verifiedBytes;
          transfer.progress = Math.round((verifiedBytes / req.meta.size) * 100);
          transfer.status = 'in_progress';
          this.callbacks.onTransferUpdate(transfer);
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
          if (output) {
            transfer.fileBlob = output;
            transfer.blobUrl = URL.createObjectURL(output);
          }
          this.callbacks.onTransferUpdate(transfer);
          haptics.play('complete');
          this.activeReceivers.delete(transferId);
          this.activeWriters.delete(transferId);
        },
        onError: (err) => {
          transfer.status = 'failed';
          transfer.error = err.message;
          this.callbacks.onTransferUpdate(transfer);
          haptics.play('error');
          this.activeReceivers.delete(transferId);
          this.activeWriters.delete(transferId);
        },
      },
      DEFAULT_BLOCK_SIZE
    );

    this.activeReceivers.set(transferId, receiverPipeline);

    // Accept transfer and issue initial flow control credits
    sendCtlSafe({
      type: 'accept-transfer',
      payload: { transferId },
    });
    sendCtlSafe({
      type: 'credit-grant',
      payload: { transferId, credits: DEFAULT_CREDIT_WINDOW_BLOCKS },
    });
  }

  public cancelTransfer(id: string) {
    const sender = this.activeSenders.get(id);
    if (sender) sender.cancel();

    const writer = this.activeWriters.get(id);
    if (writer) void writer.abort();

    const t = this.transferFiles.get(id);
    if (t) {
      t.status = 'cancelled';
      this.callbacks.onTransferUpdate(t);
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
      this.callbacks.onTransferUpdate(t);
    }
  }

  public resumeTransfer(id: string) {
    const sender = this.activeSenders.get(id);
    if (sender) sender.resume();

    const t = this.transferFiles.get(id);
    if (t) {
      t.status = 'in_progress';
      this.callbacks.onTransferUpdate(t);
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
    const payload = { content, timestamp: Date.now() };
    for (const [, bundle] of this.peerBundles) {
      bundle.peerSession.sendCtl({ type: 'clipboard', payload });
    }
    // Also notify via signaling for unestablished pairs
    this.signaling?.send('broadcast-clipboard', payload);
  }

  public sendDirectMessage(peerId: string, text: string) {
    const bundle = this.getOrCreatePeerBundle(peerId);
    bundle.peerSession.sendCtl({
      type: 'clipboard',
      payload: { content: text, timestamp: Date.now() },
    });
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
