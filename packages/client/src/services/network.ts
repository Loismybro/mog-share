import mqtt, { MqttClient } from 'mqtt';
import { Device, Platform } from '../types';

export interface FileMeta {
  name: string;
  size: number;
  type: string;
}

export interface NetworkCallbacks {
  onStatusChange: (status: 'connected' | 'connecting' | 'disconnected', mode: 'mesh' | 'server') => void;
  onDeviceDiscovered: (device: Device) => void;
  onDeviceDeparted: (deviceId: string) => void;
  onRoomCreated: (roomCode: string) => void;
  onRoomJoined: (roomCode: string) => void;
  onRoomPeers: (peers: Device[]) => void;
  onPeerJoinedRoom: (peer: Device) => void;
  onPeerLeftRoom: (peerId: string) => void;
  onTransferRequest: (fromPeer: Device, fileMeta: FileMeta, transferId: string) => void;
  onTransferResponse: (transferId: string, accepted: boolean) => void;
  onFileChunk: (transferId: string, chunkIndex: number, totalChunks: number, data: string) => void;
  onTransferComplete: (transferId: string) => void;
  onTransferCancel: (transferId: string) => void;
  onClipboardReceived: (fromDevice: string, content: string, timestamp: number) => void;
  onError: (message: string) => void;
}

