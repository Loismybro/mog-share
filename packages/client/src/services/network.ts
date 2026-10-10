import type {
  ConnState,
  Device,
  FileMeta,
  IncomingRequest,
  Platform,
  TransferFile,
} from '../types';
import { deriveRoomKey, decryptChunk, decryptText, encryptChunk, encryptText, sha256Hex } from '../utils/crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CHUNK_SIZE = 16 * 1024; // T1: 16 KB — interoperable across browsers
const RELAY_CHUNK_SIZE = 48 * 1024; // relay path (base64 over WS)
const BUFFERED_LOW = 1 * 1024 * 1024; // T1 backpressure
const BUFFERED_HIGH = 4 * 1024 * 1024;
const ICE_TIMEOUT_MS = 8_000; // T1: fall back to relay after 8 s
const REQUEST_TIMEOUT_MS = 60_000; // T3: sender-side request expiry
const PROGRESS_THROTTLE_MS = 150; // T7
const SPEED_WINDOW_MS = 2_000; // T7: rolling speed window
const MAX_CONCURRENT_SENDS = 2; // T5
const HASH_CAP_BYTES = 64 * 1024 * 1024; // T2: hash files up to 64 MB
const STREAM_THRESHOLD = 64 * 1024 * 1024; // T6: offer save-to-disk above this
const RELAY_RECONNECT_WAIT_MS = 30_000; // F7: survive brief drops mid-relay

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
try {
  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
  if (turnUrl) {
    ICE_SERVERS.push({
      urls: turnUrl,
      username: (import.meta.env.VITE_TURN_USER as string) || undefined,
      credential: (import.meta.env.VITE_TURN_PASS as string) || undefined,
    });
  }
} catch { /* env not available */ }

// T6: minimal typings for the File System Access API
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}
interface WritableFileStream {
  write(data: ArrayBuffer | Blob): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
interface SaveFileHandle { createWritable(): Promise<WritableFileStream> }
type PickerWindow = Window & { showSaveFilePicker?: (opts: SaveFilePickerOptions) => Promise<SaveFileHandle> };

export function supportsStreamSave(): boolean {
  return typeof (window as PickerWindow).showSaveFilePicker === 'function';
}

// ---------------------------------------------------------------------------
// Storage helpers (D9: everything guarded for Safari private mode)
// ---------------------------------------------------------------------------
export function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

/** D9: stable device id — UUID in localStorage (never window.name). */
export function getPersistentDeviceId(): string {
  const existing = safeGet('mog_device_id');
  if (existing && /^[\w-]{8,64}$/.test(existing)) return existing;
  const id = (crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  safeSet('mog_device_id', id);
  return id;
}

export function regenerateDeviceId(): string {
  const id = crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  safeSet('mog_device_id', id);
  return id;
}

export function normalizeRoomCode(raw: string): string {
  const match = String(raw || '').match(/room=(\d{6})/);
  if (match) return match[1];
  return String(raw || '').replace(/\D/g, '').slice(0, 6);
}

// ---------------------------------------------------------------------------
// Callbacks consumed by the UI
// ---------------------------------------------------------------------------
export interface NetworkCallbacks {
  onStateChange: (state: ConnState, detail?: string) => void;
  onPeersChanged: (peers: Device[]) => void;
  onRoomCreated: (roomCode: string) => void;
  onRoomJoined: (roomCode: string) => void;
  onRoomLeft: () => void;
  onRoomPeers: (peers: Device[]) => void;
  onRoomError: (message: string) => void;
  onIncomingRequest: (request: IncomingRequest) => void;
  onTransferUpdate: (transfer: TransferFile) => void;
  onClipboardReceived: (fromDevice: string, content: string, timestamp: number) => void;
  onError: (message: string) => void;
}

interface SendJob {
  transfer: TransferFile;
  file: File;
  cancelled: boolean;
  started: boolean;
  requestTimer?: ReturnType<typeof setTimeout>;
  pc?: RTCPeerConnection;
  dc?: RTCDataChannel;
}

interface ReceiveJob {
  transfer: TransferFile;
  meta: FileMeta;
  chunks: (ArrayBuffer | null)[];
  receivedCount: number;
  receivedBytes: number;
  cancelled: boolean;
  pc?: RTCPeerConnection;
  // T6: streaming to disk
  writer?: WritableFileStream;
  writeChain: Promise<void>;
  expectedChunks: number;
}

// ---------------------------------------------------------------------------
// NetworkService
// ---------------------------------------------------------------------------
export class NetworkService {
  private deviceId: string;
  private deviceName: string;
  private platform: Platform;
  private cb: NetworkCallbacks;

  private ws: WebSocket | null = null;
  private state: ConnState = 'idle';
  private destroyed = false;

  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectNonce = 0;

  private customServerUrl: string | null;
  private candidateIndex = 0;
  private activeUrl: string | null = null;

  private peers = new Map<string, Device>();
  private roomPeers = new Map<string, Device>();
  private currentRoomCode: string | null = null;

  // F8: optional room passphrase → AES-GCM key for relay chunks + clipboard
  private passphrase: string | null = null;
  private roomKey: CryptoKey | null = null;

  // F10: latency
  private lastPingSentAt = 0;
  private lastLatencyMs: number | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  // R2: queue room actions until the connection is ready
  private pendingActions: Array<() => void> = [];

  private sendJobs = new Map<string, SendJob>();
  private receiveJobs = new Map<string, ReceiveJob>();
  private lastProgressEmit = new Map<string, number>();
  private speedSamples = new Map<string, Array<{ t: number; bytes: number }>>();

  // T5: at most 2 concurrent sends; the rest wait here
  private runningSends = 0;
  private acceptedQueue: SendJob[] = [];

  private visibilityHandler = () => {
    if (document.visibilityState === 'visible' && this.state !== 'ready') this.reconnectNow();
  };
  private onlineHandler = () => this.reconnectNow();
  private pagehideHandler = () => {
    // R8: best-effort leave on tab close
    try {
      if (this.ws?.readyState === WebSocket.OPEN && this.currentRoomCode) {
        this.ws.send(JSON.stringify({ type: 'leave-room', payload: {} }));
      }
    } catch { /* closing anyway */ }
  };

  constructor(deviceName: string, platform: Platform, callbacks: NetworkCallbacks, customServerUrl?: string | null) {
    this.deviceId = getPersistentDeviceId();
    this.deviceName = deviceName;
    this.platform = platform;
    this.cb = callbacks;
    this.customServerUrl = customServerUrl || null;

    window.addEventListener('visibilitychange', this.visibilityHandler);
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('pagehide', this.pagehideHandler);

    // F10: measure latency every 30 s while connected
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.lastPingSentAt = Date.now();
        this.send('ping', {});
      }
    }, 30_000);

