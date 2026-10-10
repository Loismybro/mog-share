import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { server, wss } from '../src/index';

let testPort: number;
let wsUrl: string;

class TestClient {
  public ws: WebSocket;
  private queue: any[] = [];
  private waiter: ((msg: any) => void) | null = null;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (this.waiter) {
          const w = this.waiter;
          this.waiter = null;
          w(msg);
        } else {
          this.queue.push(msg);
        }
      } catch { /* ignore */ }
    });
  }

  send(obj: any) {
    this.ws.send(JSON.stringify(obj));
  }

  async waitFor(predicate: (msg: any) => boolean, timeoutMs = 4000): Promise<any> {
    const idx = this.queue.findIndex(predicate);
    if (idx !== -1) {
      return this.queue.splice(idx, 1)[0];
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error(`Timeout waiting for message after ${timeoutMs}ms`));
      }, timeoutMs);

      const check = (msg: any) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          resolve(msg);
        } else {
          this.queue.push(msg);
          this.waiter = check;
        }
      };
      this.waiter = check;
    });
  }

  close() {
    this.ws.close();
  }
}

function openClient(): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => resolve(new TestClient(ws)));
    ws.on('error', reject);
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      testPort = addr.port;
      wsUrl = `ws://127.0.0.1:${testPort}/ws`;
      resolve();
    });
  });
});

afterAll(async () => {
  for (const client of wss.clients) {
    client.terminate();
  }
  await new Promise<void>((resolve) => {
    wss.close(() => {
      server.close(() => resolve());
    });
  });
});

describe('MogShare WebSocket Network Integration', () => {
  it('registers devices and broadcasts peer snapshots / discovery', async () => {
    const clientA = await openClient();
    const clientB = await openClient();

    // Register Client A
    clientA.send({
      type: 'register',
      payload: {
        id: 'test-dev-A',
        name: 'iPhone (4A)',
        platform: 'ios',
        networkHint: '198.51.100.10',
      },
    });

    const snapA1 = await clientA.waitFor((m) => m.type === 'peers-snapshot');
    expect(snapA1.payload.peers).toBeInstanceOf(Array);

    // Register Client B on same network hint
    clientB.send({
      type: 'register',
      payload: {
        id: 'test-dev-B',
        name: 'MacBook (F2)',
        platform: 'macos',
        networkHint: '198.51.100.10',
      },
    });

    // Client B gets snapshot containing Client A
    const snapB = await clientB.waitFor((m) => m.type === 'peers-snapshot');
    expect(snapB.payload.peers.some((p: any) => p.id === 'test-dev-A')).toBe(true);

    // Client A receives device-discovered for Client B
    const discA = await clientA.waitFor((m) => m.type === 'device-discovered');
    expect(discA.payload.device.id).toBe('test-dev-B');
    expect(discA.payload.device.name).toBe('MacBook (F2)');

    clientA.close();
    clientB.close();
  });

  it('immediately returns transfer-failed when target peer is offline (zero stall)', async () => {
    const clientA = await openClient();

    clientA.send({
      type: 'register',
      payload: {
        id: 'test-dev-A2',
        name: 'Windows PC (3B)',
        platform: 'windows',
      },
    });
    await clientA.waitFor((m) => m.type === 'peers-snapshot');

    // Send transfer-request to non-existent peer
    const start = Date.now();
    clientA.send({
      type: 'transfer-request',
      payload: {
        targetId: 'non-existent-device-id',
        transferId: 'tx-12345',
        meta: { name: 'test.txt', size: 100, type: 'text/plain' },
      },
    });

    // Server must respond immediately with transfer-failed
    const failMsg = await clientA.waitFor((m) => m.type === 'transfer-failed');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000); // Sub-second, never hangs
    expect(failMsg.payload.transferId).toBe('tx-12345');
    expect(failMsg.payload.error).toContain('unavailable or disconnected');

    clientA.close();
  });

  it('handles room creation, joining, and room peers lifecycle', async () => {
    const clientA = await openClient();
    const clientB = await openClient();

    clientA.send({
      type: 'register',
      payload: { id: 'room-user-A', name: 'User A', platform: 'web' },
    });
    await clientA.waitFor((m) => m.type === 'peers-snapshot');

    clientB.send({
      type: 'register',
      payload: { id: 'room-user-B', name: 'User B', platform: 'web' },
    });
    await clientB.waitFor((m) => m.type === 'peers-snapshot');

    // Client A creates room
    clientA.send({ type: 'create-room' });
    const createdMsg = await clientA.waitFor((m) => m.type === 'room-created');
    const roomCode = createdMsg.payload.roomCode;
    expect(roomCode).toMatch(/^\d{6}$/);

    // Client B joins room
    clientB.send({
      type: 'join-room',
      payload: { roomCode },
    });
    const joinedMsg = await clientB.waitFor((m) => m.type === 'room-joined');
    expect(joinedMsg.payload.roomCode).toBe(roomCode);

    // Client B receives room-peers list containing Client A
    const roomPeersB = await clientB.waitFor((m) => m.type === 'room-peers');
    expect(roomPeersB.payload.peers.some((p: any) => p.id === 'room-user-A')).toBe(true);

    // Client A receives peer-joined-room event
    const peerJoined = await clientA.waitFor((m) => m.type === 'peer-joined-room');
    expect(peerJoined.payload.peer.id).toBe('room-user-B');

    // Client B leaves room
    clientB.send({ type: 'leave-room' });
    const peerLeft = await clientA.waitFor((m) => m.type === 'peer-left-room');
    expect(peerLeft.payload.peerId).toBe('room-user-B');

    clientA.close();
    clientB.close();
  });

  it('routes transfer-fallback for graceful relay transitions', async () => {
    const clientA = await openClient();
    const clientB = await openClient();

    clientA.send({
      type: 'register',
      payload: { id: 'fallback-A', name: 'Sender', platform: 'linux' },
    });
    await clientA.waitFor((m) => m.type === 'peers-snapshot');

    clientB.send({
      type: 'register',
      payload: { id: 'fallback-B', name: 'Receiver', platform: 'android' },
    });
    await clientB.waitFor((m) => m.type === 'peers-snapshot');

    // Client A sends transfer-fallback destined for Client B
    clientA.send({
      type: 'transfer-fallback',
      payload: {
        targetId: 'fallback-B',
        transferId: 'fb-999',
        reason: 'ice-failed',
      },
    });

    // Client B should receive the fallback notification
    const fallbackB = await clientB.waitFor((m) => m.type === 'transfer-fallback');
    expect(fallbackB.payload.fromId).toBe('fallback-A');
    expect(fallbackB.payload.transferId).toBe('fb-999');
    expect(fallbackB.payload.reason).toBe('ice-failed');

    clientA.close();
    clientB.close();
  });
});
