import { Device, Platform, ConnectionState, FileMeta, DirectMessage } from '../types';

export interface NetworkCallbacks {
  onConnectionStateChange: (state: ConnectionState, mode: 'server' | 'mesh' | 'offline', message?: string) => void;
  onDeviceDiscovered: (device: Device) => void;
  onDeviceDeparted: (deviceId: string) => void;
  onPeersSnapshot: (peers: Device[]) => void;
  onRoomCreated: (roomCode: string) => void;
  onRoomJoined: (roomCode: string) => void;
  onRoomPeers: (peers: Device[]) => void;
  onPeerJoinedRoom: (peer: Device) => void;
  onPeerLeftRoom: (peerId: string) => void;
  onTransferRequest: (fromPeer: Device, fileMeta: FileMeta, transferId: string) => void;
  onTransferResponse: (transferId: string, accepted: boolean) => void;
  onFileChunk: (
    transferId: string,
    chunkIndex: number,
    totalChunks: number,
    data: ArrayBuffer | string,
    relayed: boolean
  ) => void;
  onTransferComplete: (transferId: string) => void;
  onTransferCancel: (transferId: string) => void;
  onClipboardReceived: (fromDevice: string, content: string, timestamp: number) => void;
  onDirectMessageReceived?: (message: DirectMessage) => void;
  onIdConflict?: () => void;
  onError: (message: string) => void;
}

// Safe storage access helper
export function safeGetStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function normalizeRoomCode(raw: string): string {
  if (!raw) return '';
  const digitsOnly = raw.replace(/[^\w]/g, '').toUpperCase();
  if (digitsOnly.length === 6) {
    return `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3, 6)}`;
  }
  return raw.trim().toUpperCase();
}

interface WebRtcPeer {
  pc: RTCPeerConnection;
  dataChannels: Map<string, RTCDataChannel>; // transferId -> channel
  pendingCandidates: RTCIceCandidateInit[];
  iceCandidateTypes: Set<string>;
}

export class NetworkService {
  private deviceId: string;
  private deviceName: string;
  private platform: Platform;
  private callbacks: NetworkCallbacks;

  private ws: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;

  private connectionState: ConnectionState = 'idle';
  private activeMode: 'server' | 'mesh' | 'offline' = 'offline';
  private currentWsUrl: string | null = null;
  private networkKey: string = '';

  private currentRoomCode: string | null = null;
  private queuedRoomActions: Array<() => void> = [];

  private localPeersMap = new Map<string, { device: Device; lastSeen: number; channel: 'tab' | 'ws' }>();
  private roomPeersMap = new Map<string, { device: Device; lastSeen: number }>();

  // WebRTC Peer Connections: targetPeerId -> WebRtcPeer
  private peerConnections = new Map<string, WebRtcPeer>();

  // Reconnection backoff timer
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private heartbeatInterval: any = null;
  private isDestroyed = false;