// Fast string hash for local LAN subnet grouping
export function hashString(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizeRoomCode(raw: string): string {
  if (!raw) return '';
  const digitsOnly = raw.replace(/[^\w]/g, '').toUpperCase();
  if (digitsOnly.length === 6) {
    return `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3, 6)}`;
  }
  return raw.trim().toUpperCase();
}

const BROKER_ENDPOINTS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

export class NetworkService {
  private deviceId: string;
  private deviceName: string;
  private platform: Platform;
  private callbacks: NetworkCallbacks;

  private ws: WebSocket | null = null;
  private mqttClient: MqttClient | null = null;
  private broadcastChannel: BroadcastChannel | null = null;

  private activeMode: 'server' | 'mesh' | 'offline' = 'offline';
  private currentStatus: 'connected' | 'connecting' | 'disconnected' = 'connecting';

  private lanHash: string = 'local_default';
  private publicIp: string = '';
  private currentRoomCode: string | null = null;

  private localPeersMap = new Map<string, { device: Device; lastSeen: number; channel: 'tab' | 'ws' | 'mesh' }>();
  private roomPeersMap = new Map<string, { device: Device; lastSeen: number }>();

  private heartbeatInterval: any = null;
  private cleanupInterval: any = null;
  private brokerIndex = 0;
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
  }

  public getNetworkMode(): 'server' | 'mesh' | 'offline' {
    return this.activeMode;
  }

  public getStatus(): 'connected' | 'connecting' | 'disconnected' {
    return this.currentStatus;
  }

  public getPublicIp(): string {
    return this.publicIp;
  }

  public getLanHash(): string {
    return this.lanHash;
  }

  public updateProfile(name: string, platform: Platform) {
    this.deviceName = name;
    this.platform = platform;
    this.broadcastPresence();
  }

  // 1. Same-Browser Multi-Tab Mesh via BroadcastChannel
  private initBroadcastChannel() {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

    try {
      this.broadcastChannel = new BroadcastChannel('mog_share_local_mesh');
      this.broadcastChannel.onmessage = (event) => {
        this.handleBroadcastChannelMessage(event.data);
      };

      // Announce immediately to other tabs
      setTimeout(() => {
        this.broadcastChannel?.postMessage({
          type: 'tab-presence-announce',
          sender: this.getMyDeviceInfo(),
        });
      }, 50);
    } catch (e) {
      console.warn('[MOG-SHARE] BroadcastChannel initialization failed:', e);
    }
  }

  private handleBroadcastChannelMessage(data: any) {
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

          // Reply with our presence so the new tab knows about us
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
          this.handleDirectPayload(data.payload);
        }
        break;
      }

      case 'room-message': {
        if (this.currentRoomCode && data.roomCode === this.currentRoomCode) {
          this.handleRoomPayload(data.payload);
        }
        break;
      }

      case 'clipboard-broadcast': {
        this.callbacks.onClipboardReceived(data.fromDevice, data.content, data.timestamp);
        break;
      }
    }
  }

  // 2. Network Initialization & Fallback Engine
  private async initNetwork() {
    this.setStatus('connecting', 'offline');

    // Check if custom or local WebSocket server is configured / available
    const customWs = this.getCustomWsUrl();
    if (customWs) {
      const wsSuccess = await this.tryConnectWebSocket(customWs);
      if (wsSuccess) {
        this.activeMode = 'server';
        this.setStatus('connected', 'server');
        this.startHeartbeat();
        return;
      }
    }

    // Connect to Zero-Config Cloud Mesh
    await this.connectCloudMesh();
  }

  private getCustomWsUrl(): string | null {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('ws');
    if (fromQuery) return fromQuery;

    const fromStorage = localStorage.getItem('mog_custom_ws_url');
    if (fromStorage && fromStorage.trim()) return fromStorage.trim();

    const envWs = import.meta.env.VITE_WS_URL as string | undefined;
    if (envWs && envWs.trim()) return envWs.trim();

    // If running on localhost/127.0.0.1, try local server port 4000
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.hostname}:4000/ws`;
    }

    return null;
  }

  private tryConnectWebSocket(url: string): Promise<boolean> {
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
        }, 2500);

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
      console.warn('[MOG-SHARE WS] Closed. Re-evaluating network...');
      this.ws = null;
      // If custom server closed, fall back to cloud mesh
      this.connectCloudMesh();
    };

    // Register on server
    ws.send(JSON.stringify({
      type: 'register',
      payload: {
        id: this.deviceId,
        name: this.deviceName,
        platform: this.platform,
      }
    }));
  }

  private handleServerMessage(msg: any) {
    switch (msg.type) {
      case 'device-discovered':
        if (msg.payload?.device && msg.payload.device.id !== this.deviceId) {
          this.localPeersMap.set(msg.payload.device.id, {
            device: msg.payload.device,
            lastSeen: Date.now(),
            channel: 'ws',
          });
          this.callbacks.onDeviceDiscovered(msg.payload.device);
        }
        break;

      case 'device-departed':
        if (msg.payload?.deviceId) {
          this.localPeersMap.delete(msg.payload.deviceId);
          this.callbacks.onDeviceDeparted(msg.payload.deviceId);
        }
        break;

      case 'room-created':
        this.currentRoomCode = msg.payload.roomCode;
        this.callbacks.onRoomCreated(msg.payload.roomCode);
        break;

      case 'room-joined':
        this.currentRoomCode = msg.payload.roomCode;
        this.callbacks.onRoomJoined(msg.payload.roomCode);
        break;

      case 'room-peers':
        if (Array.isArray(msg.payload?.peers)) {
          this.callbacks.onRoomPeers(msg.payload.peers);
        }
        break;

      case 'peer-joined-room':
        if (msg.payload?.peer && msg.payload.peer.id !== this.deviceId) {
          this.callbacks.onPeerJoinedRoom(msg.payload.peer);
        }
        break;

      case 'peer-left-room':
        if (msg.payload?.peerId) {
          this.callbacks.onPeerLeftRoom(msg.payload.peerId);
        }
        break;

      case 'transfer-request':
        this.callbacks.onTransferRequest(msg.payload.fromPeer, msg.payload.fileMeta, msg.payload.transferId);
        break;

      case 'transfer-response':
        this.callbacks.onTransferResponse(msg.payload.transferId, msg.payload.accepted);
        break;

      case 'file-chunk':
        this.callbacks.onFileChunk(
          msg.payload.transferId,
          msg.payload.chunkIndex,
          msg.payload.totalChunks,
          msg.payload.data
        );
        break;

      case 'transfer-complete':
        this.callbacks.onTransferComplete(msg.payload.transferId);
        break;

      case 'transfer-cancel':
        this.callbacks.onTransferCancel(msg.payload.transferId);
        break;

      case 'clipboard-received':
        this.callbacks.onClipboardReceived(
          msg.payload.fromDevice,
          msg.payload.content,
          msg.payload.timestamp
        );
        break;

      case 'error':
        this.callbacks.onError(msg.payload?.message || 'Server error');
        break;
    }
  }

  // 3. Built-in Zero-Config Cloud Mesh
  private async connectCloudMesh() {
    if (this.isDestroyed) return;
    this.setStatus('connecting', 'mesh');

    // Detect public IP for LAN grouping in background
    await this.detectLanGroup();

    const brokerUrl = BROKER_ENDPOINTS[this.brokerIndex % BROKER_ENDPOINTS.length];
    const clientId = `mog_${this.deviceId}_${Math.random().toString(36).substring(2, 7)}`;

    try {
      if (this.mqttClient) {
        try { this.mqttClient.end(true); } catch {}
        this.mqttClient = null;
      }

      console.log(`[MOG-SHARE] Connecting to Mesh Broker: ${brokerUrl}`);
      const client = mqtt.connect(brokerUrl, {
        clientId,
        clean: true,
        connectTimeout: 8000,
        keepalive: 20,
        reconnectPeriod: 4000,
      });

      this.mqttClient = client;

      client.on('connect', () => {
        console.log('[MOG-SHARE] Cloud Mesh Relay Connected!');
        this.activeMode = 'mesh';
        this.setStatus('connected', 'mesh');

        // Subscribe to:
        // 1) Direct device topic
        // 2) LAN subnet topic
        const devTopic = `mogshare/v1/dev/${this.deviceId}`;
        const lanTopic = `mogshare/v1/lan/${this.lanHash}`;

        client.subscribe([devTopic, lanTopic], (err) => {
          if (!err) {
            this.broadcastPresence();
          }
        });

        // If a room was previously active, re-subscribe
        if (this.currentRoomCode) {
          const roomTopic = `mogshare/v1/room/${this.currentRoomCode}`;
          client.subscribe(roomTopic);
        }

        this.startHeartbeat();
      });

      client.on('message', (topic, payloadBuffer) => {
        try {
          const message = JSON.parse(payloadBuffer.toString());
          this.handleMqttMessage(topic, message);
        } catch (err) {
          console.error('[MOG-SHARE Mesh] Parse error:', err);
        }
      });

      client.on('error', (err) => {
        console.warn('[MOG-SHARE Mesh] Broker connection issue:', err.message);
        // Try fallback broker on error
        this.brokerIndex++;
      });

      client.on('offline', () => {
        if (this.activeMode === 'mesh') {
          this.setStatus('connecting', 'mesh');
        }
      });
    } catch (err) {
      console.error('[MOG-SHARE Mesh] Fatal connection error:', err);
      this.setStatus('disconnected', 'offline');
    }
  }

  private async detectLanGroup() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      // Fast check for public IP via ipify
      const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data && data.ip) {
        this.publicIp = data.ip;
        this.lanHash = `lan_${hashString(data.ip)}`;
        return;
      }
    } catch {}

    try {
      // Fallback to Cloudflare trace
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch('https://cloudflare.com/cdn-cgi/trace', { signal: controller.signal });
      clearTimeout(timeoutId);
      const text = await res.text();
      const ipLine = text.split('\n').find((l) => l.startsWith('ip='));
      if (ipLine) {
        const ip = ipLine.replace('ip=', '').trim();
        this.publicIp = ip;
        this.lanHash = `lan_${hashString(ip)}`;
        return;
      }
    } catch {}

    // Fallback: use hostname + user-agent hash if external IP is blocked
    const fallbackSeed = (typeof window !== 'undefined' ? window.location.hostname : 'lan') + navigator.userAgent;
    this.lanHash = `lan_${hashString(fallbackSeed)}`;
  }

  private handleMqttMessage(topic: string, msg: any) {
    if (!msg || msg.sender?.id === this.deviceId) return;

    // 1. Messages on LAN Topic
    if (topic.startsWith('mogshare/v1/lan/')) {
      if (msg.type === 'presence-announce') {
        const peer = msg.sender;
        if (peer && peer.id !== this.deviceId) {
          this.localPeersMap.set(peer.id, {
            device: peer,
            lastSeen: Date.now(),
            channel: 'mesh',
          });
          this.callbacks.onDeviceDiscovered(peer);

          // Reply with our presence directly to their device topic
          this.publishMqttDirect(peer.id, {
            type: 'presence-reply',
            sender: this.getMyDeviceInfo(),
          });
        }
      } else if (msg.type === 'device-departed') {
        if (msg.deviceId) {
          this.localPeersMap.delete(msg.deviceId);
          this.callbacks.onDeviceDeparted(msg.deviceId);
        }
      } else if (msg.type === 'clipboard-broadcast') {
        this.callbacks.onClipboardReceived(msg.fromDevice, msg.content, msg.timestamp);
      }
      return;
    }

    // 2. Direct Messages to this Device
    if (topic === `mogshare/v1/dev/${this.deviceId}`) {
      this.handleDirectPayload(msg);
      return;
    }

    // 3. Room Messages
    if (topic.startsWith('mogshare/v1/room/')) {
      this.handleRoomPayload(msg);
      return;
    }
  }

  private handleDirectPayload(msg: any) {
    switch (msg.type) {
      case 'presence-reply': {
        const peer = msg.sender;
        if (peer && peer.id !== this.deviceId) {
          this.localPeersMap.set(peer.id, {
            device: peer,
            lastSeen: Date.now(),
            channel: 'mesh',
          });
          this.callbacks.onDeviceDiscovered(peer);
        }
        break;
      }

      case 'transfer-request':
        this.callbacks.onTransferRequest(msg.fromPeer, msg.fileMeta, msg.transferId);
        break;

      case 'transfer-response':
        this.callbacks.onTransferResponse(msg.transferId, msg.accepted);
        break;

      case 'file-chunk':
        this.callbacks.onFileChunk(
          msg.transferId,
          msg.chunkIndex,
          msg.totalChunks,
          msg.data
        );
        break;

      case 'transfer-complete':
        this.callbacks.onTransferComplete(msg.transferId);
        break;

      case 'transfer-cancel':
        this.callbacks.onTransferCancel(msg.transferId);
        break;
    }
  }

  private handleRoomPayload(msg: any) {
    if (msg.sender?.id === this.deviceId) return;

    switch (msg.type) {
      case 'room-join-request': {
        const peer = msg.sender;
        if (peer && peer.id !== this.deviceId) {
          this.roomPeersMap.set(peer.id, { device: peer, lastSeen: Date.now() });
          this.callbacks.onPeerJoinedRoom(peer);

          // Reply with current peer snapshot
          const snapshot = Array.from(this.roomPeersMap.values()).map((p) => p.device);
          snapshot.push(this.getMyDeviceInfo());

          this.publishMqttDirect(peer.id, {
            type: 'room-snapshot',
            roomCode: this.currentRoomCode,
            peers: snapshot.filter((p) => p.id !== peer.id),
          });
        }
        break;
      }

      case 'room-snapshot': {
        if (Array.isArray(msg.peers)) {
          msg.peers.forEach((p: Device) => {
            if (p.id !== this.deviceId) {
              this.roomPeersMap.set(p.id, { device: p, lastSeen: Date.now() });
            }
          });
          this.callbacks.onRoomPeers(Array.from(this.roomPeersMap.values()).map((p) => p.device));
        }
        break;
      }

      case 'peer-left-room': {
        if (msg.peerId) {
          this.roomPeersMap.delete(msg.peerId);
          this.callbacks.onPeerLeftRoom(msg.peerId);
        }
        break;
      }

      case 'clipboard-broadcast': {
        this.callbacks.onClipboardReceived(msg.fromDevice, msg.content, msg.timestamp);
        break;
      }
    }
  }

  // 4. Outgoing Operations
  public createRoom() {
    const part1 = Math.floor(100 + Math.random() * 900);
    const part2 = Math.floor(100 + Math.random() * 900);
    const code = `${part1}-${part2}`;

    this.currentRoomCode = code;
    this.roomPeersMap.clear();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'create-room' }));
      return;
    }

    if (this.mqttClient && this.mqttClient.connected) {
      const roomTopic = `mogshare/v1/room/${code}`;
      this.mqttClient.subscribe(roomTopic, () => {
        this.callbacks.onRoomCreated(code);
      });
    } else {
      this.callbacks.onRoomCreated(code);
    }
  }

  public joinRoom(rawCode: string) {
    const cleanCode = normalizeRoomCode(rawCode);
    if (!cleanCode) return;

    this.currentRoomCode = cleanCode;
    this.roomPeersMap.clear();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'join-room',
        payload: { roomCode: cleanCode }
      }));
      return;
    }

    if (this.mqttClient && this.mqttClient.connected) {
      const roomTopic = `mogshare/v1/room/${cleanCode}`;
      this.mqttClient.subscribe(roomTopic, (err) => {
        if (!err) {
          this.callbacks.onRoomJoined(cleanCode);
          // Broadcast join request to room
          this.mqttClient?.publish(
            roomTopic,
            JSON.stringify({
              type: 'room-join-request',
              sender: this.getMyDeviceInfo(),
            })
          );
        } else {
          this.callbacks.onError(`Could not join room ${cleanCode}`);
        }
      });
    } else {
      this.callbacks.onRoomJoined(cleanCode);
    }
  }

  public leaveRoom() {
    if (this.currentRoomCode) {
      const oldCode = this.currentRoomCode;
      this.currentRoomCode = null;
      this.roomPeersMap.clear();

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'leave-room' }));
      } else if (this.mqttClient && this.mqttClient.connected) {
        const roomTopic = `mogshare/v1/room/${oldCode}`;
        this.mqttClient.publish(
          roomTopic,
          JSON.stringify({
            type: 'peer-left-room',
            peerId: this.deviceId,
          })
        );
        this.mqttClient.unsubscribe(roomTopic);
      }
    }
  }

  public sendTransferRequest(targetPeerId: string, transferId: string, fileMeta: FileMeta) {
    const payload = {
      type: 'transfer-request',
      fromPeer: this.getMyDeviceInfo(),
      fileMeta,
      transferId,
    };
    this.sendDirectPayload(targetPeerId, payload);
  }

  public sendTransferResponse(targetPeerId: string, transferId: string, accepted: boolean) {
    const payload = {
      type: 'transfer-response',
      transferId,
      accepted,
    };
    this.sendDirectPayload(targetPeerId, payload);
  }

  public sendFileChunk(
    targetPeerId: string,
    transferId: string,
    chunkIndex: number,
    totalChunks: number,
    data: string
  ) {
    const payload = {
      type: 'file-chunk',
      transferId,
      chunkIndex,
      totalChunks,
      data,
    };
    this.sendDirectPayload(targetPeerId, payload);
  }

  public sendTransferComplete(targetPeerId: string, transferId: string) {
    const payload = {
      type: 'transfer-complete',
      transferId,
    };
    this.sendDirectPayload(targetPeerId, payload);
  }

  public sendTransferCancel(targetPeerId: string, transferId: string) {
    const payload = {
      type: 'transfer-cancel',
      transferId,
    };
    this.sendDirectPayload(targetPeerId, payload);
  }

  public broadcastClipboard(content: string) {
    const payload = {
      type: 'clipboard-broadcast',
      fromDevice: this.deviceName,
      content,
      timestamp: Date.now(),
    };

    // 1. BroadcastChannel (local tabs)
    this.broadcastChannel?.postMessage(payload);

    // 2. WebSocket if active
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'clipboard-broadcast',
        payload: { content }
      }));
    }

    // 3. Cloud Mesh
    if (this.mqttClient && this.mqttClient.connected) {
      if (this.currentRoomCode) {
        this.mqttClient.publish(`mogshare/v1/room/${this.currentRoomCode}`, JSON.stringify(payload));
      } else {
        this.mqttClient.publish(`mogshare/v1/lan/${this.lanHash}`, JSON.stringify(payload));
      }
    }
  }

  private sendDirectPayload(targetPeerId: string, payload: any) {
    const localPeer = this.localPeersMap.get(targetPeerId);

    // If local tab on BroadcastChannel, deliver with zero network hop
    if (localPeer && localPeer.channel === 'tab') {
      this.broadcastChannel?.postMessage({
        type: 'direct-message',
        targetId: targetPeerId,
        payload,
      });
      return;
    }

    // If connected to custom/local WebSocket server
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: payload.type,
        payload: {
          targetPeerId,
          ...payload,
        }
      }));
      return;
    }

    // Otherwise send via Cloud Mesh direct device topic
    this.publishMqttDirect(targetPeerId, payload);
  }

  private publishMqttDirect(targetDeviceId: string, payload: any) {
    if (this.mqttClient && this.mqttClient.connected) {
      const topic = `mogshare/v1/dev/${targetDeviceId}`;
      this.mqttClient.publish(topic, JSON.stringify(payload), { qos: 0 });
    }
  }

  public broadcastPresence() {
    const info = this.getMyDeviceInfo();

    // 1. BroadcastChannel
    this.broadcastChannel?.postMessage({
      type: 'tab-presence-announce',
      sender: info,
    });

    // 2. WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'register',
        payload: info,
      }));
    }

    // 3. Cloud Mesh LAN topic
    if (this.mqttClient && this.mqttClient.connected) {
      const lanTopic = `mogshare/v1/lan/${this.lanHash}`;
      this.mqttClient.publish(
        lanTopic,
        JSON.stringify({
          type: 'presence-announce',
          sender: info,
        }),
        { qos: 0 }
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
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);

    // Broadcast presence every 12 seconds to maintain radar state
    this.heartbeatInterval = setInterval(() => {
      this.broadcastPresence();
    }, 12000);

    // Prune stale peers not heard from in 40 seconds
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, peerRecord] of this.localPeersMap.entries()) {
        if (now - peerRecord.lastSeen > 40000) {
          this.localPeersMap.delete(id);
          this.callbacks.onDeviceDeparted(id);
        }
      }
    }, 10000);
  }

  private setStatus(
    status: 'connected' | 'connecting' | 'disconnected',
    mode: 'server' | 'mesh' | 'offline'
  ) {
    this.currentStatus = status;
    this.activeMode = mode;
    this.callbacks.onStatusChange(status, mode === 'offline' ? 'mesh' : mode);
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);

    // Announce departure on BroadcastChannel
    try {
      this.broadcastChannel?.postMessage({
        type: 'tab-departure',
        senderId: this.deviceId,
      });
      this.broadcastChannel?.close();
    } catch {}

    // Announce departure on LAN topic
    if (this.mqttClient && this.mqttClient.connected) {
      try {
        const lanTopic = `mogshare/v1/lan/${this.lanHash}`;
        this.mqttClient.publish(
          lanTopic,
          JSON.stringify({
            type: 'device-departed',
            deviceId: this.deviceId,
          })
        );
        this.mqttClient.end(true);
      } catch {}
    }

    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}
