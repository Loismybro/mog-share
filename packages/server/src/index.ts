import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import {
  computeNetworkKey,
  areDevicesOnSameNetwork,
  extractClientIp,
  normalizeRoomCode,
  generateRoomCode,
  checkJoinRate,
  type RateState,
} from './lib';

// ---------------------------------------------------------------------------
// App / HTTP setup (Phase 4 hardening)
// ---------------------------------------------------------------------------
const app = express();
app.set('trust proxy', true); // D1: honor proxy headers (Render, Cloudflare)

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors(
    ALLOWED_ORIGINS.length > 0
      ? { origin: ALLOWED_ORIGINS }
      : {} // default: allow all in dev / same-origin prod
  )
);
app.use(express.json({ limit: '64kb' }));

// Minimal security headers (helmet-lite, no extra dependency)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const server = http.createServer(app);

// Phase 4: cap WebSocket payloads at 1 MB (default is 100 MB)
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 * 1024 * 1024 });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
const PLATFORMS = ['ios', 'android', 'macos', 'windows', 'linux', 'web'] as const;
type Platform = (typeof PLATFORMS)[number];

interface DeviceInfo {
  id: string;
  name: string;
  platform: Platform;
  clientIp: string;
  networkKey: string; // D1: public-IP or LAN grouping key
  networkHint?: string; // STUN public IP or local subnet hint
  roomCode?: string;
  joinedAt: number;
}

interface DeviceSession {
  ws: WebSocket | null;
  info: DeviceInfo;
  disconnectTimer?: NodeJS.Timeout;
}

interface RoomRecord {
  code: string;
  hostDeviceId: string;
  peerIds: Set<string>;
  createdAt: number;
  lastActivity: number;
}

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------
const deviceSessions = new Map<string, DeviceSession>();
const wsToDeviceId = new Map<WebSocket, string>();
const rooms = new Map<string, RoomRecord>();

// R4: join-room rate limiting — 5 attempts / minute / IP with short lockout
const joinAttempts = new Map<string, RateState>();
const MAX_ROOM_PEERS = 10; // R4
const ROOM_HARD_TTL_MS = 24 * 60 * 60 * 1000; // R5: 24 h
const ROOM_IDLE_TTL_MS = 30 * 60 * 1000; // R5: 30 min

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Phase 4: bounded-string message validation (zod-lite, zero deps). */
function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return (s || 'Unknown device').slice(0, 40);
}
function cleanPlatform(raw: unknown): Platform {
  return PLATFORMS.includes(raw as Platform) ? (raw as Platform) : 'web';
}
function cleanId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s.length < 4 || s.length > 64) return null;
  if (!/^[\w-]+$/.test(s)) return null;
  return s;
}

function send(ws: WebSocket | null | undefined, type: string, payload: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

function publicDevice(info: DeviceInfo) {
  return {
    id: info.id,
    name: info.name,
    platform: info.platform,
    isLocal: true,
    status: 'online' as const,
  };
}

/** D1: notify ONLY sessions sharing the same network group (LAN, Hotspots, 5GHz/2.4GHz). */
function broadcastToNetwork(sourceInfo: DeviceInfo, exceptId: string, type: string, payload: unknown) {
  for (const [id, sess] of deviceSessions) {
    if (id === exceptId) continue;
    if (!areDevicesOnSameNetwork(sourceInfo, sess.info)) continue;
    send(sess.ws, type, payload);
  }
}

function broadcastToRoom(room: RoomRecord, exceptId: string, type: string, payload: unknown) {
  for (const pid of room.peerIds) {
    if (pid === exceptId) continue;
    send(deviceSessions.get(pid)?.ws, type, payload);
  }
}

function roomPeersPayload(room: RoomRecord, forDeviceId: string) {
  const peers = Array.from(room.peerIds)
    .filter((pid) => pid !== forDeviceId)
    .map((pid) => {
      const s = deviceSessions.get(pid);
      if (!s) return null;
      return {
        id: s.info.id,
        name: s.info.name,
        platform: s.info.platform,
        isLocal: false,
        status: s.ws && s.ws.readyState === WebSocket.OPEN ? ('online' as const) : ('busy' as const),
      };
    })
    .filter(Boolean);
  return { roomCode: room.code, peers };
}

function leaveRoom(session: DeviceSession, notifySelf = false) {
  const code = session.info.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  session.info.roomCode = undefined;
  if (!room) return;

  room.peerIds.delete(session.info.id);
  room.lastActivity = Date.now();

  if (room.peerIds.size === 0) {
    rooms.delete(code);
  } else {
    // R5: host handover — oldest remaining peer becomes host
    if (room.hostDeviceId === session.info.id) {
      let oldest: { id: string; joinedAt: number } | null = null;
      for (const pid of room.peerIds) {
        const s = deviceSessions.get(pid);
        if (s && (!oldest || s.info.joinedAt < oldest.joinedAt)) {
          oldest = { id: pid, joinedAt: s.info.joinedAt };
        }
      }
      if (oldest) room.hostDeviceId = oldest.id;
    }
    broadcastToRoom(room, session.info.id, 'peer-left-room', { peerId: session.info.id });
  }
  if (notifySelf) send(session.ws, 'room-left', { roomCode: code });
}

// ---------------------------------------------------------------------------
// R5: room pruning — hard TTL, idle TTL, all-disconnected rooms
// ---------------------------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const hardExpired = now - room.createdAt > ROOM_HARD_TTL_MS;
    const idleExpired = now - room.lastActivity > ROOM_IDLE_TTL_MS;
    let anyLive = false;
    for (const pid of room.peerIds) {
      const s = deviceSessions.get(pid);
      if (s?.ws && s.ws.readyState === WebSocket.OPEN) { anyLive = true; break; }
    }
    if (hardExpired || idleExpired || room.peerIds.size === 0 || !anyLive) {
      for (const pid of room.peerIds) {
        const s = deviceSessions.get(pid);
        if (s) {
          s.info.roomCode = undefined;
          send(s.ws, 'room-left', { roomCode: code, reason: 'expired' });
        }
      }
      rooms.delete(code);
      console.log(`[mog-share] Pruned room ${code}`);
    }
  }
}, 60_000);

