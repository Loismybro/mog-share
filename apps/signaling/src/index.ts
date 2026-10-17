import express, { type Express } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import zlib from 'zlib';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import crypto from 'crypto';
import {
  MAX_SIGNALING_MESSAGE_SIZE,
  createEnvelope,
  validateEnvelope,
  type SignalingEnvelope,
} from '@shareapp/shared';
import {
  extractVerifiedClientIp,
  deriveNetworkKey,
  deriveNetworkKeySet,
} from './clientip/index.js';
import { handleProbeRequest, handleSimpleIpRequest } from './probe/index.js';
import { LocalGroupIndex, type DeviceSession } from './groups/index.js';
import { RoomManager } from './rooms/index.js';
import { handleTurnCredentialsRequest } from './turn/index.js';
import { ServerMetrics, handleHealthz, handleMetrics } from './health/index.js';
import { RelayBandwidthLimiter } from './relay/index.js';
import { Gateway } from './gateway/index.js';

const PORT = parseInt(
  process.env.SIGNALING_PORT ||
    (process.env.NODE_ENV === 'production' ? process.env.PORT || '4000' : '4000'),
  10
);
const SERVER_SALT = process.env.SERVER_SALT || crypto.randomBytes(32).toString('hex');
const COTURN_SECRET = process.env.COTURN_SECRET || 'shareapp_secret_coturn_auth_key';
const COTURN_REALM = process.env.COTURN_REALM || '';
const ALLOWED_ORIGIN = process.env.APP_ORIGIN || '*';

const app: Express = express();
app.set('trust proxy', true);
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN }));
app.use(express.json({ limit: `${MAX_SIGNALING_MESSAGE_SIZE}b` }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_SIGNALING_MESSAGE_SIZE });

const groupIndex = new LocalGroupIndex();
const roomManager = new RoomManager();
const metrics = new ServerMetrics();
const relayLimiter = new RelayBandwidthLimiter();
const gateway = new Gateway();

function serializePeer(p: DeviceSession) {
  return {
    id: p.deviceId,
    name: p.name,
    platform: p.platform,
    model: p.model,
    os: p.os,
    browser: p.browser,
    deviceType: p.deviceType,
    batteryLevel: p.batteryLevel,
    isCharging: p.isCharging,
  };
}

function schedulePeerAndRoomDisconnect(departingId: string) {
  groupIndex.scheduleDisconnect(departingId, (peersToNotify) => {
    for (const peer of peersToNotify) {
      gateway.sendToClient(
        peer.deviceId,
        createEnvelope('peer-left', { deviceId: departingId })
      );
    }
    const userRooms = roomManager.getRoomsForDevice(departingId);
    for (const room of userRooms) {
      roomManager.leaveRoom(room.code, departingId);
      for (const peerId of room.peerIds) {
        if (peerId !== departingId) {
          gateway.sendToClient(
            peerId,
            createEnvelope('peer-left-room', { peerId: departingId, roomCode: room.code })
          );
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Pure Node ZIP Builder for Project Export (/api/project-zip)
// ---------------------------------------------------------------------------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function collectProjectFiles(rootDir: string): Array<{ relPath: string; data: Buffer }> {
  const results: Array<{ relPath: string; data: Buffer }> = [];
  const skipDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    '.aistudio',
    '.next',
    '.turbo',
    'coverage',
  ]);
  const skipFiles = new Set(['.DS_Store', 'bun.lock']);

  function walk(currentDir: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(path.join(currentDir, entry.name));
      } else if (entry.isFile()) {
        if (skipFiles.has(entry.name) || entry.name.endsWith('.zip')) continue;
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(rootDir, fullPath).split(path.sep).join('/');
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 5 * 1024 * 1024) continue;
          results.push({ relPath, data: fs.readFileSync(fullPath) });
        } catch {
          /* ignore unreadable */
        }
      }
    }
  }

  walk(rootDir);
  return results;
}

function buildZipArchive(files: Array<{ relPath: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.relPath, 'utf8');
    const crc = crc32(file.data);
    const compressed = zlib.deflateRawSync(file.data);
    const useDeflate = compressed.length < file.data.length;
    const payload = useDeflate ? compressed : file.data;
    const method = useDeflate ? 8 : 0;

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5421, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, payload);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + payload.length;
  }

  const centralSize = centralParts.reduce((acc, b) => acc + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

// ---------------------------------------------------------------------------
// HTTP Endpoints
// ---------------------------------------------------------------------------
app.get('/healthz', handleHealthz);
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    devices: groupIndex.getDeviceCount(),
    rooms: roomManager.getActiveRoomCount(),
  });
});
app.get('/metrics', (req, res) => handleMetrics(req, res, metrics));