  constructor(
    deviceId: string,
    deviceName: string,
    platform: Platform,
    callbacks: NetworkCallbacks
  ) {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.platform = platform;
    this.callbacks = callbacks;

    this.initBroadcastChannel();
    this.initNetwork();
    this.initLifeCycleListeners();
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  public getActiveMode(): 'server' | 'mesh' | 'offline' {
    return this.activeMode;
  }

  public getCurrentWsUrl(): string | null {
    return this.currentWsUrl;
  }

  public getNetworkKey(): string {
    return this.networkKey;
  }

  public getIceCandidateTypes(): string[] {
    const types = new Set<string>();
    for (const p of this.peerConnections.values()) {
      p.iceCandidateTypes.forEach((t) => types.add(t));
    }
    return Array.from(types);
  }

  public updateProfile(name: string, platform: Platform) {
    this.deviceName = name;
    this.platform = platform;
    this.broadcastPresence();
  }

  public updateDeviceId(newId: string) {
    this.deviceId = newId;
    this.broadcastPresence();
  }

  // 1. Same-Browser Multi-Tab Mesh via BroadcastChannel (D8: default off)
  private initBroadcastChannel() {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

    try {
      this.broadcastChannel = new BroadcastChannel('mog_share_local_mesh');
      this.broadcastChannel.onmessage = (event) => {
        this.handleBroadcastChannelMessage(event.data);
      };

      // Announce immediately if "Show other tabs" is enabled
      const showTabs = safeGetStorage('mog_show_tabs') === 'true';
      if (showTabs) {
        setTimeout(() => {
          this.broadcastChannel?.postMessage({
            type: 'tab-presence-announce',
            sender: this.getMyDeviceInfo(),
          });
        }, 50);
      }
    } catch (e) {
      console.warn('[MOG-SHARE] BroadcastChannel initialization failed:', e);
    }
  }

  private handleBroadcastChannelMessage(data: any) {
    const showTabs = safeGetStorage('mog_show_tabs') === 'true';
    if (!showTabs) return;

    if (!data || !data.type || data.sender?.id === this.deviceId) return;

    switch (data.type) {
      case 'tab-presence-announce': {
        const peer = data.sender;
        if (peer && peer.id !== this.deviceId) {
          this.localPeersMap.set(peer.id, {
            device: peer,
            lastSeen: Date.now(),
            channel: 'tab',
          });
          this.callbacks.onDeviceDiscovered(peer);

          // Reply with our presence
          this.broadcastChannel?.postMessage({
            type: 'tab-presence-reply',
            targetId: peer.id,
            sender: this.getMyDeviceInfo(),
          });
        }
        break;
      }

      case 'tab-presence-reply': {
        if (data.targetId === this.deviceId && data.sender) {
          this.localPeersMap.set(data.sender.id, {
            device: data.sender,
            lastSeen: Date.now(),
            channel: 'tab',
          });
          this.callbacks.onDeviceDiscovered(data.sender);
        }
        break;
      }

      case 'tab-departure': {
        if (data.senderId && this.localPeersMap.has(data.senderId)) {
          this.localPeersMap.delete(data.senderId);
          this.callbacks.onDeviceDeparted(data.senderId);
        }
        break;
      }

      case 'direct-message': {
        if (data.targetId === this.deviceId) {
          this.callbacks.onDirectMessageReceived?.({
            id: Math.random().toString(),
            fromPeerId: data.senderId,
            fromDevice: data.fromDevice || 'Nearby Device',
            text: data.text,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case 'clipboard-broadcast': {
        this.callbacks.onClipboardReceived(data.fromDevice, data.content, data.timestamp);
        break;
      }
    }
  }

  // 2. Candidate URL list tried in order (D2)
  private getCandidateWsUrls(): string[] {
    const candidates: string[] = [];

    if (typeof window === 'undefined') return candidates;

    // 1. ?ws= query param
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('ws');
    if (fromQuery) candidates.push(fromQuery.trim());

    // 2. Value saved in Settings
    const fromStorage = safeGetStorage('mog_custom_ws_url');
    if (fromStorage && fromStorage.trim()) candidates.push(fromStorage.trim());

    // 3. VITE_WS_URL environment variable
    const envWs = import.meta.env.VITE_WS_URL as string | undefined;
    if (envWs && envWs.trim()) candidates.push(envWs.trim());

    // 4. Same origin (Express / production / proxy)
    const isHttps = window.location.protocol === 'https:';
    const proto = isHttps ? 'wss:' : 'ws:';
    const sameOrigin = `${proto}//${window.location.host}/ws`;
    candidates.push(sameOrigin);

    // 5. If running on dev server (e.g. port 5173 or 3000), try port 4000
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.port !== '4000') {
      candidates.push(`${proto}//${window.location.hostname}:4000/ws`);
    }

    // Deduplicate
    return Array.from(new Set(candidates));
  }

  // 3. Network Initialization with Render Cold-Start Wakeup (D3)
  private async initNetwork() {
    if (this.isDestroyed) return;

    this.setConnectionState('connecting', 'offline', 'Searching for server...');

    const candidateUrls = this.getCandidateWsUrls();

    for (const wsUrl of candidateUrls) {
      if (this.isDestroyed) return;

      // Wake-up ping via HTTP /api/health to spin up sleeping Render free instance (D3)
      this.fireWakeupHttp(wsUrl);

      const isRemote = !wsUrl.includes('localhost') && !wsUrl.includes('127.0.0.1');
      if (isRemote) {
        this.setConnectionState('connecting', 'offline', 'Waking up server...');
      }

      const timeoutMs = isRemote ? 20000 : 4000;
      const success = await this.tryConnectWebSocket(wsUrl, timeoutMs);
      if (success) {
        this.currentWsUrl = wsUrl;
        this.activeMode = 'server';
        this.reconnectAttempts = 0;
        this.setConnectionState('ready', 'server');
        this.startHeartbeat();

        // Flush any queued room operations (R2)
        this.flushQueuedRoomActions();
        return;
      }
    }

    // If all candidates failed, schedule reconnection with exponential backoff (D4)
    this.scheduleReconnect();
  }

  private fireWakeupHttp(wsUrl: string) {
    try {
      const httpUrl = wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/ws$/, '');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      fetch(`${httpUrl}/api/health`, { signal: controller.signal })
        .then(() => clearTimeout(timeout))
        .catch(() => clearTimeout(timeout));
    } catch {}
  }

  private tryConnectWebSocket(url: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(url);
        let resolved = false;

        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            try { ws.close(); } catch {}
            resolve(false);
          }
        }, timeoutMs);

        ws.onopen = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            this.ws = ws;
            this.setupWebSocketListeners(ws);
            resolve(true);
          }
        };

        ws.onerror = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve(false);
          }
        };
      } catch {
        resolve(false);
      }
    });
  }

  private setupWebSocketListeners(ws: WebSocket) {
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleServerMessage(msg);
      } catch (err) {
        console.error('[MOG-SHARE WS] Message parse error:', err);
      }
    };

    ws.onclose = () => {
      if (this.isDestroyed) return;
      console.warn('[MOG-SHARE WS] Connection closed. Triggering reconnect backoff...');
      this.ws = null;
      this.setConnectionState('reconnecting', 'offline', 'Connection dropped. Reconnecting...');
      this.scheduleReconnect();
    };

    // Register on server immediately
    ws.send(
      JSON.stringify({
        type: 'register',
        payload: {
          id: this.deviceId,
          name: this.deviceName,
          platform: this.platform,
        },
      })
    );
  }

  // 4. Server Message Router
  private handleServerMessage(msg: any) {
    switch (msg.type) {
      case 'id-conflict': {
        // D9: Duplicate ID rejected by server -> regenerate fresh UUID
        console.warn('[MOG-SHARE] Server ID conflict detected. Regenerating UUID...');
        const freshId = 'mog_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        this.deviceId = freshId;
        safeSetStorage('mog_device_id', freshId);
        this.callbacks.onIdConflict?.();
        this.broadcastPresence();
        break;
      }

      case 'peers-snapshot': {
        // D1: Immediate full snapshot of local peers with matching networkKey
        if (msg.payload?.networkKey) {
          this.networkKey = msg.payload.networkKey;
        }
        if (Array.isArray(msg.payload?.peers)) {
          this.localPeersMap.clear();
          for (const peer of msg.payload.peers) {
            this.localPeersMap.set(peer.id, {
              device: peer,
              lastSeen: Date.now(),
              channel: 'ws',
            });
          }
          this.callbacks.onPeersSnapshot(msg.payload.peers);
        }
        break;
      }

      case 'device-discovered': {
        if (msg.payload?.device && msg.payload.device.id !== this.deviceId) {
          this.localPeersMap.set(msg.payload.device.id, {
            device: msg.payload.device,
            lastSeen: Date.now(),
            channel: 'ws',
          });
          this.callbacks.onDeviceDiscovered(msg.payload.device);
        }
        break;
      }

      case 'device-departed': {
        if (msg.payload?.deviceId) {
          this.localPeersMap.delete(msg.payload.deviceId);
          this.callbacks.onDeviceDeparted(msg.payload.deviceId);
        }
        break;
      }

      case 'room-created': {
        this.currentRoomCode = msg.payload.roomCode;
        this.callbacks.onRoomCreated(msg.payload.roomCode);
        break;
      }

      case 'room-joined': {
        this.currentRoomCode = msg.payload.roomCode;
        this.callbacks.onRoomJoined(msg.payload.roomCode);
        break;
      }

      case 'room-peers': {
        if (Array.isArray(msg.payload?.peers)) {
          this.roomPeersMap.clear();
          for (const p of msg.payload.peers) {
            this.roomPeersMap.set(p.id, { device: p, lastSeen: Date.now() });
          }
          this.callbacks.onRoomPeers(msg.payload.peers);
        }
        break;
      }

      case 'peer-joined-room': {
        if (msg.payload?.peer && msg.payload.peer.id !== this.deviceId) {
          this.roomPeersMap.set(msg.payload.peer.id, { device: msg.payload.peer, lastSeen: Date.now() });
          this.callbacks.onPeerJoinedRoom(msg.payload.peer);
        }
        break;
      }

      case 'peer-left-room': {
        if (msg.payload?.peerId) {
          this.roomPeersMap.delete(msg.payload.peerId);
          this.callbacks.onPeerLeftRoom(msg.payload.peerId);
        }
        break;
      }

      case 'signal': {
        this.handleIncomingSignal(msg.payload?.fromPeerId, msg.payload?.signalData);
        break;
      }

      case 'direct-message': {
        this.callbacks.onDirectMessageReceived?.({
          id: Math.random().toString(),
          fromPeerId: msg.payload.fromPeerId,
          fromDevice: msg.payload.fromDevice || 'Peer',
          text: msg.payload.text,
          timestamp: msg.payload.timestamp || Date.now(),
        });
        break;
      }

      case 'clipboard-received': {
        this.callbacks.onClipboardReceived(
          msg.payload.fromDevice,
          msg.payload.content,
          msg.payload.timestamp
        );
        break;
      }

      case 'transfer-request': {
        this.callbacks.onTransferRequest(
          msg.payload.fromPeer,
          msg.payload.fileMeta,
          msg.payload.transferId
        );
        break;
      }

      case 'transfer-response': {
        this.callbacks.onTransferResponse(msg.payload.transferId, msg.payload.accepted);
        break;
      }

      case 'file-chunk': {
        // Relayed chunk fallback (T1)
        this.callbacks.onFileChunk(
          msg.payload.transferId,
          msg.payload.chunkIndex,
          msg.payload.totalChunks,
          msg.payload.data,
          true // Relayed
        );
        break;
      }

      case 'transfer-complete': {
        this.callbacks.onTransferComplete(msg.payload.transferId);
        break;
      }

      case 'transfer-cancel': {
        this.callbacks.onTransferCancel(msg.payload.transferId);
        break;
      }

      case 'error': {
        this.currentRoomCode = null;
        this.roomPeersMap.clear();
        this.callbacks.onError(msg.payload?.message || 'Server error');
        break;
      }
    }
  }

  // 5. Exponential Backoff Reconnection (D4)
  private scheduleReconnect() {
    if (this.isDestroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
    const delays = [1000, 2000, 4000, 8000, 15000];
    const delay = delays[Math.min(this.reconnectAttempts, delays.length - 1)];
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      console.log(`[MOG-SHARE] Attempting reconnect #${this.reconnectAttempts}...`);
      this.initNetwork().then(() => {
        // If room was active before disconnection, re-join on reconnect (D4)
        if (this.currentRoomCode && this.connectionState === 'ready') {
          console.log(`[MOG-SHARE] Rejoining room ${this.currentRoomCode} after reconnection...`);
          this.joinRoom(this.currentRoomCode);
        }
      });
    }, delay);
  }

  private initLifeCycleListeners() {
    if (typeof window === 'undefined') return;

    // Immediate reconnect on tab visible (D4)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          this.initNetwork();
        } else {
          this.broadcastPresence();
        }
      }
    });

    // Immediate reconnect on online event (D4)
    window.addEventListener('online', () => {
      console.log('[MOG-SHARE] Online event detected. Reconnecting...');
      this.initNetwork();
    });

    // Clean exit on pagehide / beforeunload (R8)
    window.addEventListener('pagehide', () => {
      this.destroy();
    });
  }

  // 6. WebRTC DataChannel Engine (T1)
  private getOrCreatePeerConnection(peerId: string): WebRtcPeer {
    let peer = this.peerConnections.get(peerId);
    if (peer) return peer;

    const turnUrl = safeGetStorage('mog_turn_url') || (import.meta.env.VITE_TURN_URL as string) || '';
    const turnUser = safeGetStorage('mog_turn_user') || (import.meta.env.VITE_TURN_USER as string) || '';
    const turnPass = safeGetStorage('mog_turn_pass') || (import.meta.env.VITE_TURN_PASS as string) || '';

    const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (turnUrl) {
      iceServers.push({
        urls: turnUrl,
        username: turnUser,
        credential: turnPass,
      });
    }

    const pc = new RTCPeerConnection({ iceServers });
    peer = {
      pc,
      dataChannels: new Map(),
      pendingCandidates: [],
      iceCandidateTypes: new Set(),
    };
    this.peerConnections.set(peerId, peer);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        if (event.candidate.type) peer.iceCandidateTypes.add(event.candidate.type);
        this.sendSignal(peerId, { type: 'candidate', candidate: event.candidate });
      }
    };

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      const transferId = dc.label.replace(/^mog_dc_/, '');
      peer.dataChannels.set(transferId, dc);
      this.setupDataChannel(dc, peerId, transferId);
    };

    return peer;
  }

  private setupDataChannel(dc: RTCDataChannel, _peerId: string, transferId: string) {
    dc.binaryType = 'arraybuffer';

    dc.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Direct WebRTC binary chunk: first 4 bytes are uint32 chunkIndex
        if (event.data.byteLength >= 4) {
          const view = new DataView(event.data);
          const chunkIndex = view.getUint32(0, false);
          const chunkData = event.data.slice(4);
          this.callbacks.onFileChunk(transferId, chunkIndex, 0, chunkData, false);
        }
      }
    };

    dc.onerror = (err) => {
      console.warn(`[MOG-SHARE WebRTC] DataChannel error for transfer ${transferId}:`, err);
    };
  }

  public sendSignal(targetPeerId: string, signalData: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'signal',
          payload: {
            targetPeerId,
            signalData,
          },
        })
      );
    }
  }

  private async handleIncomingSignal(fromPeerId: string, signalData: any) {
    if (!signalData) return;
    const peer = this.getOrCreatePeerConnection(fromPeerId);
    const { pc } = peer;

    try {
      if (signalData.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData.offer));
        // Flush any queued candidates
        while (peer.pendingCandidates.length > 0) {
          const cand = peer.pendingCandidates.shift();
          if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand));
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendSignal(fromPeerId, { type: 'answer', answer, transferId: signalData.transferId });
      } else if (signalData.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData.answer));
        while (peer.pendingCandidates.length > 0) {
          const cand = peer.pendingCandidates.shift();
          if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand));
        }
      } else if (signalData.type === 'candidate' && signalData.candidate) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
        } else {
          peer.pendingCandidates.push(signalData.candidate);
        }
      }
    } catch (err) {
      console.warn('[MOG-SHARE WebRTC] Signal error:', err);
    }
  }

  // Establish WebRTC DataChannel for transfer with 8s ICE timeout fallback (T1)
  public async prepareDataChannel(targetPeerId: string, transferId: string): Promise<RTCDataChannel | null> {
    if (typeof RTCPeerConnection === 'undefined') return null;

    try {
      const peer = this.getOrCreatePeerConnection(targetPeerId);
      const dc = peer.pc.createDataChannel(`mog_dc_${transferId}`, { ordered: true });
      peer.dataChannels.set(transferId, dc);
      this.setupDataChannel(dc, targetPeerId, transferId);

      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.sendSignal(targetPeerId, { type: 'offer', offer, transferId });

      // Wait up to 8s for data channel to open
      return await new Promise<RTCDataChannel | null>((resolve) => {
        if (dc.readyState === 'open') {
          return resolve(dc);
        }

        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log(`[MOG-SHARE WebRTC] 8s ICE timeout reached for ${transferId}. Falling back to server relay.`);
            resolve(null);
          }
        }, 8000);

        dc.onopen = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(dc);
          }
        };

        dc.onerror = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(null);
          }
        };
      });
    } catch (err) {
      console.warn('[MOG-SHARE WebRTC] Could not create data channel:', err);
      return null;
    }
  }

  // 7. Room Operations (R2, R3, R4)
  public createRoom() {
    if (this.connectionState !== 'ready') {
      this.queuedRoomActions.push(() => this.createRoom());
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'create-room' }));
    }
  }

  public joinRoom(rawCode: string) {
    const cleanCode = normalizeRoomCode(rawCode);
    if (!cleanCode) return;

    if (this.connectionState !== 'ready') {
      this.queuedRoomActions.push(() => this.joinRoom(cleanCode));
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'join-room',
          payload: { roomCode: cleanCode },
        })
      );
    }
  }

  public leaveRoom() {
    if (this.currentRoomCode) {
      this.currentRoomCode = null;
      this.roomPeersMap.clear();

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'leave-room' }));
      }
    }
  }

  private flushQueuedRoomActions() {
    while (this.queuedRoomActions.length > 0) {
      const action = this.queuedRoomActions.shift();
      try {
        action?.();
      } catch (e) {
        console.error('Error executing queued room action:', e);
      }
    }
  }

  // 8. Outgoing Transfer & Messaging
  public sendTransferRequest(targetPeerId: string, transferId: string, fileMeta: FileMeta) {
    this.sendDirectPayload(targetPeerId, {
      type: 'transfer-request',
      transferId,
      fileMeta,
    });
  }

  public sendTransferResponse(targetPeerId: string, transferId: string, accepted: boolean) {
    this.sendDirectPayload(targetPeerId, {
      type: 'transfer-response',
      transferId,
      accepted,
    });
  }

  // Send binary chunk over WebRTC DataChannel (with backpressure) or fall back to WS relay (T1)
  public async sendChunk(
    targetPeerId: string,
    transferId: string,
    chunkIndex: number,
    totalChunks: number,
    buffer: ArrayBuffer,
    dc: RTCDataChannel | null
  ): Promise<boolean> {
    if (dc && dc.readyState === 'open') {
      // Direct WebRTC DataChannel path: 4-byte uint32 chunkIndex prefix
      const prefixed = new Uint8Array(4 + buffer.byteLength);
      const view = new DataView(prefixed.buffer);
      view.setUint32(0, chunkIndex, false);
      prefixed.set(new Uint8Array(buffer), 4);

      // Backpressure control (T1): pause when bufferedAmount > 4 MB
      dc.bufferedAmountLowThreshold = 1024 * 1024;
      if (dc.bufferedAmount > 4 * 1024 * 1024) {
        await new Promise<void>((resolve) => {
          const onLow = () => {
            dc.removeEventListener('bufferedamountlow', onLow);
            resolve();
          };
          dc.addEventListener('bufferedamountlow', onLow);
        });
      }

      dc.send(prefixed.buffer);
      return false; // Not relayed
    }

    // Fallback: WebSocket relay (base64 string in JSON)
    const base64Data = this.arrayBufferToBase64(buffer);
    this.sendDirectPayload(targetPeerId, {
      type: 'file-chunk',
      transferId,
      chunkIndex,
      totalChunks,
      data: base64Data,
    });
    return true; // Relayed
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  public sendTransferComplete(targetPeerId: string, transferId: string) {
    this.sendDirectPayload(targetPeerId, {
      type: 'transfer-complete',
      transferId,
    });
  }

  public sendTransferCancel(targetPeerId: string, transferId: string) {
    this.sendDirectPayload(targetPeerId, {
      type: 'transfer-cancel',
      transferId,
    });
  }

  public sendDirectMessage(targetPeerId: string, text: string) {
    this.sendDirectPayload(targetPeerId, {
      type: 'direct-message',
      text,
    });
  }

  public broadcastClipboard(content: string) {
    const payload = {
      type: 'clipboard-broadcast',
      fromDevice: this.deviceName,
      content,
      timestamp: Date.now(),
    };

    this.broadcastChannel?.postMessage(payload);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private sendDirectPayload(targetPeerId: string, payload: any) {
    const localPeer = this.localPeersMap.get(targetPeerId);

    // If local tab on BroadcastChannel
    if (localPeer && localPeer.channel === 'tab') {
      this.broadcastChannel?.postMessage({
        type: payload.type,
        targetId: targetPeerId,
        senderId: this.deviceId,
        fromDevice: this.deviceName,
        ...payload,
      });
      return;
    }

    // Through server WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: payload.type,
          payload: {
            targetPeerId,
            ...payload,
          },
        })
      );
    }
  }

  public broadcastPresence() {
    const info = this.getMyDeviceInfo();

    if (safeGetStorage('mog_show_tabs') === 'true') {
      this.broadcastChannel?.postMessage({
        type: 'tab-presence-announce',
        sender: info,
      });
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'register',
          payload: info,
        })
      );
    }
  }

  private getMyDeviceInfo(): Device {
    return {
      id: this.deviceId,
      name: this.deviceName,
      platform: this.platform,
      isLocal: true,
      status: 'online',
    };
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 20000);
  }

  private setConnectionState(
    state: ConnectionState,
    mode: 'server' | 'mesh' | 'offline',
    message?: string
  ) {
    this.connectionState = state;
    this.activeMode = mode;
    this.callbacks.onConnectionStateChange(state, mode, message);
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    // Clean room departure (R8)
    this.leaveRoom();

    try {
      this.broadcastChannel?.postMessage({
        type: 'tab-departure',
        senderId: this.deviceId,
      });
      this.broadcastChannel?.close();
    } catch {}

    // Close all WebRTC peer connections
    for (const peer of this.peerConnections.values()) {
      try {
        peer.pc.close();
      } catch {}
    }
    this.peerConnections.clear();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
  }
}
