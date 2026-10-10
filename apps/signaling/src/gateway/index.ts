import type { WebSocket } from 'ws';
import type { Response } from 'express';
import {
  MAX_SIGNALING_MESSAGE_SIZE,
  RATE_LIMIT_MESSAGES_PER_SEC,
  MISSED_MESSAGES_BUFFER_MAX,
  MISSED_MESSAGES_BUFFER_SEC,
  validateEnvelope,
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
    let list = this.buffers.get(deviceId);
    if (!list) {
      list = [];
      this.buffers.set(deviceId, list);
    }
    list.push({ envelope, timestamp: Date.now() });

    // Prune buffer
    const cutoff = Date.now() - MISSED_MESSAGES_BUFFER_SEC * 1000;
    while (list.length > 0 && (list[0].timestamp < cutoff || list.length > MISSED_MESSAGES_BUFFER_MAX)) {
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
}

export class Gateway {
  private connections = new Map<string, ClientConnection>();
  private rateLimiter = new RateLimiter();
  private messageBuffer = new DeviceMessageBuffer();

  public registerConnection(conn: ClientConnection) {
    this.connections.set(conn.deviceId, conn);
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

    const raw = JSON.stringify(envelope);

    if (conn.transport === 'ws' && conn.ws && conn.ws.readyState === 1 /* OPEN */) {
      conn.ws.send(raw);
      return true;
    }

    if (conn.transport === 'sse' && conn.sseRes) {
      conn.sseRes.write(`data: ${raw}\n\n`);
      return true;
    }

    if (conn.transport === 'poll' && conn.pollRes) {
      if (conn.pollTimer) clearTimeout(conn.pollTimer);
      conn.pollRes.json(envelope);
      conn.pollRes = undefined;
      return true;
    }

    return false;
  }

  public replayMissed(deviceId: string, sinceTimestamp: number) {
    const missed = this.messageBuffer.getMissedMessages(deviceId, sinceTimestamp);
    for (const env of missed) {
      this.sendToClient(deviceId, env);
    }
  }
}