app.get('/api/project-zip', (_req, res) => {
  try {
    const candidates = [
      process.cwd(),
      path.resolve(process.cwd(), '../..'),
    ];
    const rootDir =
      candidates.find((c) => fs.existsSync(path.join(c, 'apps')) && fs.existsSync(path.join(c, 'packages'))) ||
      process.cwd();
    const files = collectProjectFiles(rootDir);
    const zipBuffer = buildZipArchive(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="mogshare-github-ready.zip"');
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.send(zipBuffer);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/info', (req, res) => {
  const addresses: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] || []) {
      if (addr.family === 'IPv4' && !addr.internal) addresses.push(addr.address);
    }
  }
  const { clientIp, family } = extractVerifiedClientIp(req);
  res.json({ lanAddresses: addresses, port: PORT, clientIp, family });
});

app.get('/ip', handleSimpleIpRequest);
app.get('/api/probe', (req, res) => handleProbeRequest(req, res, SERVER_SALT));
app.get('/api/probe/v4', handleSimpleIpRequest);
app.get('/api/probe/v6', handleSimpleIpRequest);

app.get('/debug/whoami', (req, res) => {
  const { clientIp, family, isProxied } = extractVerifiedClientIp(req);
  const groupKey = deriveNetworkKey(clientIp, SERVER_SALT);
  res.json({ clientIp, family, isProxied, groupKey });
});

app.get('/api/turn-credentials', (req, res) => {
  handleTurnCredentialsRequest(req, res, COTURN_SECRET, COTURN_REALM);
});

// Transport ladder: SSE down
app.get('/api/events', (req, res) => {
  const deviceId = req.query.deviceId as string;
  if (!deviceId) {
    res.status(400).json({ error: 'Missing deviceId' });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': connected\n\n');

  groupIndex.cancelDisconnect(deviceId);
  gateway.registerConnection({ deviceId, transport: 'sse', sseRes: res });
  const keepAlive = setInterval(() => {
    try {
      res.write(': hb\n\n');
    } catch {
      /* closed */
    }
  }, 20_000);
  req.on('close', () => {
    clearInterval(keepAlive);
    if (gateway.getConnection(deviceId)?.sseRes !== res) return;
    gateway.removeConnection(deviceId);
    schedulePeerAndRoomDisconnect(deviceId);
  });
});

// Transport ladder: POST up
app.post('/api/message', (req, res) => {
  try {
    const envelope = validateEnvelope(req.body);
    const fromId = envelope.from;
    if (!fromId) throw new Error('Missing sender id');
    if (envelope.type !== 'relay-frame' && !gateway.checkRateLimit(fromId)) {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }
    groupIndex.cancelDisconnect(fromId);
    if (!gateway.getConnection(fromId)) {
      gateway.registerConnection({ deviceId: fromId, transport: 'poll', pollQueue: [] });
    }
    const { clientIp } = extractVerifiedClientIp(req);
    const shim = {
      send: (raw: string) => {
        try {
          gateway.sendToClient(fromId, JSON.parse(raw));
        } catch {
          /* ignore */
        }
      },
    } as unknown as WebSocket;
    handleIncomingSocketMessage(shim, envelope, clientIp);
    res.status(200).json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Transport ladder: Long-polling
app.get('/api/poll', (req, res) => {
  const deviceId = req.query.deviceId as string;
  if (!deviceId) {
    res.status(400).json({ error: 'Missing deviceId' });
    return;
  }
  groupIndex.cancelDisconnect(deviceId);
  const existing = gateway.getConnection(deviceId);
  if (existing?.transport === 'poll') {
    if (existing.pollTimer) clearTimeout(existing.pollTimer);
    if (existing.pollRes && existing.pollRes !== res && !existing.pollRes.headersSent) {
      existing.pollRes.json({ messages: [] });
    }
    const queued = existing.pollQueue || [];
    if (queued.length > 0) {
      existing.pollQueue = [];
      existing.pollRes = undefined;
      res.json({ messages: queued });
      return;
    }
  }
  const timer = setTimeout(() => {
    const c = gateway.getConnection(deviceId);
    if (c && c.pollRes === res) c.pollRes = undefined;
    if (!res.headersSent) res.json({ messages: [] });
  }, 20000);
  gateway.registerConnection({
    deviceId,
    transport: 'poll',
    pollRes: res,
    pollTimer: timer,
    pollQueue: existing?.pollQueue || [],
  });
  req.on('close', () => {
    clearTimeout(timer);
    const c = gateway.getConnection(deviceId);
    if (c && c.pollRes === res) c.pollRes = undefined;
  });
});

// WebSocket keep-alive
const aliveSockets = new WeakMap<WebSocket, boolean>();
const pingInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (aliveSockets.get(ws) === false) {
      ws.terminate();
      continue;
    }
    aliveSockets.set(ws, false);
    try {
      ws.ping();
    } catch {
      /* socket dead */
    }
  }
}, 25_000);
pingInterval.unref?.();

