import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import crypto from 'crypto';
import {
  MAX_SIGNALING_MESSAGE_SIZE,
  createEnvelope,
  validateEnvelope,
  type SignalingEnvelope,
} from '@shareapp/shared';
import { extractVerifiedClientIp, deriveNetworkKey } from './clientip/index.js';
import { handleProbeRequest, handleSimpleIpRequest } from './probe/index.js';
import { LocalGroupIndex, type DeviceSession } from './groups/index.js';
import { RoomManager } from './rooms/index.js';
import { handleTurnCredentialsRequest } from './turn/index.js';
import { ServerMetrics, handleHealthz, handleMetrics } from './health/index.js';
import { RelayBandwidthLimiter } from './relay/index.js';
import { Gateway } from './gateway/index.js';

const PORT = parseInt(process.env.PORT || '4000', 10);
const SERVER_SALT = process.env.SERVER_SALT || crypto.randomBytes(32).toString('hex');
const COTURN_SECRET = process.env.COTURN_SECRET || 'shareapp_secret_coturn_auth_key';
const COTURN_REALM = process.env.COTURN_REALM || 'turn.example.com';
const ALLOWED_ORIGIN = process.env.APP_ORIGIN || '*';

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN }));
app.use(express.json({ limit: `${MAX_SIGNALING_MESSAGE_SIZE}b` }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_SIGNALING_MESSAGE_SIZE });

const groupIndex = new LocalGroupIndex();
const roomManager = new RoomManager();
const metrics = new ServerMetrics();
const relayLimiter = new RelayBandwidthLimiter();
const gateway = new Gateway();

// ---------------------------------------------------------------------------
// HTTP Endpoints
// ---------------------------------------------------------------------------
app.get('/healthz', handleHealthz);
app.get('/metrics', (req, res) => handleMetrics(req, res, metrics));

// Probes (Section 3.1 & 3.3)
app.get('/ip', handleSimpleIpRequest);
app.get('/api/probe', (req, res) => handleProbeRequest(req, res, SERVER_SALT));
app.get('/api/probe/v4', handleSimpleIpRequest);
app.get('/api/probe/v6', handleSimpleIpRequest);

// Debug whoami (Section 3.2)
app.get('/debug/whoami', (req, res) => {
  const { clientIp, family, isProxied } = extractVerifiedClientIp(req);
  const groupKey = deriveNetworkKey(clientIp, SERVER_SALT);
  res.json({ clientIp, family, isProxied, groupKey });
});

// Ephemeral TURN credentials (Section 3.7)
app.get('/api/turn-credentials', (req, res) => {
  handleTurnCredentialsRequest(req, res, COTURN_SECRET, COTURN_REALM);
});

// Transport ladder: SSE down (Section 3.5)
app.get('/api/events', (req, res) => {
  const deviceId = req.query.deviceId as string;
  if (!deviceId) {
    res.status(400).json({ error: 'Missing deviceId' });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  gateway.registerConnection({ deviceId, transport: 'sse', sseRes: res });
  req.on('close', () => {
    gateway.removeConnection(deviceId);
  });
});

// Transport ladder: POST up (Section 3.5)
app.post('/api/message', (req, res) => {
  try {
    const envelope = validateEnvelope(req.body);
    handleSignalingMessage(envelope);
    res.status(200).json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Transport ladder: Long-polling (Section 3.5)
app.get('/api/poll', (req, res) => {
  const deviceId = req.query.deviceId as string;
  if (!deviceId) {
    res.status(400).json({ error: 'Missing deviceId' });
    return;
  }
  const since = parseInt((req.query.since as string) || '0', 10);
  const missed = gateway.getMissedMessages(deviceId, since);
  if (missed.length > 0) {
    res.json({ messages: missed });
    return;
  }
  const timer = setTimeout(() => {
    gateway.removeConnection(deviceId);
    res.json({ messages: [] });
  }, 25000);
  gateway.registerConnection({
    deviceId,
    transport: 'poll',
    pollRes: res,
    pollTimer: timer,
  });
});

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

  metrics.totalConnections++;
  metrics.activeSessions++;

  const { clientIp } = extractVerifiedClientIp(req);
  const connNetworkKey = deriveNetworkKey(clientIp, SERVER_SALT);
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
      gateway.registerConnection({ deviceId: fromId, transport: 'ws', ws });
    }

    if (boundDeviceId && !gateway.checkRateLimit(boundDeviceId)) {
      ws.send(JSON.stringify(createEnvelope('error', { message: 'Rate limit exceeded' })));
      return;
    }

    handleIncomingSocketMessage(ws, envelope, connNetworkKey);
  });

  ws.on('close', () => {
    metrics.activeSessions = Math.max(0, metrics.activeSessions - 1);
    if (boundDeviceId) {
      gateway.removeConnection(boundDeviceId);
      groupIndex.scheduleDisconnect(boundDeviceId, () => {
        broadcastGroupPresence(boundDeviceId!);
      });
    }
  });
});

