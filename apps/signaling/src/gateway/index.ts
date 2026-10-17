import type { WebSocket } from 'ws';
import type { Response } from 'express';
import {
  RATE_LIMIT_MESSAGES_PER_SEC,
  MISSED_MESSAGES_BUFFER_MAX,
  MISSED_MESSAGES_BUFFER_SEC,
  createEnvelope,
  type SignalingEnvelope,
} from '@shareapp/shared';

export interface QueuedMessage {
  envelope: SignalingEnvelope;
  timestamp: number;
}

export class DeviceMessageBuffer {
  private buffers = new Map<string, QueuedMessage[]>();

  public push(deviceId: string, envelope: SignalingEnvelope) {
    // Never buffer bulk data relay frames in the control replay buffer
    if (envelope.type === 'relay-frame' || envelope.type === 'pong') return;

    let list = this.buffers.get(deviceId);
    if (!list) {
      list = [];
      this.buffers.set(deviceId, list);
    }
    list.push({ envelope, timestamp: Date.now() });

    const cutoff = Date.now() - MISSED_MESSAGES_BUFFER_SEC * 1000;
    while (
      list.length > 0 &&
      (list[0].timestamp < cutoff || list.length > MISSED_MESSAGES_BUFFER_MAX)
    ) {
      list.shift();
    }
  }

  public getMissedMessages(deviceId: string, sinceTimestamp: number): SignalingEnvelope[] {
    const list = this.buffers.get(deviceId);
    if (!list) return [];
    return list.filter((m) => m.timestamp > sinceTimestamp).map((m) => m.envelope);
  }

  public clear(deviceId: string) {
    this.buffers.delete(deviceId);
  }
}

export class RateLimiter {
  private counts = new Map<string, { count: number; resetAt: number }>();

  public check(id: string): boolean {
    const now = Date.now();
    let state = this.counts.get(id);
    if (!state || state.resetAt <= now) {
      state = { count: 1, resetAt: now + 1000 };
      this.counts.set(id, state);
      return true;
    }
    state.count++;
    return state.count <= RATE_LIMIT_MESSAGES_PER_SEC;
  }
}

export interface ClientConnection {
  deviceId: string;
  transport: 'ws' | 'sse' | 'poll';
  ws?: WebSocket;
  sseRes?: Response;
  pollRes?: Response;
  pollTimer?: NodeJS.Timeout;
  pollQueue?: SignalingEnvelope[];
}

export class Gateway {
  private connections = new Map<string, ClientConnection>();
  private turboSockets = new Map<string, Set<WebSocket>>();
  private turboRoundRobin = new Map<string, number>();
  private rateLimiter = new RateLimiter();
  private messageBuffer = new DeviceMessageBuffer();

  public registerConnection(conn: ClientConnection) {
    const prev = this.connections.get(conn.deviceId);
    // If upgrading/switching transport and there were queued poll messages, flush them to the new connection
    const pendingQueue = prev?.pollQueue && prev.pollQueue.length > 0 ? [...prev.pollQueue] : [];
    this.connections.set(conn.deviceId, conn);
    if (pendingQueue.length > 0 && conn.transport !== 'poll') {
      for (const env of pendingQueue) {
        this.sendDirect(conn, env);
      }
    }
  }

  public registerTurboSocket(deviceId: string, ws: WebSocket) {
    let set = this.turboSockets.get(deviceId);
    if (!set) {
      set = new Set();
      this.turboSockets.set(deviceId, set);
    }
    set.add(ws);
  }