// ---------------------------------------------------------------------------
// D5: WebSocket keep-alive — ping every 25 s, terminate on missed pong
// ---------------------------------------------------------------------------
const aliveSockets = new WeakMap<WebSocket, boolean>();
setInterval(() => {
  for (const ws of wss.clients) {
    if (aliveSockets.get(ws) === false) {
      ws.terminate();
      continue;
    }
    aliveSockets.set(ws, false);
    try { ws.ping(); } catch { /* socket already dead */ }
  }
}, 25_000);

// ---------------------------------------------------------------------------
// WebSocket handling
// ---------------------------------------------------------------------------
wss.on('connection', (ws: WebSocket, req) => {
  const clientIp = extractClientIp(req);
  const networkKey = computeNetworkKey(clientIp);
  aliveSockets.set(ws, true);
  ws.on('pong', () => aliveSockets.set(ws, true));

  ws.on('message', (rawData) => {
    let message: { type?: unknown; payload?: unknown };
    try {
      message = JSON.parse(rawData.toString());
    } catch {
      return;
    }
    const type = typeof message.type === 'string' ? message.type : '';
    const payload = (message.payload ?? {}) as Record<string, unknown>;

    switch (type) {
      case 'ping': {
        send(ws, 'pong', { timestamp: Date.now() });
        break;
      }

      case 'register': {
        const deviceId = cleanId(payload.id);
        if (!deviceId) {
          send(ws, 'error', { message: 'Invalid device id.' });
          return;
        }

        // D9: reject a second live connection with the same device id
        const existing = deviceSessions.get(deviceId);
        if (existing?.ws && existing.ws.readyState === WebSocket.OPEN && existing.ws !== ws) {
          send(ws, 'id-conflict', { id: deviceId });
          return;
        }

        wsToDeviceId.set(ws, deviceId);

        const networkHint = typeof payload.networkHint === 'string' ? payload.networkHint.trim().slice(0, 64) : undefined;
        let session = deviceSessions.get(deviceId);
        if (session) {
          if (session.disconnectTimer) {
            clearTimeout(session.disconnectTimer);
            session.disconnectTimer = undefined;
          }
          session.ws = ws;
          session.info.name = cleanName(payload.name ?? session.info.name);
          session.info.platform = cleanPlatform(payload.platform ?? session.info.platform);
          session.info.clientIp = clientIp;
          session.info.networkKey = networkKey;
          if (networkHint) session.info.networkHint = networkHint;

          // Restore room membership after reconnect
          if (session.info.roomCode) {
            const activeRoom = rooms.get(session.info.roomCode);
            if (activeRoom && activeRoom.peerIds.has(deviceId)) {
              activeRoom.lastActivity = Date.now();
              send(ws, 'room-joined', { roomCode: session.info.roomCode });
              send(ws, 'room-peers', roomPeersPayload(activeRoom, deviceId));
              broadcastToRoom(activeRoom, deviceId, 'peer-joined-room', {
                peer: { ...publicDevice(session.info), isLocal: false },
              });
            } else {
              session.info.roomCode = undefined;
            }
          }
        } else {
          session = {
            ws,
            info: {
              id: deviceId,
              name: cleanName(payload.name),
              platform: cleanPlatform(payload.platform),
              clientIp,
              networkKey,
              networkHint,
              joinedAt: Date.now(),
            },
          };
          deviceSessions.set(deviceId, session);
        }

        // D1: send the registering client a full snapshot of its network group
        const snapshot = [];
        for (const [id, s] of deviceSessions) {
          if (id === deviceId) continue;
          if (!areDevicesOnSameNetwork(session.info, s.info)) continue;
          if (!s.ws || s.ws.readyState !== WebSocket.OPEN) continue;
          snapshot.push(publicDevice(s.info));
        }
        send(ws, 'peers-snapshot', { peers: snapshot, networkKey: session.info.networkKey });

        // ...and tell the rest of the group about this device only.
        broadcastToNetwork(session.info, deviceId, 'device-discovered', {
          device: publicDevice(session.info),
        });
        break;
      }

      case 'network-hint': {
        const deviceId = wsToDeviceId.get(ws);
        const session = deviceId ? deviceSessions.get(deviceId) : null;
        if (!session) return;
        const hint = typeof payload.hint === 'string' ? payload.hint.trim().slice(0, 64) : '';
        if (hint && hint !== session.info.networkHint) {
          session.info.networkHint = hint;
          const snapshot = [];
          for (const [id, s] of deviceSessions) {
            if (id === deviceId) continue;
            if (!areDevicesOnSameNetwork(session.info, s.info)) continue;
            if (!s.ws || s.ws.readyState !== WebSocket.OPEN) continue;
            snapshot.push(publicDevice(s.info));
          }
          send(ws, 'peers-snapshot', { peers: snapshot, networkKey: session.info.networkKey });
          broadcastToNetwork(session.info, deviceId, 'device-discovered', {
            device: publicDevice(session.info),
          });
        }
        break;
      }

      case 'create-room': {
        const deviceId = wsToDeviceId.get(ws);
        const session = deviceId ? deviceSessions.get(deviceId) : null;
        if (!session) {
          send(ws, 'error', { message: 'Register before creating a room.' });
          return;
        }
        leaveRoom(session);

        let code = generateRoomCode();
        while (rooms.has(code)) code = generateRoomCode();

        const room: RoomRecord = {
          code,
          hostDeviceId: session.info.id,
          peerIds: new Set([session.info.id]),
          createdAt: Date.now(),
          lastActivity: Date.now(),
        };
        rooms.set(code, room);
        session.info.roomCode = code;
        send(ws, 'room-created', { roomCode: code });
        console.log(`[mog-share] Room ${code} created by ${session.info.name}`);
        break;
      }

      case 'join-room': {
        const deviceId = wsToDeviceId.get(ws);
        const session = deviceId ? deviceSessions.get(deviceId) : null;
        if (!session) {
          send(ws, 'error', { message: 'Register before joining a room.' });
          return;
        }

        // R4: rate limit by IP
        const { allowed, next } = checkJoinRate(joinAttempts.get(clientIp), Date.now());
        joinAttempts.set(clientIp, next);
        if (!allowed) {
          send(ws, 'room-error', { message: 'Too many attempts. Try again in a couple of minutes.' });
          return;
        }

        const targetCode = normalizeRoomCode(String(payload.roomCode ?? ''));
        const room = targetCode.length === 6 ? rooms.get(targetCode) : undefined;

        if (!room) {
          send(ws, 'room-error', { message: 'Room not found or expired.', roomCode: targetCode });
          return;
        }
        if (!room.peerIds.has(session.info.id) && room.peerIds.size >= MAX_ROOM_PEERS) {
          send(ws, 'room-error', { message: 'Room is full (max 10 devices).', roomCode: targetCode });
          return;
        }

        if (session.info.roomCode && session.info.roomCode !== targetCode) {
          leaveRoom(session);
        }

        room.peerIds.add(session.info.id);
        room.lastActivity = Date.now();
        session.info.roomCode = targetCode;

        send(ws, 'room-joined', { roomCode: targetCode });
        send(ws, 'room-peers', roomPeersPayload(room, session.info.id));
        broadcastToRoom(room, session.info.id, 'peer-joined-room', {
          peer: { ...publicDevice(session.info), isLocal: false },
        });
        break;
      }

      case 'leave-room': {
        const deviceId = wsToDeviceId.get(ws);
        const session = deviceId ? deviceSessions.get(deviceId) : null;
        if (!session) return;
        leaveRoom(session, true);
        break;
      }

      // WebRTC signaling relay (offer / answer / ICE) — used by the P2P engine
      case 'signal': {
        const fromId = wsToDeviceId.get(ws);
        const targetId = cleanId(payload.targetId);
        if (!fromId || !targetId) return;
        const target = deviceSessions.get(targetId);
        send(target?.ws, 'signal', { fromId, data: payload.data });
        break;
      }

      case 'clipboard-broadcast': {
        const deviceId = wsToDeviceId.get(ws);
        const session = deviceId ? deviceSessions.get(deviceId) : null;
        if (!session) return;
        const content = typeof payload.content === 'string' ? payload.content.slice(0, 100_000) : '';
        if (!content) return;
        const out = {
          fromDevice: session.info.name,
          content,
          timestamp: Date.now(),
        };
        const room = session.info.roomCode ? rooms.get(session.info.roomCode) : undefined;
        if (room) {
          room.lastActivity = Date.now();
          broadcastToRoom(room, session.info.id, 'clipboard-received', out);
        } else {
          // D1: local branch is scoped to the same network group only
          broadcastToNetwork(session.info, session.info.id, 'clipboard-received', out);
        }
        break;
      }

      // Direct, targeted transfer messages (relay fallback path)
      case 'transfer-request':
      case 'transfer-response':
      case 'file-chunk':
      case 'transfer-complete':
      case 'transfer-cancel':
      case 'transfer-fallback':
      case 'direct-message': {
        const fromId = wsToDeviceId.get(ws);
        const targetId = cleanId(payload.targetId);
        if (!fromId || !targetId) return;
        const fromSession = deviceSessions.get(fromId);
        const target = deviceSessions.get(targetId);
        if (!fromSession || !target || !target.ws || target.ws.readyState !== WebSocket.OPEN) {
          if (type === 'transfer-request' || type === 'file-chunk') {
            send(ws, 'transfer-failed', {
              transferId: payload.transferId,
              error: 'Recipient is unavailable or disconnected',
            });
          }
          return;
        }
        // Keep room activity fresh during transfers
        if (fromSession.info.roomCode) {
          const room = rooms.get(fromSession.info.roomCode);
          if (room) room.lastActivity = Date.now();
        }
        send(target.ws, type, { ...payload, fromId, fromName: fromSession.info.name });
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    const deviceId = wsToDeviceId.get(ws);
    wsToDeviceId.delete(ws);
    if (!deviceId) return;
    const session = deviceSessions.get(deviceId);
    if (!session || session.ws !== ws) return;
    session.ws = null;

    // 60 s grace period before declaring the device gone
    session.disconnectTimer = setTimeout(() => {
      const s = deviceSessions.get(deviceId);
      if (!s || s.ws) return;
      leaveRoom(s);
      deviceSessions.delete(deviceId);
      // D1: departure only notifies the same network group
      broadcastToNetwork(s.info, deviceId, 'device-departed', { deviceId });
    }, 60_000);
  });

  ws.on('error', () => { /* handled via close */ });
});

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

// R4: health endpoint exposes counts only — never room codes
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    devices: deviceSessions.size,
    rooms: rooms.size,
  });
});