function handleIncomingSocketMessage(
  ws: WebSocket,
  envelope: SignalingEnvelope,
  connNetworkKey: string
) {
  const { type, from, payload } = envelope;

  switch (type) {
    case 'join-local': {
      if (!from) return;
      groupIndex.cancelDisconnect(from);

      const clientKeys = Array.isArray(payload.networkKeys) ? (payload.networkKeys as string[]) : [];
      // Combine client probe keys with connection's observed network key (Section 3.3)
      const combinedKeys = new Set<string>([...clientKeys, connNetworkKey]);

      const resumeToken = (payload.resumeToken as string) || crypto.randomBytes(16).toString('hex');
      const session: DeviceSession = {
        deviceId: from,
        name: (payload.name as string) || 'Anonymous Peer',
        platform: (payload.platform as string) || 'web',
        networkKeys: combinedKeys,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        heartbeatComplete: false, // Must complete ping/pong before becoming visible
        resumeToken,
      };

      const { tooManyDevices } = groupIndex.registerDevice(session);
      ws.send(
        JSON.stringify(
          createEnvelope('joined-local', {
            resumeToken,
            tooManyDevices,
            observedNetworkKey: connNetworkKey,
          })
        )
      );
      break;
    }

    case 'ping': {
      if (from) {
        groupIndex.markHeartbeatComplete(from);
        ws.send(JSON.stringify(createEnvelope('pong', { timestamp: Date.now() }, { to: from })));
        // Presence is broadcast only after heartbeat completes
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
      const room = roomManager.createRoom(from, payload.password as string | undefined);
      metrics.totalRoomsCreated++;
      ws.send(JSON.stringify(createEnvelope('room-created', { roomCode: room.code })));
      break;
    }

    case 'join-room': {
      if (!from) return;
      const code = (payload.roomCode as string) || '';
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

      ws.send(JSON.stringify(createEnvelope('room-joined', { roomCode: code })));
      // Broadcast to room members
      for (const peerId of joinResult.room!.peerIds) {
        if (peerId !== from) {
          gateway.sendToClient(
            peerId,
            createEnvelope('peer-joined-room', { peerId: from, roomCode: code })
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

  // Verify peers share a group or room (Section 3.5)
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
  // Check if peers overlap in local group
  const peersA = groupIndex.getVisiblePeers(peerA);
  if (peersA.some((p) => p.deviceId === peerB)) return true;

  // Check if peers share an active room
  if (roomManager.arePeersInSameRoom(peerA, peerB)) return true;

  return false;
}

function broadcastGroupPresence(deviceId: string) {
  const visible = groupIndex.getVisiblePeers(deviceId);
  // Send snapshot of visible peers to device
  gateway.sendToClient(
    deviceId,
    createEnvelope('group-presence', {
      peers: visible.map((p) => ({
        id: p.deviceId,
        name: p.name,
        platform: p.platform,
      })),
    })
  );

  // Notify visible peers that this device is present
  const self = groupIndex.getSession(deviceId);
  if (self && self.heartbeatComplete) {
    for (const peer of visible) {
      gateway.sendToClient(
        peer.deviceId,
        createEnvelope('peer-discovered', {
          id: self.deviceId,
          name: self.name,
          platform: self.platform,
        })
      );
    }
  }
}

export { server, app, groupIndex, roomManager, metrics, gateway };

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`[ShareApp Signaling] Listening on port ${PORT}`);
  });
}