const roomPruneInterval = setInterval(() => {
  roomManager.pruneExpiredRooms();
}, 60_000);
roomPruneInterval.unref?.();

// ---------------------------------------------------------------------------
// WebSocket Gateway Handling
// ---------------------------------------------------------------------------
wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  if (ALLOWED_ORIGIN !== '*') {
    const origin = req.headers.origin;
    if (origin && origin !== ALLOWED_ORIGIN) {
      ws.close(1008, 'Origin not allowed');
      return;
    }
  }

  aliveSockets.set(ws, true);
  ws.on('pong', () => aliveSockets.set(ws, true));

  metrics.totalConnections++;
  metrics.activeSessions++;

  const { clientIp } = extractVerifiedClientIp(req);
  let boundDeviceId: string | null = null;

  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    let rawStr = '';
    if (Buffer.isBuffer(data)) rawStr = data.toString('utf8');
    else if (data instanceof ArrayBuffer) rawStr = new TextDecoder().decode(data);
    else rawStr = data.toString();

    let envelope: SignalingEnvelope;
    try {
      envelope = validateEnvelope(JSON.parse(rawStr));
    } catch (err: unknown) {
      ws.send(JSON.stringify(createEnvelope('error', { message: (err as Error).message })));
      return;
    }

    if (envelope.from) {
      const fromId = envelope.from;
      boundDeviceId = fromId;
      groupIndex.cancelDisconnect(fromId);
      gateway.registerConnection({ deviceId: fromId, transport: 'ws', ws });
    }

    if (envelope.type !== 'relay-frame' && boundDeviceId && !gateway.checkRateLimit(boundDeviceId)) {
      ws.send(JSON.stringify(createEnvelope('error', { message: 'Rate limit exceeded' })));
      return;
    }

    handleIncomingSocketMessage(ws, envelope, clientIp);
  });

  ws.on('close', () => {
    metrics.activeSessions = Math.max(0, metrics.activeSessions - 1);
    if (boundDeviceId) {
      const cur = gateway.getConnection(boundDeviceId);
      if (cur && cur.ws !== ws) return;
      const departingId = boundDeviceId;
      gateway.removeConnection(departingId);
      schedulePeerAndRoomDisconnect(departingId);
    }
  });
});

function ensureDeviceSession(
  from: string,
  clientIp: string,
  payload?: Record<string, unknown>
): DeviceSession {
  let sess = groupIndex.getSession(from);
  if (sess) {
    groupIndex.cancelDisconnect(from);
    sess.lastSeen = Date.now();
    sess.heartbeatComplete = true;
    sess.clientIp = clientIp;
    return sess;
  }
  const connNetworkKey = deriveNetworkKey(clientIp, SERVER_SALT);
  const combinedKeys = deriveNetworkKeySet(clientIp, SERVER_SALT, [connNetworkKey]);
  sess = {
    deviceId: from,
    name: String(payload?.name || `Device (${from.slice(0, 4)})`).slice(0, 48),
    platform: (payload?.platform as string) || 'web',
    clientIp,
    networkKeys: combinedKeys,
    connectedAt: Date.now(),
    lastSeen: Date.now(),
    heartbeatComplete: true,
    resumeToken: crypto.randomBytes(16).toString('hex'),
  };
  groupIndex.registerDevice(sess);
  return sess;
}

