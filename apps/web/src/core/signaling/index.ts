import {
  WS_CONNECT_TIMEOUT_MS,
  TRANSPORT_LADDER_REATTEMPT_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MAX_MISSES,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  createEnvelope,
  validateEnvelope,
  type SignalingEnvelope,
} from '@shareapp/shared';

export type TransportRung = 'ws' | 'sse' | 'poll';
export type SignalingConnectionState = 'disconnected' | 'connecting' | 'connected';

export interface SignalingClientCallbacks {
  onMessage: (envelope: SignalingEnvelope) => void;
  onBinaryFrame?: (frame: Uint8Array) => void;
  onStateChange: (state: SignalingConnectionState, rung: TransportRung) => void;
  onError: (err: Error) => void;
}

const textEncoder = new TextEncoder();

function fastUint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.byteLength)))
    );
  }
  return btoa(binary);
}

export class SignalingLadderClient {
  private deviceId: string;
  private serverUrl: string;
  private callbacks: SignalingClientCallbacks;

  private activeRung: TransportRung = 'ws';
  private connectionState: SignalingConnectionState = 'disconnected';
  private resumeToken: string;

  private ws: WebSocket | null = null;
  private turboSockets: WebSocket[] = [];
  private turboInitializing = false;
  private turboRoundRobin = 0;
  private httpInFlight = 0;
  private binaryRelaySupported = false;
  private sse: EventSource | null = null;
  private pollAbort: AbortController | null = null;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatMisses = 0;
  private rungReattemptTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private wsTryCount = 0;
  private destroyed = false;
  private seq = 0;

  constructor(deviceId: string, serverUrl: string, callbacks: SignalingClientCallbacks) {
    this.deviceId = deviceId;
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.callbacks = callbacks;
    this.resumeToken = `token_${deviceId}_${Math.random().toString(36).slice(2, 10)}`;
  }

  public getActiveRung(): TransportRung {
    return this.activeRung;
  }

  public getState(): SignalingConnectionState {
    return this.connectionState;
  }

  public getResumeToken(): string {
    return this.resumeToken;
  }

  public async connect(): Promise<void> {
    if (this.destroyed) return;
    this.setState('connecting', this.activeRung);

    try {
      if (this.activeRung === 'ws') {
        await this.connectWebSocket();
      } else if (this.activeRung === 'sse') {
        await this.connectSSE();
      } else {
        await this.connectLongPoll();
      }
    } catch (err: unknown) {
      this.handleRungFailure(err as Error);
    }
  }

  public send(type: string, payload: Record<string, unknown>, to?: string): boolean {
    if (this.connectionState !== 'connected' && type !== 'join' && type !== 'resume') {
      return false;
    }

    const envelope = createEnvelope(type, payload, {
      from: this.deviceId,
      to,
      seq: ++this.seq,
    });

    return this.sendRaw(envelope);
  }