  public removeTurboSocket(deviceId: string, ws: WebSocket) {
    const set = this.turboSockets.get(deviceId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        this.turboSockets.delete(deviceId);
      }
    }
  }

  public getConnection(deviceId: string): ClientConnection | undefined {
    return this.connections.get(deviceId);
  }

  public removeConnection(deviceId: string) {
    this.connections.delete(deviceId);
  }

  public checkRateLimit(id: string): boolean {
    return this.rateLimiter.check(id);
  }

  public sendToClient(deviceId: string, envelope: SignalingEnvelope): boolean {
    this.messageBuffer.push(deviceId, envelope);
    const conn = this.connections.get(deviceId);
    if (!conn) return false;
    return this.sendDirect(conn, envelope);
  }

  /**
   * High-speed zero-copy binary relay dispatch:
   * - Stripes binary frames across open turbo WebSockets and primary WebSocket
   * - Automatically falls back to Base64 JSON envelope if the recipient is on SSE/HTTP poll
   */
  public sendBinaryToClient(
    deviceId: string,
    rawFrame: Buffer | Uint8Array,
    fromDeviceId?: string
  ): boolean {
    const turboSet = this.turboSockets.get(deviceId);
    const openSockets: WebSocket[] = [];

    if (turboSet && turboSet.size > 0) {
      for (const s of turboSet) {
        if (s.readyState === 1 /* OPEN */) openSockets.push(s);
      }
    }

    const conn = this.connections.get(deviceId);
    if (conn?.transport === 'ws' && conn.ws && conn.ws.readyState === 1 /* OPEN */) {
      openSockets.push(conn.ws);
    }

    if (openSockets.length > 0) {
      // Pick the socket with the lowest bufferedAmount (or round-robin on ties)
      let chosen = openSockets[0];
      if (openSockets.length > 1) {
        const rr = (this.turboRoundRobin.get(deviceId) || 0) + 1;
        this.turboRoundRobin.set(deviceId, rr);
        chosen = openSockets[rr % openSockets.length];
        for (const candidate of openSockets) {
          if ((candidate.bufferedAmount || 0) < (chosen.bufferedAmount || 0)) {
            chosen = candidate;
          }
        }
      }
      try {
        chosen.send(rawFrame, { binary: true });
        return true;
      } catch {
        // Fallback below
      }
    }

    // Fallback for SSE or Long-Polling clients
    if (conn) {
      const b64 = Buffer.from(rawFrame.buffer, rawFrame.byteOffset, rawFrame.byteLength).toString(
        'base64'
      );
      return this.sendDirect(
        conn,
        createEnvelope('relay-frame', { data: b64, raw: true }, { from: fromDeviceId, to: deviceId })
      );
    }

    return false;
  }

  public getMissedMessages(deviceId: string, sinceTimestamp: number): SignalingEnvelope[] {
    return this.messageBuffer.getMissedMessages(deviceId, sinceTimestamp);
  }

  public replayMissed(deviceId: string, sinceTimestamp: number) {
    const missed = this.messageBuffer.getMissedMessages(deviceId, sinceTimestamp);
    const conn = this.connections.get(deviceId);
    if (!conn) return;
    for (const env of missed) {
      this.sendDirect(conn, env);
    }
  }

  private sendDirect(conn: ClientConnection, envelope: SignalingEnvelope): boolean {
    const raw = JSON.stringify(envelope);

    if (conn.transport === 'ws' && conn.ws && conn.ws.readyState === 1 /* OPEN */) {
      conn.ws.send(raw);
      return true;
    }

    if (conn.transport === 'sse' && conn.sseRes) {
      conn.sseRes.write(`data: ${raw}\n\n`);
      return true;
    }

    if (conn.transport === 'poll') {
      if (conn.pollRes && !conn.pollRes.headersSent) {
        if (conn.pollTimer) clearTimeout(conn.pollTimer);
        const batch = [...(conn.pollQueue || []), envelope];
        conn.pollQueue = [];
        const res = conn.pollRes;
        conn.pollRes = undefined;
        res.json({ messages: batch });
      } else {
        (conn.pollQueue ||= []).push(envelope);
        if (conn.pollQueue.length > 1500) conn.pollQueue.shift();
      }
      return true;
    }

    return false;
  }
}
