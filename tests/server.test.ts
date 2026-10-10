import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { WebSocket } from 'ws';
import {
  app,
  server,
  computeNetworkKey,
  checkJoinRateLimit,
  normalizeRoomCode,
  generateSecureRoomCode,
  deviceSessions,
  rooms,
  joinRateLimits,
} from '../packages/server/src/index';

let testPort = 4055;
let wsUrl = `ws://127.0.0.1:${testPort}/ws`;
let httpUrl = `http://127.0.0.1:${testPort}`;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(testPort, '127.0.0.1', () => {
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe('Phase 1 & 4: Network Grouping & Utility Tests', () => {
  it('correctly computes network keys for IPv4, IPv6, and loopback', () => {
    expect(computeNetworkKey('127.0.0.1')).toBe('local_loopback');
    expect(computeNetworkKey('::1')).toBe('local_loopback');
    expect(computeNetworkKey('::ffff:192.168.1.50')).toBe('192.168.1.50');
    expect(computeNetworkKey('73.189.42.10')).toBe('73.189.42.10');

    // IPv6: first 4 hextets (/64 prefix)
    const ipv6 = '2601:647:4e00:810:1492:cf6f:3d1e:7a8b';
    expect(computeNetworkKey(ipv6)).toBe('2601:647:4e00:810');
  });

  it('normalizes room codes to XXX-XXX format', () => {
    expect(normalizeRoomCode('123456')).toBe('123-456');
    expect(normalizeRoomCode('123-456')).toBe('123-456');
    expect(normalizeRoomCode('abc123')).toBe('ABC-123');
  });

  it('generates secure 6-digit room codes', () => {
    const code = generateSecureRoomCode();
    expect(code).toMatch(/^\d{3}-\d{3}$/);
  });

  it('enforces rate limiting on room join attempts', () => {
    const testIp = '198.51.100.99';
    joinRateLimits.delete(testIp);

    // 5 attempts should succeed
    for (let i = 0; i < 5; i++) {
      const res = checkJoinRateLimit(testIp);
      expect(res.allowed).toBe(true);
    }

    // 6th attempt should be blocked
    const blockedRes = checkJoinRateLimit(testIp);
    expect(blockedRes.allowed).toBe(false);
    expect(blockedRes.retryAfterSec).toBeGreaterThan(0);
  });
});

describe('Phase 2 & 4: Room Security & API Endpoints', () => {
  it('/api/health returns session & room counts without leaking room codes', async () => {
    const res = await fetch(`${httpUrl}/api/health`);
    const data = await res.json();

    expect(data.status).toBe('ok');
    expect(data.app).toBe('MOG-SHARE Core Node');
    expect(typeof data.activeSessions).toBe('number');
    expect(typeof data.activeRooms).toBe('number');
    // Ensure room codes are NOT leaked in response
    expect(data.rooms).toBeUndefined();
  });

  it('/api/info returns local network IPv4 interfaces and port', async () => {
    const res = await fetch(`${httpUrl}/api/info`);
    const data = await res.json();

    expect(Array.isArray(data.localIps)).toBe(true);
    expect(data.port).toBeGreaterThan(0);
  });
});

describe('WebSocket Protocol: Registration, Discovery & Room Lifecycle', () => {
  function createClient(): Promise<{ ws: WebSocket; messages: any[] }> {
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      const messages: any[] = [];
      ws.on('message', (raw) => {
        messages.push(JSON.parse(raw.toString()));
      });
      ws.on('open', () => resolve({ ws, messages }));
    });
  }

  function waitForMessage(messages: any[], predicate: (m: any) => boolean, timeoutMs = 2000): Promise<any> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        const found = messages.find(predicate);
        if (found) {
          clearInterval(interval);
          resolve(found);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          reject(new Error('Timed out waiting for message'));
        }
      }, 50);
    });
  }

  it('handles registration and sends peers-snapshot', async () => {
    const client1 = await createClient();
    const id1 = 'dev_test_1';

    client1.ws.send(
      JSON.stringify({
        type: 'register',
        payload: { id: id1, name: 'Laptop Alpha', platform: 'macos' },
      })
    );

    const snapshot = await waitForMessage(client1.messages, (m) => m.type === 'peers-snapshot');
    expect(snapshot).toBeDefined();
    expect(snapshot.payload.networkKey).toBe('local_loopback');
    expect(Array.isArray(snapshot.payload.peers)).toBe(true);

    client1.ws.close();
  });

  it('creates a room, joins, and handles host leave handover', async () => {
    const host = await createClient();
    const joiner = await createClient();

    const hostId = 'host_' + Math.random().toString(36).substring(2, 7);
    const joinerId = 'joiner_' + Math.random().toString(36).substring(2, 7);

    // Register host
    host.ws.send(
      JSON.stringify({
        type: 'register',
        payload: { id: hostId, name: 'Host Device', platform: 'macos' },
      })
    );
    await waitForMessage(host.messages, (m) => m.type === 'peers-snapshot');

    // Register joiner
    joiner.ws.send(
      JSON.stringify({
        type: 'register',
        payload: { id: joinerId, name: 'Joiner Device', platform: 'android' },
      })
    );
    await waitForMessage(joiner.messages, (m) => m.type === 'peers-snapshot');

    // Host creates room
    host.ws.send(JSON.stringify({ type: 'create-room' }));
    const roomCreated = await waitForMessage(host.messages, (m) => m.type === 'room-created');
    const roomCode = roomCreated.payload.roomCode;
    expect(roomCode).toMatch(/^\d{3}-\d{3}$/);

    // Joiner joins room
    joiner.ws.send(
      JSON.stringify({
        type: 'join-room',
        payload: { roomCode },
      })
    );

    // Joiner should receive room-joined and room-peers snapshot
    const joinerJoined = await waitForMessage(joiner.messages, (m) => m.type === 'room-joined');
    expect(joinerJoined.payload.roomCode).toBe(roomCode);

    const joinerPeers = await waitForMessage(joiner.messages, (m) => m.type === 'room-peers');
    expect(joinerPeers.payload.peers.length).toBe(1);
    expect(joinerPeers.payload.peers[0].id).toBe(hostId);

    // Host should receive peer-joined-room
    const hostNotified = await waitForMessage(host.messages, (m) => m.type === 'peer-joined-room');
    expect(hostNotified.payload.peer.id).toBe(joinerId);

    // Host leaves room
    host.ws.send(JSON.stringify({ type: 'leave-room' }));

    // Joiner should be notified that host left
    const peerLeft = await waitForMessage(joiner.messages, (m) => m.type === 'peer-left-room');
    expect(peerLeft.payload.peerId).toBe(hostId);

    // Room should now have joiner as host
    const roomRecord = rooms.get(roomCode);
    expect(roomRecord).toBeDefined();
    expect(roomRecord?.hostDeviceId).toBe(joinerId);

    host.ws.close();
    joiner.ws.close();
  });
});