function handleIncomingSocketMessage(
  ws: WebSocket,
  envelope: SignalingEnvelope,
  clientIp: string
) {
  const { type, from, payload } = envelope;
  const connNetworkKey = deriveNetworkKey(clientIp, SERVER_SALT);

  switch (type) {
    case 'join':
    case 'join-local': {
      if (!from) return;
      groupIndex.cancelDisconnect(from);

      const clientKeys = Array.isArray(payload.networkKeys) ? (payload.networkKeys as string[]) : [];
      const combinedKeys = deriveNetworkKeySet(clientIp, SERVER_SALT, [
        ...clientKeys,
        connNetworkKey,
      ]);

      const resumeToken = (payload.resumeToken as string) || crypto.randomBytes(16).toString('hex');
      const session: DeviceSession = {
        deviceId: from,
        name: String(payload.name || 'Device').slice(0, 48),
        platform: (payload.platform as string) || 'web',
        model: payload.model ? String(payload.model).slice(0, 48) : undefined,
        os: payload.os ? String(payload.os).slice(0, 32) : undefined,
        browser: payload.browser ? String(payload.browser).slice(0, 32) : undefined,
        deviceType: payload.deviceType ? String(payload.deviceType).slice(0, 24) : undefined,
        batteryLevel: typeof payload.batteryLevel === 'number' ? payload.batteryLevel : undefined,
        isCharging: typeof payload.isCharging === 'boolean' ? payload.isCharging : undefined,
        clientIp,
        networkKeys: combinedKeys,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        heartbeatComplete: true,
        resumeToken,
      };

      const { tooManyDevices, evictedDeviceIds } = groupIndex.registerDevice(session);
      for (const evictedId of evictedDeviceIds) {
        const visible = groupIndex.getVisiblePeers(from);
        for (const peer of visible) {
          gateway.sendToClient(
            peer.deviceId,
            createEnvelope('peer-left', { deviceId: evictedId })
          );
        }
      }

      ws.send(
        JSON.stringify(
          createEnvelope('joined-local', {
            resumeToken,
            tooManyDevices,
            observedNetworkKey: connNetworkKey,
            clientIp,
          })
        )
      );

      broadcastGroupPresence(from);
      broadcastRoomPresenceUpdate(from);
      break;
    }

    case 'rescan': {
      if (!from) return;
      ensureDeviceSession(from, clientIp, payload);
      broadcastGroupPresence(from);
      broadcastRoomPresenceUpdate(from);
      break;
    }

    case 'update-profile': {
      if (!from) return;
      const sess = ensureDeviceSession(from, clientIp, payload);
      if (payload.name) sess.name = String(payload.name).slice(0, 48);
      if (payload.platform) sess.platform = payload.platform as string;
      if (payload.model !== undefined) sess.model = String(payload.model).slice(0, 48);
      if (payload.os !== undefined) sess.os = String(payload.os).slice(0, 32);
      if (payload.browser !== undefined) sess.browser = String(payload.browser).slice(0, 32);
      if (typeof payload.batteryLevel === 'number') sess.batteryLevel = payload.batteryLevel;
      if (typeof payload.isCharging === 'boolean') sess.isCharging = payload.isCharging;
      broadcastGroupPresence(from);
      broadcastRoomPresenceUpdate(from);
      break;
    }

    case 'broadcast-clipboard': {
      if (!from) return;
      const content = typeof payload.content === 'string' ? payload.content.slice(0, 100_000) : '';
      if (!content) return;
      const senderSession = ensureDeviceSession(from, clientIp, payload);
      const targetPeerId = typeof payload.targetPeerId === 'string' ? payload.targetPeerId : undefined;
      const out = {
        fromId: from,
        fromDevice: senderSession?.name || from,
        content,
        timestamp: (payload.timestamp as number) || Date.now(),
        isDirect: Boolean(targetPeerId),
      };

      if (targetPeerId) {
        if (verifyPeerSharing(from, targetPeerId)) {
          gateway.sendToClient(targetPeerId, createEnvelope('clipboard-received', out));
        }
        break;
      }

      const delivered = new Set<string>();
      const peers = groupIndex.getVisiblePeers(from);
      for (const peer of peers) {
        delivered.add(peer.deviceId);
        gateway.sendToClient(peer.deviceId, createEnvelope('clipboard-received', out));
      }
      const userRooms = roomManager.getRoomsForDevice(from);
      for (const room of userRooms) {
        for (const peerId of room.peerIds) {
          if (peerId !== from && !delivered.has(peerId)) {
            delivered.add(peerId);
            gateway.sendToClient(peerId, createEnvelope('clipboard-received', out));
          }
        }
      }
      break;
    }

    case 'leave-room': {
      if (!from) return;
      const code = ((payload.roomCode as string) || '').toUpperCase();
      const targetRooms = code
        ? [roomManager.getRoom(code)].filter(Boolean)
        : roomManager.getRoomsForDevice(from);
      for (const room of targetRooms) {
        if (!room) continue;
        roomManager.leaveRoom(room.code, from);
        for (const peerId of room.peerIds) {
          if (peerId !== from) {
            gateway.sendToClient(
              peerId,
              createEnvelope('peer-left-room', { peerId: from, roomCode: room.code })
            );
          }
        }
      }
      ws.send(JSON.stringify(createEnvelope('room-left', { roomCode: code })));
      break;
    }

    case 'ping': {
      if (from) {
        ensureDeviceSession(from, clientIp, payload);
        ws.send(
          JSON.stringify(
            createEnvelope(
              'pong',
              { timestamp: Date.now(), clientTime: payload?.clientTime },
              { to: from }
            )
          )
        );
        broadcastGroupPresence(from);
      }
      break;
    }

    case 'reconnect': {
      const token = payload.resumeToken as string;
      const existing = groupIndex.getSessionByToken(token);
      if (existing) {
        groupIndex.cancelDisconnect(existing.deviceId);
        metrics.totalResumes++;
        ws.send(
          JSON.stringify(
            createEnvelope('resumed', {
              deviceId: existing.deviceId,
              name: existing.name,
            })
          )
        );
        gateway.replayMissed(existing.deviceId, (payload.lastAckTime as number) || 0);
      } else {
        ws.send(JSON.stringify(createEnvelope('resume-failed', { reason: 'Session expired' })));
      }
      break;
    }

    case 'create-room': {
      if (!from) return;
      ensureDeviceSession(from, clientIp, payload);
      const room = roomManager.createRoom(from, payload.password as string | undefined);
      metrics.totalRoomsCreated++;
      ws.send(JSON.stringify(createEnvelope('room-created', { roomCode: room.code })));
      break;
    }

    case 'join-room': {
      if (!from) return;
      const joinerSession = ensureDeviceSession(from, clientIp, payload);
      if (payload.name) joinerSession.name = String(payload.name).slice(0, 48);
      if (payload.platform) joinerSession.platform = payload.platform as string;
      if (payload.model) joinerSession.model = String(payload.model).slice(0, 48);

      const code = ((payload.roomCode as string) || '').toUpperCase();
      const password = payload.password as string | undefined;
      const ipHash = crypto.createHash('sha256').update(connNetworkKey).digest('hex').slice(0, 12);

      const rateCheck = roomManager.checkRateLimit(ipHash, code);
      if (!rateCheck.allowed) {
        ws.send(
          JSON.stringify(
            createEnvelope('room-join-failed', {
              error: `Too many attempts. Locked out for ${Math.ceil((rateCheck.remainingLockoutMs || 0) / 1000)}s`,
            })
          )
        );
        return;
      }

      const joinResult = roomManager.joinRoom(code, from, password);
      if (!joinResult.success) {
        roomManager.recordJoinFailure(ipHash, code);
        ws.send(JSON.stringify(createEnvelope('room-join-failed', { error: joinResult.error })));
        return;
      }

      // Evict any ghost peerId in the room that belongs to the exact same physical device
      for (const peerId of Array.from(joinResult.room!.peerIds)) {
        if (peerId === from) continue;
        const s = groupIndex.getSession(peerId);
        if (
          s &&
          s.name === joinerSession.name &&
          s.platform === joinerSession.platform &&
          (s.model || '') === (joinerSession.model || '') &&
          s.clientIp === joinerSession.clientIp
        ) {
          roomManager.leaveRoom(code, peerId);
          for (const notifyId of joinResult.room!.peerIds) {
            if (notifyId !== peerId) {
              gateway.sendToClient(
                notifyId,
                createEnvelope('peer-left-room', { peerId, roomCode: code })
              );
            }
          }
        }
      }

      const existingPeers = Array.from(joinResult.room!.peerIds)
        .filter((peerId) => peerId !== from)
        .map((peerId) => {
          const sess = groupIndex.getSession(peerId);
          return sess
            ? serializePeer(sess)
            : {
                id: peerId,
                name: `Device (${peerId.slice(0, 4)})`,
                platform: 'web',
              };
        });

      ws.send(
        JSON.stringify(createEnvelope('room-joined', { roomCode: code, peers: existingPeers }))
      );

      for (const peerId of joinResult.room!.peerIds) {
        if (peerId !== from) {
          gateway.sendToClient(
            peerId,
            createEnvelope('peer-joined-room', {
              peerId: from,
              roomCode: code,
              ...serializePeer(joinerSession),
            })
          );
        }
      }
      break;
    }

    case 'signal':
    case 'relay-frame': {
      handleSignalingMessage(envelope);
      break;
    }

    default:
      break;
  }
}