app.get('/api/debug-devices', (_req, res) => {
  const devs = Array.from(deviceSessions.values()).map((s) => ({
    id: s.info.id,
    name: s.info.name,
    platform: s.info.platform,
    clientIp: s.info.clientIp,
    networkKey: s.info.networkKey,
    networkHint: s.info.networkHint,
    wsOpen: s.ws?.readyState === WebSocket.OPEN,
  }));
  res.json({ count: devs.length, devices: devs });
});

// R6: LAN info so clients can build QR links that work from phones
app.get('/api/info', (_req, res) => {
  const addresses: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] || []) {
      if (addr.family === 'IPv4' && !addr.internal) addresses.push(addr.address);
    }
  }
  res.json({ lanAddresses: addresses, port: PORT });
});

// Direct project ZIP download
app.get('/api/download-zip', (_req, res) => {
  const zipCandidates = [
    path.resolve(__dirname, '../../client/dist/mog-share-final.zip'),
    path.resolve(__dirname, '../../../mog-share-final.zip'),
    path.resolve('/teamspace/studios/this_studio/mog-share-final.zip'),
  ];
  for (const candidate of zipCandidates) {
    if (fs.existsSync(candidate)) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="mog-share-final.zip"');
      return res.sendFile(candidate);
    }
  }
  return res.status(404).send('Archive not found');
});

// Serve the built client when available (single-origin deployment)
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

export { app, server, wss };

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`[mog-share] Server listening on :${PORT} (ws path /ws)`);
  });
}
