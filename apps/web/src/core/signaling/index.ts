import {
  PROTOCOL_VERSION,
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
  onStateChange: (state: SignalingConnectionState, rung: TransportRung) => void;
  onError: (err: Error) => void;
}

export class SignalingLadderClient {
  private deviceId: string;
  private serverUrl: string;
  private callbacks: SignalingClientCallbacks;

  private activeRung: TransportRung = 'ws';
  private connectionState: SignalingConnectionState = 'disconnected';
  private resumeToken: string;

  private ws: WebSocket | null = null;
  private sse: EventSource | null = null;
  private pollAbort: AbortController | null = null;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatMisses = 0;
  private rungReattemptTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
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

    // For SSE or long-poll, messages up are sent via POST /api/message
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

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const wsUrl = this.getWebSocketUrl();

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        return reject(err);
      }

      const timeoutTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { this.ws?.close(); } catch {}
          reject(new Error(`WebSocket connection timed out after ${WS_CONNECT_TIMEOUT_MS}ms`));
        }
      }, WS_CONNECT_TIMEOUT_MS);

      this.ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        this.onConnected('ws');
        resolve();
      };

      this.ws.onmessage = (ev) => {
        this.handleIncomingRaw(ev.data);
      };

      this.ws.onerror = (ev) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutTimer);
          reject(new Error('WebSocket connection error'));
        }
      };

      this.ws.onclose = () => {
        if (settled && !this.destroyed) {
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
          try { this.sse?.close(); } catch {}
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

      this.sse.onerror = (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutTimer);
          reject(new Error('SSE connection failed'));
        } else if (!this.destroyed) {
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
        if (this.destroyed || err.name === 'AbortError') return;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private handleIncomingRaw(data: any) {
    try {
      const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
      const parsed = JSON.parse(str);
      const envelope = validateEnvelope(parsed);

      if (envelope.type === 'pong') {
        this.heartbeatMisses = 0;
        return;
      }

      this.callbacks.onMessage(envelope);
    } catch (err: unknown) {
      // Ignore or log malformed signaling frames
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

  private handleRungFailure(err: Error) {
    this.cleanupTransports();
    // Step down ladder
    if (this.activeRung === 'ws') {
      this.activeRung = 'sse';
      void this.connect();
    } else if (this.activeRung === 'sse') {
      this.activeRung = 'poll';
      void this.connect();
    } else {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.destroyed) return;
    this.reconnectAttempt++;
    // Exponential backoff with full jitter: min(RECONNECT_MAX_DELAY_MS, base * 2^attempt) * random
    const maxDelay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * Math.pow(1.5, Math.min(this.reconnectAttempt, 8))
    );
    const delay = Math.floor(Math.random() * maxDelay) + RECONNECT_BASE_DELAY_MS;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.connectionState !== 'connected') return;

      this.heartbeatMisses++;
      if (this.heartbeatMisses >= HEARTBEAT_MAX_MISSES) {
        this.onConnectionLost();
        return;
      }

      this.send('ping', {});
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
      // If we are on SSE or Poll, re-attempt higher rung
      if (this.activeRung !== 'ws' && this.connectionState === 'connected') {
        this.activeRung = 'ws';
        this.cleanupTransports();
        void this.connect();
      }
    }, TRANSPORT_LADDER_REATTEMPT_MS);
  }

  private stopRungReattemptTimer() {
    if (this.rungReattemptTimer) {
      clearInterval(this.rungReattemptTimer);
      this.rungReattemptTimer = null;
    }
  }

  private cleanupTransports() {
    this.stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    if (this.sse) {
      try { this.sse.close(); } catch {}
      this.sse = null;
    }
    if (this.pollAbort) {
      try { this.pollAbort.abort(); } catch {}
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