function handleSignalingMessage(envelope: SignalingEnvelope) {
  const { from, to, type } = envelope;
  if (!from || !to) return;

  const isAuthorized = verifyPeerSharing(from, to);
  if (!isAuthorized) {
    return;
  }

  if (type === 'relay-frame') {
    const rawLen = JSON.stringify(envelope.payload).length;
    if (!relayLimiter.canRelay(from, rawLen)) {
      gateway.sendToClient(from, createEnvelope('relay-limit-exceeded', {}));
      return;
    }
    metrics.totalRelayBytes += rawLen;
  }

  metrics.totalMessagesRelayed++;
  gateway.sendToClient(to, envelope);
}

function verifyPeerSharing(peerA: string, peerB: string): boolean {
  if (roomManager.arePeersInSameRoom(peerA, peerB)) return true;
  const peersA = groupIndex.getVisiblePeers(peerA);
  if (peersA.some((p) => p.deviceId === peerB)) return true;
  if (groupIndex.getSession(peerA) && groupIndex.getSession(peerB)) return true;
  return false;
}

function broadcastGroupPresence(deviceId: string) {
  const visible = groupIndex.getVisiblePeers(deviceId);
  gateway.sendToClient(
    deviceId,
    createEnvelope('group-presence', {
      peers: visible.map(serializePeer),
    })
  );

  const self = groupIndex.getSession(deviceId);
  if (self && self.heartbeatComplete) {
    for (const peer of visible) {
      gateway.sendToClient(
        peer.deviceId,
        createEnvelope('peer-discovered', serializePeer(self))
      );
    }
  }
}