  public sendRaw(envelope: SignalingEnvelope): boolean {
    const raw = JSON.stringify(envelope);

    if (this.activeRung === 'ws' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(raw);
      return true;
    }

    if (this.activeRung === 'sse' || this.activeRung === 'poll') {
      void fetch(`${this.getHttpBaseUrl()}/api/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw,
      }).catch((err) => {
        this.callbacks.onError(new Error(`POST /api/message failed: ${err.message}`));
      });
      return true;
    }

    return false;
  }

  /**
   * Spins up parallel binary WebSocket turbo lanes (/ws?turbo=1) for multi-route online transfers
   * when connected to a binaryRelay-capable signaling server.
   */
  public ensureTurboLanes(desiredCount = 2): void {
    if (this.destroyed || typeof WebSocket === 'undefined' || !this.binaryRelaySupported) return;
    this.turboSockets = this.turboSockets.filter(
      (s) => s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING
    );
    if (this.turboSockets.length >= desiredCount || this.turboInitializing) return;
    this.turboInitializing = true;

    try {
      const toCreate = desiredCount - this.turboSockets.length;
      for (let i = 0; i < toCreate; i++) {
        const url = `${this.getWebSocketUrl()}?turbo=1&deviceId=${encodeURIComponent(this.deviceId)}&lane=${i + 1}`;
        const sock = new WebSocket(url);
        sock.binaryType = 'arraybuffer';
        sock.onopen = () => {
          try {
            sock.send(
              JSON.stringify(
                createEnvelope('register-turbo', { lane: i + 1 }, { from: this.deviceId })
              )
            );
          } catch {}
        };
        sock.onmessage = (ev) => {
          this.handleIncomingRaw(ev.data);
        };
        sock.onerror = () => {
          try {
            sock.close();
          } catch {}
        };
        sock.onclose = () => {
          this.turboSockets = this.turboSockets.filter((s) => s !== sock);
        };
        this.turboSockets.push(sock);
      }
    } catch {
      /* ignore if blocked */
    } finally {
      this.turboInitializing = false;
    }
  }

  /**
   * Packs [0x4D, 0x47, targetIdLen, ...targetIdBytes, ...rawFrame]
   * and routes across parallel Binary WebSocket lanes cleanly with TCP backpressure.
   * Only falls back to HTTP /api/turbo-relay when no WebSocket lane is open.
   */
  public sendBinaryRelay(toDeviceId: string, frame: Uint8Array): boolean {
    if (!this.binaryRelaySupported) {
      return this.send('relay-frame', { data: fastUint8ToBase64(frame), raw: true }, toDeviceId);
    }

    this.ensureTurboLanes(2);

    const openLanes: WebSocket[] = [];
    for (const s of this.turboSockets) {
      if (s.readyState === WebSocket.OPEN) openLanes.push(s);
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      openLanes.push(this.ws);
    }

    if (openLanes.length > 0) {
      this.turboRoundRobin = (this.turboRoundRobin + 1) % openLanes.length;
      let chosen = openLanes[this.turboRoundRobin];
      for (const candidate of openLanes) {
        if ((candidate.bufferedAmount || 0) < (chosen.bufferedAmount || 0)) {
          chosen = candidate;
        }
      }

      const idBytes = textEncoder.encode(toDeviceId);
      const packet = new Uint8Array(3 + idBytes.byteLength + frame.byteLength);
      packet[0] = 0x4d; // 'M'
      packet[1] = 0x47; // 'G'
      packet[2] = idBytes.byteLength;
      packet.set(idBytes, 3);
      packet.set(frame, 3 + idBytes.byteLength);

      try {
        chosen.send(packet.buffer);
        return true;
      } catch {
        // Fallback to HTTP Turbo Burst below only if WebSocket send threw
      }
    }

    // Route 3 Backup (only when no WebSocket is open): Direct HTTP Binary Burst POST /api/turbo-relay
    void this.sendHttpTurboBurst(toDeviceId, frame);
    return true;
  }

  public async sendHttpTurboBurst(toDeviceId: string, frame: Uint8Array): Promise<boolean> {
    if (this.destroyed || typeof fetch === 'undefined') return false;
    this.httpInFlight++;
    try {
      const url = `${this.getHttpBaseUrl()}/api/turbo-relay?from=${encodeURIComponent(
        this.deviceId
      )}&to=${encodeURIComponent(toDeviceId)}`;
      const copy = new Uint8Array(frame.byteLength);
      copy.set(frame);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-From-Device': this.deviceId,
          'X-To-Device': toDeviceId,
        },
        body: copy.buffer,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      this.httpInFlight = Math.max(0, this.httpInFlight - 1);
    }
  }

  public getRelayBufferedAmount(): number {
    const openLanes: WebSocket[] = [];
    for (const s of this.turboSockets) {
      if (s.readyState === WebSocket.OPEN) openLanes.push(s);
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      openLanes.push(this.ws);
    }
    if (openLanes.length === 0) return this.httpInFlight * 256 * 1024;
    let minBuf = Infinity;
    for (const lane of openLanes) {
      const b = lane.bufferedAmount || 0;
      if (b < minBuf) minBuf = b;
    }
    return minBuf === Infinity ? 0 : minBuf;
  }

  public async waitForRelayDrain(thresholdBytes = 1024 * 1024): Promise<void> {
    let waited = 0;
    while (!this.destroyed && this.getRelayBufferedAmount() > thresholdBytes && waited < 1200) {
      await new Promise((r) => setTimeout(r, 6));
      waited += 6;
    }
  }

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const wsUrl = this.getWebSocketUrl();

      try {
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';
      } catch (err) {
        return reject(err);
      }

      const timeoutTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            this.ws?.close();
          } catch {}
          reject(new Error(`WebSocket connection timed out after ${WS_CONNECT_TIMEOUT_MS}ms`));
        }
      }, WS_CONNECT_TIMEOUT_MS);

      this.ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        this.wsTryCount = 0;
        this.onConnected('ws');
        resolve();
      };

      this.ws.onmessage = (ev) => {
        this.handleIncomingRaw(ev.data);
      };

      this.ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutTimer);
          reject(new Error('WebSocket connection error'));
        }
      };

      this.ws.onclose = () => {
        if (settled && !this.destroyed && this.activeRung === 'ws') {
          this.onConnectionLost();
        }
      };
    });
  }

  private connectSSE(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const sseUrl = `${this.getHttpBaseUrl()}/api/events?deviceId=${encodeURIComponent(this.deviceId)}`;

      try {
        this.sse = new EventSource(sseUrl);
      } catch (err) {
        return reject(err);
      }

      const timeoutTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            this.sse?.close();
          } catch {}
          reject(new Error('SSE connection timed out'));
        }
      }, WS_CONNECT_TIMEOUT_MS);

      this.sse.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        this.onConnected('sse');
        resolve();
      };

      this.sse.onmessage = (ev) => {
        this.handleIncomingRaw(ev.data);
      };

      this.sse.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutTimer);
          reject(new Error('SSE connection failed'));
        } else if (!this.destroyed && this.activeRung === 'sse') {
          this.onConnectionLost();
        }
      };
    });
  }

  private async connectLongPoll(): Promise<void> {
    this.pollAbort = new AbortController();
    this.onConnected('poll');
    void this.pollLoop();
  }

  private async pollLoop() {
    let lastPollTime = Date.now();
    while (!this.destroyed && this.activeRung === 'poll' && this.connectionState === 'connected') {
      try {
        const url = `${this.getHttpBaseUrl()}/api/poll?deviceId=${encodeURIComponent(this.deviceId)}&since=${lastPollTime}`;
        lastPollTime = Date.now();
        const res = await fetch(url, {
          signal: this.pollAbort?.signal,
        });
        if (!res.ok) throw new Error(`Poll HTTP ${res.status}`);
        const data = await res.json();
        if (data.messages && Array.isArray(data.messages)) {
          for (const msg of data.messages) {
            this.callbacks.onMessage(msg);
          }
        }
      } catch (err: any) {
        if (this.destroyed || err?.name === 'AbortError' || this.activeRung !== 'poll') return;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  }

  private unwrapBinaryPayload(bytes: Uint8Array): Uint8Array {
    if (bytes.byteLength > 4 && bytes[0] === 0x4d && bytes[1] === 0x47) {
      const idLen = bytes[2];
      if (idLen > 0 && 3 + idLen < bytes.byteLength) {
        return bytes.subarray(3 + idLen);
      }
    }
    return bytes;
  }

  private handleIncomingRaw(data: any) {
    // Fast-path: Zero-copy binary frame delivered from WebSocket turbo or primary lane
    if (data instanceof ArrayBuffer) {
      this.callbacks.onBinaryFrame?.(this.unwrapBinaryPayload(new Uint8Array(data)));
      return;
    }
    if (data instanceof Uint8Array) {
      this.callbacks.onBinaryFrame?.(this.unwrapBinaryPayload(data));
      return;
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      void data.arrayBuffer().then((ab) => {
        this.callbacks.onBinaryFrame?.(this.unwrapBinaryPayload(new Uint8Array(ab)));
      });
      return;
    }

    try {
      const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
      const parsed = JSON.parse(str);
      const envelope = validateEnvelope(parsed);

      if (envelope.type === 'pong') {
        this.heartbeatMisses = 0;
      }

      if (
        envelope.payload &&
        typeof envelope.payload === 'object' &&
        (envelope.payload as Record<string, unknown>).binaryRelay === true
      ) {
        this.binaryRelaySupported = true;
      }

      this.callbacks.onMessage(envelope);
    } catch {
      // Ignore malformed frames
    }
  }

  private onConnected(rung: TransportRung) {
    this.reconnectAttempt = 0;
    this.heartbeatMisses = 0;
    this.setState('connected', rung);
    this.startHeartbeat();
    this.startRungReattemptTimer();
  }

  private onConnectionLost() {
    this.setState('disconnected', this.activeRung);
    this.cleanupTransports();
    this.scheduleReconnect();
  }

  private handleRungFailure(_err: Error) {
    this.cleanupTransports();
    if (this.activeRung === 'ws') {
      this.wsTryCount++;
      if (this.wsTryCount < 2) {
        setTimeout(() => {
          if (!this.destroyed) void this.connect();
        }, 600);
        return;
      }
      this.wsTryCount = 0;
      this.activeRung = 'sse';
      void this.connect();
    } else if (this.activeRung === 'sse') {
      this.activeRung = 'poll';
      void this.connect();
    } else {
      this.activeRung = 'ws';
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.destroyed) return;
    this.reconnectAttempt++;
    const maxDelay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * Math.pow(1.5, Math.min(this.reconnectAttempt, 6))
    );
    const delay = Math.floor(Math.random() * maxDelay) + RECONNECT_BASE_DELAY_MS;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.activeRung = 'ws';
      void this.connect();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    if (this.connectionState === 'connected') {
      this.send('ping', { clientTime: Date.now() });
    }
    this.heartbeatTimer = setInterval(() => {
      if (this.connectionState !== 'connected') return;

      this.heartbeatMisses++;
      if (this.heartbeatMisses >= HEARTBEAT_MAX_MISSES) {
        this.onConnectionLost();
        return;
      }

      this.send('ping', { clientTime: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startRungReattemptTimer() {
    if (this.rungReattemptTimer) return;
    this.rungReattemptTimer = setInterval(() => {
      if (this.activeRung !== 'ws' && this.connectionState === 'connected' && !this.destroyed) {
        this.tryBackgroundWebSocketUpgrade();
      }
    }, TRANSPORT_LADDER_REATTEMPT_MS);
  }

  private tryBackgroundWebSocketUpgrade() {
    try {
      const wsUrl = this.getWebSocketUrl();
      const candidateWs = new WebSocket(wsUrl);
      candidateWs.binaryType = 'arraybuffer';
      const timer = setTimeout(() => {
        try {
          candidateWs.close();
        } catch {}
      }, 5000);

      candidateWs.onopen = () => {
        clearTimeout(timer);
        if (this.destroyed) {
          candidateWs.close();
          return;
        }
        if (this.sse) {
          try {
            this.sse.close();
          } catch {}
          this.sse = null;
        }
        if (this.pollAbort) {
          try {
            this.pollAbort.abort();
          } catch {}
          this.pollAbort = null;
        }
        this.ws = candidateWs;
        this.ws.onmessage = (ev) => this.handleIncomingRaw(ev.data);
        this.ws.onclose = () => {
          if (!this.destroyed && this.activeRung === 'ws') {
            this.onConnectionLost();
          }
        };
        this.onConnected('ws');
      };

      candidateWs.onerror = () => {
        clearTimeout(timer);
        try {
          candidateWs.close();
        } catch {}
      };
    } catch {
      /* keep current rung */
    }
  }

  private stopRungReattemptTimer() {
    if (this.rungReattemptTimer) {
      clearInterval(this.rungReattemptTimer);
      this.rungReattemptTimer = null;
    }
  }

  private cleanupTransports() {
    this.stopHeartbeat();
    for (const s of this.turboSockets) {
      try {
        s.close();
      } catch {}
    }
    this.turboSockets = [];
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    if (this.sse) {
      try {
        this.sse.close();
      } catch {}
      this.sse = null;
    }
    if (this.pollAbort) {
      try {
        this.pollAbort.abort();
      } catch {}
      this.pollAbort = null;
    }
  }

  private setState(state: SignalingConnectionState, rung: TransportRung) {
    this.connectionState = state;
    this.activeRung = rung;
    this.callbacks.onStateChange(state, rung);
  }

  private getWebSocketUrl(): string {
    const isHttps = this.serverUrl.startsWith('https://');
    const wsProto = isHttps ? 'wss:' : 'ws:';
    const host = this.serverUrl.replace(/^https?:\/\//, '');
    return `${wsProto}//${host}/ws`;
  }

  private getHttpBaseUrl(): string {
    return this.serverUrl;
  }

  public destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.stopRungReattemptTimer();
    this.cleanupTransports();
    this.setState('disconnected', this.activeRung);
  }
}