    void this.connect();
  }

  // -------------------------------------------------------------------------
  // Connection management (D2, D3, D4)
  // -------------------------------------------------------------------------

  /** D2: candidate URL list — query param, settings, env, same-origin. */
  private getCandidateUrls(): string[] {
    const urls: string[] = [];
    try {
      const qs = new URLSearchParams(window.location.search).get('ws');
      if (qs) urls.push(qs);
    } catch { /* ignore */ }
    if (this.customServerUrl) urls.push(this.normalizeWsUrl(this.customServerUrl));
    try {
      const env = import.meta.env.VITE_WS_URL as string | undefined;
      if (env) urls.push(this.normalizeWsUrl(env));
    } catch { /* ignore */ }
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    urls.push(`${proto}://${window.location.host}/ws`);
    return Array.from(new Set(urls.filter(Boolean)));
  }

  private normalizeWsUrl(raw: string): string {
    let u = raw.trim();
    if (!u) return u;
    if (u.startsWith('https://')) u = 'wss://' + u.slice(8);
    else if (u.startsWith('http://')) u = 'ws://' + u.slice(7);
    else if (!u.startsWith('ws://') && !u.startsWith('wss://')) u = 'wss://' + u;
    if (!/\/ws\/?$/.test(new URL(u).pathname)) {
      u = u.replace(/\/?$/, '') + '/ws';
    }
    return u;
  }

  /** D3: wake a sleeping free-tier instance before connecting. */
  private wakeServer(wsUrl: string) {
    try {
      const httpUrl = wsUrl.replace(/^ws/, 'http').replace(/\/ws\/?$/, '') + '/api/health';
      void fetch(httpUrl, { mode: 'cors', cache: 'no-store' }).catch(() => undefined);
    } catch { /* best effort */ }
  }

  private setState(state: ConnState, detail?: string) {
    this.state = state;
    this.cb.onStateChange(state, detail);
  }

  public getState(): ConnState { return this.state; }
  public getDeviceId(): string { return this.deviceId; }
  public getActiveUrl(): string | null { return this.activeUrl; }
  public getRoomCode(): string | null { return this.currentRoomCode; }
  public getLatencyMs(): number | null { return this.lastLatencyMs; }
  public hasRoomKey(): boolean { return this.roomKey !== null; }

  private async connect() {
    if (this.destroyed) return;
    const nonce = ++this.connectNonce;
    const candidates = this.getCandidateUrls();
    this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      this.reconnectAttempt > 2 ? 'Waking up server…' : undefined);

    for (let i = 0; i < candidates.length; i++) {
      if (this.destroyed || nonce !== this.connectNonce) return;
      const url = candidates[(this.candidateIndex + i) % candidates.length];
      this.wakeServer(url);
      // D3: generous timeout — a cold Render instance needs 30–60 s
      const isRemote = !url.includes(window.location.host);
      const timeout = isRemote ? 20_000 : 6_000;
      const ok = await this.tryConnect(url, timeout, nonce);
      if (ok) {
        this.candidateIndex = (this.candidateIndex + i) % candidates.length;
        return;
      }
    }
    this.scheduleReconnect();
  }

  private tryConnect(url: string, timeoutMs: number, nonce: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch { /* noop */ }
          resolve(false);
        }
      }, timeoutMs);

      ws.onopen = () => {
        if (settled || nonce !== this.connectNonce) { try { ws.close(); } catch { /* noop */ } return; }
        settled = true;
        clearTimeout(timer);
        this.attachSocket(ws, url);
        resolve(true);
      };
      ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(false); }
      };
      ws.onclose = () => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(false); }
      };
    });
  }

  private attachSocket(ws: WebSocket, url: string) {
    this.ws = ws;
    this.activeUrl = url;
    this.reconnectAttempt = 0;

    ws.onmessage = (ev) => {
      try { this.handleMessage(JSON.parse(ev.data)); } catch { /* ignore malformed */ }
    };
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        if (!this.destroyed) {
          this.setState('reconnecting');
          this.scheduleReconnect(); // D4: actually reconnect
        }
      }
    };
    ws.onerror = () => { /* close handler drives reconnect */ };

    this.register();
  }

  private register() {
    this.send('register', { id: this.deviceId, name: this.deviceName, platform: this.platform });
  }

  /** D4: exponential backoff 1 s → 15 s. */
  private scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 15_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  public reconnectNow() {
    if (this.destroyed || this.state === 'ready' || this.state === 'connecting') return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    void this.connect();
  }

  private send(type: string, payload: unknown): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }

  /** R2: run now when ready, otherwise queue until ready. */
  private whenReady(action: () => void) {
    if (this.state === 'ready') action();
    else {
      this.pendingActions.push(action);
      this.reconnectNow();
    }
  }

  private flushPending() {
    const actions = this.pendingActions.splice(0);
    for (const a of actions) a();
  }

  // -------------------------------------------------------------------------
  // Server messages
  // -------------------------------------------------------------------------
  private handleMessage(msg: { type: string; payload: Record<string, unknown> }) {
    const { type, payload } = msg;
    switch (type) {
      case 'pong': {
        if (this.lastPingSentAt) {
          this.lastLatencyMs = Date.now() - this.lastPingSentAt;
        }
        break;
      }
      case 'peers-snapshot': {
        this.peers.clear();
        for (const p of (payload.peers as Device[]) || []) this.peers.set(p.id, p);
        this.emitPeers();
        // Registration acknowledged — connection is fully ready
        this.setState('ready');
        // F10: immediate latency sample
        this.lastPingSentAt = Date.now();
        this.send('ping', {});
        // D4: re-join room after reconnect
        if (this.currentRoomCode) {
          this.send('join-room', { roomCode: this.currentRoomCode });
        }
        this.flushPending();
        break;
      }
      case 'id-conflict': {
        // D9: another live tab owns this id — regenerate and re-register
        this.deviceId = regenerateDeviceId();
        this.register();
        break;
      }
      case 'device-discovered': {
        const device = payload.device as Device;
        if (device?.id && device.id !== this.deviceId) {
          this.peers.set(device.id, device);
          this.emitPeers();
        }
        break;
      }
      case 'device-departed': {
        const id = payload.deviceId as string;
        if (this.peers.delete(id)) this.emitPeers();
        break;
      }
      case 'room-created': {
        this.currentRoomCode = payload.roomCode as string;
        this.roomPeers.clear();
        void this.refreshRoomKey();
        this.cb.onRoomCreated(this.currentRoomCode);
        break;
      }
      case 'room-joined': {
        this.currentRoomCode = payload.roomCode as string;
        void this.refreshRoomKey();
        this.cb.onRoomJoined(this.currentRoomCode);
        break;
      }
      case 'room-peers': {
        this.roomPeers.clear();
        for (const p of (payload.peers as Device[]) || []) this.roomPeers.set(p.id, p);
        this.cb.onRoomPeers(Array.from(this.roomPeers.values()));
        break;
      }
      case 'peer-joined-room': {
        const peer = payload.peer as Device;
        if (peer?.id) {
          this.roomPeers.set(peer.id, peer);
          this.cb.onRoomPeers(Array.from(this.roomPeers.values()));
        }
        break;
      }
      case 'peer-left-room': {
        if (this.roomPeers.delete(payload.peerId as string)) {
          this.cb.onRoomPeers(Array.from(this.roomPeers.values()));
        }
        break;
      }
      case 'room-left': {
        this.currentRoomCode = null;
        this.roomPeers.clear();
        this.roomKey = null;
        this.cb.onRoomLeft();
        break;
      }
      case 'room-error': {
        // R3: reset stale state on failure
        this.cb.onRoomError((payload.message as string) || 'Room error');
        break;
      }
      case 'signal': {
        void this.handleSignal(payload.fromId as string, payload.data as Record<string, unknown>);
        break;
      }
      case 'transfer-request': {
        const meta = payload.meta as FileMeta;
        const transferId = payload.transferId as string;
        const fromId = payload.fromId as string;
        const fromName = (payload.fromName as string) || 'Unknown device';
        if (!meta || !transferId || !fromId) return;
        this.cb.onIncomingRequest({ transferId, fromId, fromName, meta, receivedAt: Date.now() });
        break;
      }
      case 'transfer-response': {
        const transferId = payload.transferId as string;
        const accepted = Boolean(payload.accepted);
        const job = this.sendJobs.get(transferId);
        if (!job || job.started) return;
        if (job.requestTimer) clearTimeout(job.requestTimer);
        if (!accepted) {
          job.transfer.status = 'declined';
          this.emitTransfer(job.transfer, true);
          this.sendJobs.delete(transferId);
          return;
        }
        job.started = true;
        this.enqueueSend(job); // T5: concurrency-limited queue
        break;
      }
      case 'file-chunk': {
        void this.handleRelayChunk(payload);
        break;
      }
      case 'transfer-complete': {
        const job = this.receiveJobs.get(payload.transferId as string);
        if (job) void this.finalizeReceive(job);
        break;
      }
      case 'transfer-cancel': {
        this.handleRemoteCancel(payload.transferId as string);
        break;
      }
      case 'clipboard-received': {
        void this.handleClipboard(payload);
        break;
      }
      case 'direct-message': {
        // F2: targeted text/link message — surfaced through the clipboard feed
        this.cb.onClipboardReceived(
          (payload.fromName as string) || 'Unknown',
          (payload.content as string) || '',
          Date.now()
        );
        break;
      }
      case 'error': {
        this.cb.onError((payload.message as string) || 'Server error');
        break;
      }
      default:
        break;
    }
  }

  private async handleClipboard(payload: Record<string, unknown>) {
    const from = (payload.fromDevice as string) || 'Unknown';
    const ts = (payload.timestamp as number) || Date.now();
    let content = (payload.content as string) || '';
    if (payload.enc) {
      if (this.roomKey) {
        try {
          content = await decryptText(this.roomKey, content);
        } catch {
          content = '[Encrypted — wrong or missing room passphrase]';
        }
      } else {
        content = '[Encrypted — set the room passphrase in the Room tab to read]';
      }
    }
    this.cb.onClipboardReceived(from, content, ts);
  }

  private emitPeers() {
    this.cb.onPeersChanged(Array.from(this.peers.values()));
  }

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------
  public updateProfile(name: string, platform: Platform) {
    this.deviceName = name;
    this.platform = platform;
    if (this.state === 'ready') this.register();
  }

  public setCustomServerUrl(url: string | null) {
    this.customServerUrl = url;
    this.candidateIndex = 0;
    try { this.ws?.close(); } catch { /* noop */ }
  }

  // -------------------------------------------------------------------------
  // Rooms (R2, R3) + passphrase (F8)
  // -------------------------------------------------------------------------
  public createRoom() {
    this.whenReady(() => this.send('create-room', {}));
  }

  public joinRoom(rawCode: string) {
    const code = normalizeRoomCode(rawCode);
    if (code.length !== 6) {
      this.cb.onRoomError('Enter the 6-digit room code.');
      return;
    }
    this.whenReady(() => this.send('join-room', { roomCode: code }));
  }

  public leaveRoom() {
    const hadRoom = this.currentRoomCode;
    this.currentRoomCode = null;
    this.roomPeers.clear();
    this.roomKey = null;
    if (hadRoom) this.send('leave-room', {});
    this.cb.onRoomLeft();
  }

  /** F8: set/clear the shared room passphrase (both sides must match). */
  public async setRoomPassphrase(passphrase: string | null) {
    this.passphrase = passphrase && passphrase.length > 0 ? passphrase : null;
    await this.refreshRoomKey();
  }

  private async refreshRoomKey() {
    if (this.passphrase && this.currentRoomCode) {
      this.roomKey = await deriveRoomKey(this.passphrase, this.currentRoomCode);
    } else {
      this.roomKey = null;
    }
  }

  // -------------------------------------------------------------------------
  // Clipboard & direct messages
  // -------------------------------------------------------------------------
  public broadcastClipboard(content: string) {
    this.whenReady(() => {
      void (async () => {
        if (this.roomKey) {
          try {
            const enc = await encryptText(this.roomKey, content);
            this.send('clipboard-broadcast', { content: enc, enc: true });
            return;
          } catch { /* fall through to plain */ }
        }
        this.send('clipboard-broadcast', { content });
      })();
    });
  }

  /** F2: send a text/link to a single device. */
  public sendDirectMessage(targetId: string, content: string) {
    this.whenReady(() => this.send('direct-message', { targetId, content }));
  }

  // -------------------------------------------------------------------------
  // Transfers — sender side
  // -------------------------------------------------------------------------
  public sendFile(peer: Device, file: File): TransferFile {
    const transferId = crypto.randomUUID ? crypto.randomUUID() : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const transfer: TransferFile = {
      id: transferId,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      progress: 0,
      speedBytesPerSec: 0,
      etaSeconds: Infinity,
      status: 'waiting',
      direction: 'sending',
      peerId: peer.id,
      peerName: peer.name,
      createdAt: Date.now(),
    };
    const job: SendJob = { transfer, file, cancelled: false, started: false };
    this.sendJobs.set(transferId, job);

    const meta: FileMeta = {
      name: file.name,
      size: file.size,
      type: transfer.type,
      totalChunks: Math.max(1, Math.ceil(file.size / CHUNK_SIZE)),
    };

    this.whenReady(() => {
      void (async () => {
        if (job.cancelled) return;
        // T2: optional SHA-256 for integrity (small/medium files)
        if (file.size > 0 && file.size <= HASH_CAP_BYTES) {
          try {
            const buf = await file.arrayBuffer();
            meta.sha256 = (await sha256Hex(buf)) || undefined;
          } catch { /* hashing is optional */ }
        }
        if (job.cancelled) return;
        this.send('transfer-request', { targetId: peer.id, transferId, meta });
        // T3: expire unanswered requests after 60 s
        job.requestTimer = setTimeout(() => {
          if (!job.started && !job.cancelled) {
            job.transfer.status = 'expired';
            this.emitTransfer(job.transfer, true);
            this.sendJobs.delete(transferId);
          }
        }, REQUEST_TIMEOUT_MS);
      })();
    });

    this.emitTransfer(transfer, true);
    return transfer;
  }

  /** T5: cap concurrency at 2; extra accepted sends wait in a FIFO. */
  private enqueueSend(job: SendJob) {
    if (this.runningSends < MAX_CONCURRENT_SENDS) {
      this.runningSends += 1;
      void this.runSendJob(job).finally(() => {
        this.runningSends -= 1;
        this.dequeueSend();
      });
    } else {
      job.transfer.status = 'waiting';
      this.emitTransfer(job.transfer, true);
      this.acceptedQueue.push(job);
    }
  }

  private dequeueSend() {
    while (this.acceptedQueue.length && this.runningSends < MAX_CONCURRENT_SENDS) {
      const next = this.acceptedQueue.shift()!;
      if (next.cancelled) continue;
      this.runningSends += 1;
      void this.runSendJob(next).finally(() => {
        this.runningSends -= 1;
        this.dequeueSend();
      });
    }
  }

  private async runSendJob(job: SendJob) {
    const { transfer } = job;
    if (job.cancelled) return;
    transfer.status = 'connecting';
    this.emitTransfer(transfer, true);

    // T1: try WebRTC first
    const dc = await this.openDataChannel(job).catch(() => null);
    if (job.cancelled) return;

    if (dc) {
      transfer.channel = 'direct';
      this.emitTransfer(transfer, true);
      await this.sendViaDataChannel(job, dc);
    } else {
      transfer.channel = 'relay';
      this.emitTransfer(transfer, true);
      await this.sendViaRelay(job);
    }
  }

  private openDataChannel(job: SendJob): Promise<RTCDataChannel | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (dc: RTCDataChannel | null) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(dc); }
      };
      let pc: RTCPeerConnection;
      try {
        pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      } catch {
        resolve(null);
        return;
      }
      job.pc = pc;
      const timer = setTimeout(() => {
        try { pc.close(); } catch { /* noop */ }
        finish(null);
      }, ICE_TIMEOUT_MS);

      const dc = pc.createDataChannel(`t-${job.transfer.id}`, { ordered: true });
      dc.binaryType = 'arraybuffer';
      dc.bufferedAmountLowThreshold = BUFFERED_LOW;
      dc.onopen = () => { job.dc = dc; finish(dc); };
      dc.onerror = () => finish(null);

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          this.send('signal', {
            targetId: job.transfer.peerId,
            data: { kind: 'ice', transferId: job.transfer.id, candidate: ev.candidate.toJSON() },
          });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') finish(null);
      };

      void (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.send('signal', {
            targetId: job.transfer.peerId,
            data: { kind: 'offer', transferId: job.transfer.id, sdp: pc.localDescription },
          });
        } catch {
          finish(null);
        }
      })();
    });
  }

  private async handleSignal(fromId: string, data: Record<string, unknown>) {
    const kind = data?.kind as string;
    const transferId = data?.transferId as string;
    if (!kind || !transferId) return;

    if (kind === 'offer') {
      const job = this.receiveJobs.get(transferId);
      if (!job) return;
      let pc = job.pc;
      if (!pc) {
        try {
          pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        } catch { return; }
        job.pc = pc;
        pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            this.send('signal', {
              targetId: fromId,
              data: { kind: 'ice', transferId, candidate: ev.candidate.toJSON() },
            });
          }
        };
        pc.ondatachannel = (ev) => {
          const dc = ev.channel;
          dc.binaryType = 'arraybuffer';
          job.transfer.channel = 'direct';
          job.transfer.status = 'transferring';
          this.emitTransfer(job.transfer, true);
          dc.onmessage = (mev) => this.handleChannelMessage(job, mev.data);
        };
      }
      try {
        await pc.setRemoteDescription(data.sdp as RTCSessionDescriptionInit);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send('signal', {
          targetId: fromId,
          data: { kind: 'answer', transferId, sdp: pc.localDescription },
        });
      } catch { /* fall back to relay */ }
    } else if (kind === 'answer') {
      const job = this.sendJobs.get(transferId);
      if (!job?.pc) return;
      try { await job.pc.setRemoteDescription(data.sdp as RTCSessionDescriptionInit); } catch { /* noop */ }
    } else if (kind === 'ice') {
      const job = this.sendJobs.get(transferId) || this.receiveJobs.get(transferId);
      if (!job?.pc) return;
      try { await job.pc.addIceCandidate(data.candidate as RTCIceCandidateInit); } catch { /* noop */ }
    }
  }

  private async sendViaDataChannel(job: SendJob, dc: RTCDataChannel) {
    const { transfer, file } = job;
    transfer.status = 'transferring';
    this.emitTransfer(transfer, true);

    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    try {
      dc.send(JSON.stringify({ kind: 'meta', name: file.name, size: file.size, type: transfer.type, totalChunks }));

      let sent = 0;
      for (let i = 0; i < totalChunks; i++) {
        if (job.cancelled) return;
        if (dc.readyState !== 'open') throw new Error('Channel closed');

        // T1 backpressure
        if (dc.bufferedAmount > BUFFERED_HIGH) {
          await new Promise<void>((res) => {
            const onLow = () => { dc.removeEventListener('bufferedamountlow', onLow); res(); };
            dc.addEventListener('bufferedamountlow', onLow);
            setTimeout(() => { dc.removeEventListener('bufferedamountlow', onLow); res(); }, 2000);
          });
        }

        const slice = file.slice(i * CHUNK_SIZE, Math.min(file.size, (i + 1) * CHUNK_SIZE));
        const buf = await slice.arrayBuffer(); // T7: no base64
        dc.send(buf);
        sent += buf.byteLength;
        this.trackProgress(transfer, sent);
      }
      if (job.cancelled) return;
      dc.send(JSON.stringify({ kind: 'done' }));
      transfer.progress = 100;
      transfer.status = 'completed';
      transfer.speedBytesPerSec = 0;
      this.emitTransfer(transfer, true);
      this.cleanupSendJob(job, 3000);
    } catch {
      if (!job.cancelled) {
        // Direct path broke mid-flight — fall back to relay from scratch
        transfer.channel = 'relay';
        transfer.progress = 0;
        this.emitTransfer(transfer, true);
        await this.sendViaRelay(job);
      }
    }
  }

  /** F7: wait (up to 30 s) for the socket to come back instead of failing. */
  private async waitForSocket(job: SendJob): Promise<boolean> {
    const deadline = Date.now() + RELAY_RECONNECT_WAIT_MS;
    while (Date.now() < deadline) {
      if (job.cancelled || this.destroyed) return false;
      if (this.ws?.readyState === WebSocket.OPEN && this.state === 'ready') return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  private async sendViaRelay(job: SendJob) {
    const { transfer, file } = job;
    transfer.status = 'transferring';
    this.emitTransfer(transfer, true);

    const totalChunks = Math.max(1, Math.ceil(file.size / RELAY_CHUNK_SIZE));
    let sent = 0;
    for (let i = 0; i < totalChunks; i++) {
      if (job.cancelled) return;
      if (this.ws?.readyState !== WebSocket.OPEN) {
        // F7: relay transfers survive brief reconnects
        const recovered = await this.waitForSocket(job);
        if (!recovered) {
          if (job.cancelled) return;
          transfer.status = 'failed';
          transfer.error = 'Connection lost during transfer';
          this.emitTransfer(transfer, true);
          return;
        }
      }
      const slice = file.slice(i * RELAY_CHUNK_SIZE, Math.min(file.size, (i + 1) * RELAY_CHUNK_SIZE));
      let buf = await slice.arrayBuffer();
      let enc = false;
      // F8: encrypt relay chunks when a room passphrase is set
      if (this.roomKey) {
        try {
          buf = await encryptChunk(this.roomKey, buf);
          enc = true;
        } catch { /* send plain if encryption fails */ }
      }
      const b64 = arrayBufferToBase64(buf);
      this.send('file-chunk', {
        targetId: transfer.peerId,
        transferId: transfer.id,
        chunkIndex: i,
        totalChunks,
        enc,
        data: b64,
      });
      sent += slice.size;
      this.trackProgress(transfer, sent);
      // Gentle pacing so we never hit the server's 1 MB frame cap or flood it
      if (this.ws && this.ws.bufferedAmount > BUFFERED_HIGH) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    if (job.cancelled) return;
    this.send('transfer-complete', { targetId: transfer.peerId, transferId: transfer.id });
    transfer.progress = 100;
    transfer.status = 'completed';
    transfer.speedBytesPerSec = 0;
    this.emitTransfer(transfer, true);
    this.cleanupSendJob(job, 3000);
  }

  // -------------------------------------------------------------------------
  // Transfers — receiver side
  // -------------------------------------------------------------------------
  public respondToRequest(request: IncomingRequest, accepted: boolean) {
    if (!accepted) {
      this.send('transfer-response', { targetId: request.fromId, transferId: request.transferId, accepted: false });
      return;
    }

    const transfer: TransferFile = {
      id: request.transferId,
      name: request.meta.name,
      size: request.meta.size,
      type: request.meta.type,
      progress: 0,
      speedBytesPerSec: 0,
      etaSeconds: Infinity,
      status: 'connecting',
      direction: 'receiving',
      peerId: request.fromId,
      peerName: request.fromName,
      createdAt: Date.now(),
    };
    const job: ReceiveJob = {
      transfer,
      meta: request.meta,
      chunks: [],
      receivedCount: 0,
      receivedBytes: 0,
      cancelled: false,
      writeChain: Promise.resolve(),
      expectedChunks: 0,
    };
    this.receiveJobs.set(request.transferId, job);
    this.emitTransfer(transfer, true);

    // T6: large files — stream straight to disk where supported.
    // showSaveFilePicker needs a user gesture, so call it synchronously here
    // (this method runs inside the Accept click handler).
    const picker = (window as PickerWindow).showSaveFilePicker;
    if (picker && request.meta.size >= STREAM_THRESHOLD) {
      picker({ suggestedName: request.meta.name })
        .then((handle) => handle.createWritable())
        .then((writer) => {
          if (job.cancelled) { void writer.abort(); return; }
          job.writer = writer;
          job.transfer.savedToDisk = true;
          this.send('transfer-response', { targetId: request.fromId, transferId: request.transferId, accepted: true });
        })
        .catch(() => {
          // User dismissed the picker or API failed — fall back to memory
          if (!job.cancelled) {
            this.send('transfer-response', { targetId: request.fromId, transferId: request.transferId, accepted: true });
          }
        });
      return;
    }

    this.send('transfer-response', { targetId: request.fromId, transferId: request.transferId, accepted: true });
  }

  private handleChannelMessage(job: ReceiveJob, data: unknown) {
    if (job.cancelled) return;
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        if (msg.kind === 'meta') {
          job.meta = { ...job.meta, name: msg.name, size: msg.size, type: msg.type, totalChunks: msg.totalChunks };
          job.expectedChunks = msg.totalChunks;
          if (!job.writer) job.chunks = new Array(msg.totalChunks).fill(null);
        } else if (msg.kind === 'done') {
          void this.finalizeReceive(job);
        }
      } catch { /* ignore */ }
      return;
    }
    const buf = data as ArrayBuffer;
    if (job.writer) {
      // T6: stream sequential chunks straight to disk
      job.writeChain = job.writeChain.then(() => job.writer!.write(buf)).catch(() => undefined);
    } else {
      job.chunks[job.receivedCount] = buf;
    }
    job.receivedCount += 1;
    job.receivedBytes += buf.byteLength;
    job.transfer.status = 'transferring';
    this.trackProgress(job.transfer, job.receivedBytes);
  }

  private async handleRelayChunk(payload: Record<string, unknown>) {
    const transferId = payload.transferId as string;
    const job = this.receiveJobs.get(transferId);
    if (!job || job.cancelled) return;
    const chunkIndex = payload.chunkIndex as number;
    const totalChunks = payload.totalChunks as number;
    if (job.expectedChunks !== totalChunks) {
      job.expectedChunks = totalChunks;
      if (!job.writer) job.chunks = new Array(totalChunks).fill(null);
    }

    let buf = base64ToArrayBuffer(payload.data as string);
    if (payload.enc) {
      if (!this.roomKey) {
        this.failReceive(job, 'Encrypted transfer — set the room passphrase first');
        return;
      }
      try {
        buf = await decryptChunk(this.roomKey, buf);
      } catch {
        this.failReceive(job, 'Wrong room passphrase — could not decrypt');
        return;
      }
    }

    if (job.writer) {
      // Relay chunks arrive in order over the WS; chain writes sequentially
      job.writeChain = job.writeChain.then(() => job.writer!.write(buf)).catch(() => undefined);
      job.receivedCount += 1;
      job.receivedBytes += buf.byteLength;
    } else if (job.chunks[chunkIndex] == null) {
      job.chunks[chunkIndex] = buf;
      job.receivedCount += 1;
      job.receivedBytes += buf.byteLength;
    }
    job.transfer.channel = 'relay';
    job.transfer.status = 'transferring';
    this.trackProgress(job.transfer, job.receivedBytes);
  }

  private failReceive(job: ReceiveJob, reason: string) {
    if (job.cancelled) return;
    job.cancelled = true;
    job.transfer.status = 'failed';
    job.transfer.error = reason;
    this.emitTransfer(job.transfer, true);
    this.send('transfer-cancel', { targetId: job.transfer.peerId, transferId: job.transfer.id });
    if (job.writer) void job.writer.abort().catch(() => undefined);
    this.cleanupReceiveJob(job);
  }

  /** T2: integrity — all chunks present AND byte length matches, or fail. */
  private async finalizeReceive(job: ReceiveJob) {
    const { transfer, meta } = job;
    if (transfer.status === 'completed' || transfer.status === 'failed') return;

    if (job.writer) {
      // T6: streamed path — verify byte count, then close the file
      await job.writeChain;
      if (job.receivedBytes !== meta.size) {
        transfer.status = 'failed';
        transfer.error = 'File incomplete — some data was lost in transit';
        this.emitTransfer(transfer, true);
        void job.writer.abort().catch(() => undefined);
        this.cleanupReceiveJob(job);
        return;
      }
      await job.writer.close().catch(() => undefined);
      transfer.progress = 100;
      transfer.status = 'completed';
      transfer.speedBytesPerSec = 0;
      this.emitTransfer(transfer, true);
      this.cleanupReceiveJob(job, true);
      return;
    }

    const expectedChunks = job.chunks.length;
    const missing = job.receivedCount !== expectedChunks || job.chunks.some((c) => c == null);
    if (missing || job.receivedBytes !== meta.size) {
      transfer.status = 'failed';
      transfer.error = 'File incomplete — some data was lost in transit';
      this.emitTransfer(transfer, true);
      this.cleanupReceiveJob(job);
      return;
    }
    const blob = new Blob(job.chunks as ArrayBuffer[], { type: meta.type || 'application/octet-stream' });

    // T2: verify SHA-256 when the sender provided one
    if (meta.sha256 && meta.size <= HASH_CAP_BYTES) {
      try {
        const actual = await sha256Hex(await blob.arrayBuffer());
        if (actual && actual !== meta.sha256) {
          transfer.status = 'failed';
          transfer.error = 'Integrity check failed (SHA-256 mismatch)';
          this.emitTransfer(transfer, true);
          this.cleanupReceiveJob(job);
          return;
        }
      } catch { /* verification is best-effort */ }
    }

    transfer.blobUrl = URL.createObjectURL(blob);
    transfer.progress = 100;
    transfer.status = 'completed';
    transfer.speedBytesPerSec = 0;
    this.emitTransfer(transfer, true);
    job.chunks = [];
    this.cleanupReceiveJob(job, true);
  }

  // -------------------------------------------------------------------------
  // Cancel (T4 — both directions)
  // -------------------------------------------------------------------------
  public cancelTransfer(transferId: string) {
    const sendJob = this.sendJobs.get(transferId);
    if (sendJob) {
      sendJob.cancelled = true;
      if (sendJob.requestTimer) clearTimeout(sendJob.requestTimer);
      this.send('transfer-cancel', { targetId: sendJob.transfer.peerId, transferId });
      sendJob.transfer.status = 'cancelled';
      sendJob.transfer.speedBytesPerSec = 0;
      this.emitTransfer(sendJob.transfer, true);
      this.cleanupSendJob(sendJob, 0);
      return;
    }
    const recvJob = this.receiveJobs.get(transferId);
    if (recvJob) {
      recvJob.cancelled = true;
      this.send('transfer-cancel', { targetId: recvJob.transfer.peerId, transferId });
      recvJob.transfer.status = 'cancelled';
      recvJob.transfer.speedBytesPerSec = 0;
      this.emitTransfer(recvJob.transfer, true);
      if (recvJob.writer) void recvJob.writer.abort().catch(() => undefined);
      this.cleanupReceiveJob(recvJob);
    }
  }

  public declinePending(fromId: string, transferId: string) {
    this.send('transfer-response', { targetId: fromId, transferId, accepted: false });
  }

  private handleRemoteCancel(transferId: string) {
    const sendJob = this.sendJobs.get(transferId);
    if (sendJob) {
      sendJob.cancelled = true; // T4: actually stop the streaming loop
      if (sendJob.requestTimer) clearTimeout(sendJob.requestTimer);
      sendJob.transfer.status = 'cancelled';
      sendJob.transfer.error = 'Cancelled by receiver';
      sendJob.transfer.speedBytesPerSec = 0;
      this.emitTransfer(sendJob.transfer, true);
      this.cleanupSendJob(sendJob, 0);
    }
    const recvJob = this.receiveJobs.get(transferId);
    if (recvJob) {
      recvJob.cancelled = true;
      recvJob.transfer.status = 'cancelled';
      recvJob.transfer.error = 'Cancelled by sender';
      recvJob.transfer.speedBytesPerSec = 0;
      this.emitTransfer(recvJob.transfer, true);
      if (recvJob.writer) void recvJob.writer.abort().catch(() => undefined);
      this.cleanupReceiveJob(recvJob);
    }
  }

  private cleanupSendJob(job: SendJob, delayMs: number) {
    setTimeout(() => {
      try { job.dc?.close(); } catch { /* noop */ }
      try { job.pc?.close(); } catch { /* noop */ }
      this.sendJobs.delete(job.transfer.id);
    }, delayMs);
  }

  private cleanupReceiveJob(job: ReceiveJob, keepEntry = false) {
    setTimeout(() => {
      try { job.pc?.close(); } catch { /* noop */ }
      if (!keepEntry) this.receiveJobs.delete(job.transfer.id);
    }, 1000);
  }

  // -------------------------------------------------------------------------
  // Progress / speed (T7)
  // -------------------------------------------------------------------------
  private trackProgress(transfer: TransferFile, bytesDone: number) {
    const now = Date.now();
    const samples = this.speedSamples.get(transfer.id) || [];
    samples.push({ t: now, bytes: bytesDone });
    while (samples.length > 2 && samples[0].t < now - SPEED_WINDOW_MS) samples.shift();
    this.speedSamples.set(transfer.id, samples);

    const first = samples[0];
    const dt = (now - first.t) / 1000;
    const speed = dt > 0.2 ? (bytesDone - first.bytes) / dt : 0;

    transfer.progress = transfer.size > 0 ? Math.min(100, (bytesDone / transfer.size) * 100) : 100;
    transfer.speedBytesPerSec = Math.max(0, speed);
    transfer.etaSeconds = speed > 0 ? (transfer.size - bytesDone) / speed : Infinity;

    const last = this.lastProgressEmit.get(transfer.id) || 0;
    if (now - last >= PROGRESS_THROTTLE_MS) {
      this.lastProgressEmit.set(transfer.id, now);
      this.emitTransfer(transfer, false);
    }
  }

  private emitTransfer(transfer: TransferFile, force: boolean) {
    if (force) this.lastProgressEmit.set(transfer.id, Date.now());
    this.cb.onTransferUpdate({ ...transfer });
  }

  // -------------------------------------------------------------------------
  // Teardown (R8)
  // -------------------------------------------------------------------------
  public destroy() {
    this.destroyed = true;
    window.removeEventListener('visibilitychange', this.visibilityHandler);
    window.removeEventListener('online', this.onlineHandler);
    window.removeEventListener('pagehide', this.pagehideHandler);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.currentRoomCode) this.send('leave-room', {});
    for (const job of this.sendJobs.values()) {
      job.cancelled = true;
      try { job.pc?.close(); } catch { /* noop */ }
    }
    for (const job of this.receiveJobs.values()) {
      job.cancelled = true;
      if (job.writer) void job.writer.abort().catch(() => undefined);
      try { job.pc?.close(); } catch { /* noop */ }
    }
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
  }
}

// ---------------------------------------------------------------------------
// Encoding helpers (relay path only)
// ---------------------------------------------------------------------------
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