function broadcastRoomPresenceUpdate(deviceId: string) {
  const self = groupIndex.getSession(deviceId);
  if (!self) return;
  const rooms = roomManager.getRoomsForDevice(deviceId);
  for (const room of rooms) {
    const existingPeers = Array.from(room.peerIds)
      .filter((id) => id !== deviceId)
      .map((id) => {
        const s = groupIndex.getSession(id);
        return s ? serializePeer(s) : { id, name: `Device (${id.slice(0, 4)})`, platform: 'web' };
      });
    gateway.sendToClient(
      deviceId,
      createEnvelope('room-joined', { roomCode: room.code, peers: existingPeers })
    );
    for (const peerId of room.peerIds) {
      if (peerId !== deviceId) {
        gateway.sendToClient(
          peerId,
          createEnvelope('peer-joined-room', {
            peerId: self.deviceId,
            roomCode: room.code,
            ...serializePeer(self),
          })
        );
      }
    }
  }
}

const distCandidates = [
  path.resolve(process.cwd(), 'apps/web/dist'),
  path.resolve(process.cwd(), 'dist'),
  path.resolve(process.cwd(), '../web/dist'),
];
const distPath = distCandidates.find((p) => fs.existsSync(p));
if (distPath) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (
      req.method !== 'GET' ||
      req.path.startsWith('/api') ||
      req.path.startsWith('/ws') ||
      req.path.startsWith('/ip') ||
      req.path.startsWith('/debug') ||
      req.path.startsWith('/healthz') ||
      req.path.startsWith('/metrics')
    ) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

export { server, app, groupIndex, roomManager, metrics, gateway };

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    const addresses: string[] = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const addr of ifaces[name] || []) {
        if (addr.family === 'IPv4' && !addr.internal) addresses.push(addr.address);
      }
    }
    console.log(`[MogShare] Listening on http://0.0.0.0:${PORT}`);
    if (addresses.length > 0) {
      console.log(`[MogShare LAN] ${addresses.map((ip) => `http://${ip}:${PORT}`).join(' | ')}`);
    }
  });
}
