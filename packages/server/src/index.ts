import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

interface DeviceInfo {
  id: string;
  name: string;
  platform: 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'web';
  clientIp: string;
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
}

// Global Registries
const deviceSessions = new Map<string, DeviceSession>();
const wsToDeviceId = new Map<WebSocket, string>();
const rooms = new Map<string, RoomRecord>();

// Clean up stale empty rooms periodically (empty for > 5 mins)
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (room.peerIds.size === 0 && now - room.createdAt > 5 * 60 * 1000) {
      rooms.delete(code);
      console.log(`[MOG-SHARE Server] Pruned stale room: ${code}`);
    }
  }
}, 60 * 1000);

export function normalizeRoomCode(raw: string): string {
  if (!raw) return '';
  const digitsOnly = raw.replace(/[^\w]/g, '').toUpperCase();
  if (digitsOnly.length === 6) {
    return `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3, 6)}`;
  }
  return raw.trim().toUpperCase();
}

function generateMogCode(): string {
  const part1 = Math.floor(100 + Math.random() * 900);
  const part2 = Math.floor(100 + Math.random() * 900);
  return `${part1}-${part2}`;
}

wss.on('connection', (ws: WebSocket, req) => {
  const forwarded = req.headers['x-forwarded-for'];
  const clientIp = typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : req.socket.remoteAddress || '127.0.0.1';

  ws.on('message', (rawData) => {
    try {
      const message = JSON.parse(rawData.toString());
      const { type, payload } = message;

      switch (type) {
        case 'ping': {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong', payload: { timestamp: Date.now() } }));
          }
          break;
        }

        case 'register': {
          const deviceId = payload.id;
          if (!deviceId) return;

          wsToDeviceId.set(ws, deviceId);

          let session = deviceSessions.get(deviceId);
          if (session) {
            // Reconnecting device within grace period
            if (session.disconnectTimer) {
              clearTimeout(session.disconnectTimer);
              session.disconnectTimer = undefined;
              console.log(`[MOG-SHARE Server] Device ${session.info.name} (${deviceId}) reconnected successfully`);
            }
            session.ws = ws;
            session.info.name = payload.name || session.info.name;
            session.info.platform = payload.platform || session.info.platform;
            session.info.clientIp = clientIp;

            // If device was in a room and room still exists, restore session immediately
            if (session.info.roomCode) {
              const activeRoom = rooms.get(session.info.roomCode);
              if (activeRoom && activeRoom.peerIds.has(deviceId)) {
                ws.send(JSON.stringify({
                  type: 'room-joined',
                  payload: { roomCode: session.info.roomCode }
                }));

                const peers = Array.from(activeRoom.peerIds)
                  .filter((pid) => pid !== deviceId)
                  .map((pid) => {
                    const peerSess = deviceSessions.get(pid);
                    if (!peerSess) return null;
                    return {
                      id: peerSess.info.id,
                      name: peerSess.info.name,
                      platform: peerSess.info.platform,
                      isLocal: false,
                      status: peerSess.ws && peerSess.ws.readyState === WebSocket.OPEN ? 'online' : 'busy',
                    };
                  })
                  .filter(Boolean);

                ws.send(JSON.stringify({
                  type: 'room-peers',
                  payload: { roomCode: session.info.roomCode, peers }
                }));

                // Notify other room members about reconnection
                for (const pid of activeRoom.peerIds) {
                  if (pid !== deviceId) {
                    const peerSess = deviceSessions.get(pid);
                    if (peerSess?.ws && peerSess.ws.readyState === WebSocket.OPEN) {
                      peerSess.ws.send(JSON.stringify({
                        type: 'peer-joined-room',
                        payload: {
                          peer: {
                            id: session.info.id,
                            name: session.info.name,
                            platform: session.info.platform,
                            isLocal: false,
                            status: 'online',
                          }
                        }
                      }));
                    }
                  }
                }
              }
            }
          } else {
            // Brand new device
            const info: DeviceInfo = {
              id: deviceId,
              name: payload.name,
              platform: payload.platform || 'web',
              clientIp,
              joinedAt: Date.now(),
            };
            session = { ws, info };
            deviceSessions.set(deviceId, session);
          }

          broadcastLocalPeers(deviceId, session.info);
          break;
        }

        case 'create-room': {
          const deviceId = wsToDeviceId.get(ws);
          const session = deviceId ? deviceSessions.get(deviceId) : null;
          if (!session) return;

          // Clean up prior room membership if device was in an old room
          if (session.info.roomCode) {
            const oldRoom = rooms.get(session.info.roomCode);
            if (oldRoom) {
              oldRoom.peerIds.delete(session.info.id);
              if (oldRoom.peerIds.size === 0) {
                rooms.delete(session.info.roomCode);
              } else {
                for (const pid of oldRoom.peerIds) {
                  const peerSess = deviceSessions.get(pid);
                  if (peerSess?.ws && peerSess.ws.readyState === WebSocket.OPEN) {
                    peerSess.ws.send(JSON.stringify({
                      type: 'peer-left-room',
                      payload: { peerId: session.info.id }
                    }));
                  }
                }
              }
            }
          }

          let code = generateMogCode();
          while (rooms.has(code)) {
            code = generateMogCode();
          }

          const roomRecord: RoomRecord = {
            code,
            hostDeviceId: session.info.id,
            peerIds: new Set([session.info.id]),
            createdAt: Date.now(),
          };
          rooms.set(code, roomRecord);
          session.info.roomCode = code;

          ws.send(JSON.stringify({
            type: 'room-created',
            payload: { roomCode: code }
          }));
          console.log(`[MOG-SHARE Server] Room ${code} created by ${session.info.name}`);
          break;
        }

        case 'join-room': {
          const deviceId = wsToDeviceId.get(ws);
          const session = deviceId ? deviceSessions.get(deviceId) : null;
          if (!session) return;

          const targetCode = normalizeRoomCode(payload.roomCode);
          const room = rooms.get(targetCode);

          if (!room) {
            ws.send(JSON.stringify({
              type: 'error',
              payload: { message: `Room "${targetCode}" not found or expired.` }
            }));
            return;
          }

          // If session was in a different room, leave that room first
          if (session.info.roomCode && session.info.roomCode !== targetCode) {
            const oldRoom = rooms.get(session.info.roomCode);
            if (oldRoom) {
              oldRoom.peerIds.delete(session.info.id);
              if (oldRoom.peerIds.size === 0) {
                rooms.delete(session.info.roomCode);
              } else {
                for (const pid of oldRoom.peerIds) {
                  const peerSess = deviceSessions.get(pid);
                  if (peerSess?.ws && peerSess.ws.readyState === WebSocket.OPEN) {
                    peerSess.ws.send(JSON.stringify({
                      type: 'peer-left-room',
                      payload: { peerId: session.info.id }
                    }));
                  }
                }
              }
            }
          }

          room.peerIds.add(session.info.id);
          session.info.roomCode = targetCode;

          // 1. Confirm room join to joiner
          ws.send(JSON.stringify({
            type: 'room-joined',
            payload: { roomCode: targetCode }
          }));

          // 2. Send snapshot of ALL other peers in this room to joiner
          const existingPeers = Array.from(room.peerIds)
            .filter((pid) => pid !== session.info.id)
            .map((pid) => {
              const peerSess = deviceSessions.get(pid);
              if (!peerSess) return null;
              return {
                id: peerSess.info.id,
                name: peerSess.info.name,
                platform: peerSess.info.platform,
                isLocal: false,
                status: peerSess.ws && peerSess.ws.readyState === WebSocket.OPEN ? 'online' : 'busy',
              };
            })
            .filter(Boolean);

          ws.send(JSON.stringify({
            type: 'room-peers',
            payload: { roomCode: targetCode, peers: existingPeers }
          }));

          // 3. Notify all existing peers in the room about the newcomer
          for (const pid of room.peerIds) {
            if (pid !== session.info.id) {
              const peerSess = deviceSessions.get(pid);
              if (peerSess?.ws && peerSess.ws.readyState === WebSocket.OPEN) {
                peerSess.ws.send(JSON.stringify({
                  type: 'peer-joined-room',
                  payload: {
                    peer: {
                      id: session.info.id,
                      name: session.info.name,
                      platform: session.info.platform,
                      isLocal: false,
                      status: 'online',
                    }
                  }
                }));
              }
            }
          }
          console.log(`[MOG-SHARE Server] Device ${session.info.name} joined room ${targetCode} (${room.peerIds.size} total peers)`);
          break;
        }

        case 'leave-room': {
          const deviceId = wsToDeviceId.get(ws);
          const session = deviceId ? deviceSessions.get(deviceId) : null;
          if (session && session.info.roomCode) {
            const room = rooms.get(session.info.roomCode);
            if (room) {
              room.peerIds.delete(session.info.id);
              if (room.peerIds.size === 0) {
                rooms.delete(session.info.roomCode);
              } else {
                for (const pid of room.peerIds) {
                  const peerSess = deviceSessions.get(pid);
                  if (peerSess?.ws && peerSess.ws.readyState === WebSocket.OPEN) {
                    peerSess.ws.send(JSON.stringify({
                      type: 'peer-left-room',
                      payload: { peerId: session.info.id }
                    }));
                  }
                }
              }
            }
            delete session.info.roomCode;
          }
          break;
        }

        case 'signal': {
          const { targetPeerId, signalData } = payload;
          const senderId = wsToDeviceId.get(ws);
          const targetSession = deviceSessions.get(targetPeerId);
          if (targetSession?.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(JSON.stringify({
              type: 'signal',
              payload: {
                fromPeerId: senderId,
                signalData,
              }
            }));
          }
          break;
        }

        case 'clipboard-broadcast': {
          const senderId = wsToDeviceId.get(ws);
          const senderSession = senderId ? deviceSessions.get(senderId) : null;
          if (!senderSession) return;

          if (senderSession.info.roomCode) {
            const room = rooms.get(senderSession.info.roomCode);
            if (room) {
              for (const pid of room.peerIds) {
                if (pid !== senderId) {
                  const targetSess = deviceSessions.get(pid);
                  if (targetSess?.ws && targetSess.ws.readyState === WebSocket.OPEN) {
                    targetSess.ws.send(JSON.stringify({
                      type: 'clipboard-received',
                      payload: {
                        fromDevice: senderSession.info.name,
                        content: payload.content,
                        timestamp: Date.now(),
                      }
                    }));
                  }
                }
              }
            }
          } else {
            // Local broadcast
            for (const [otherId, targetSess] of deviceSessions.entries()) {
              if (otherId !== senderId && targetSess.ws && targetSess.ws.readyState === WebSocket.OPEN) {
                targetSess.ws.send(JSON.stringify({
                  type: 'clipboard-received',
                  payload: {
                    fromDevice: senderSession.info.name,
                    content: payload.content,
                    timestamp: Date.now(),
                  }
                }));
              }
            }
          }
          break;
        }

        case 'transfer-request': {
          const { targetPeerId, transferId, fileMeta } = payload;
          const senderId = wsToDeviceId.get(ws);
          const senderSession = senderId ? deviceSessions.get(senderId) : null;
          const targetSession = deviceSessions.get(targetPeerId);

          if (targetSession?.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(JSON.stringify({
              type: 'transfer-request',
              payload: {
                fromPeer: {
                  id: senderSession?.info.id,
                  name: senderSession?.info.name,
                  platform: senderSession?.info.platform,
                },
                transferId,
                fileMeta,
              }
            }));
          }
          break;
        }

        case 'transfer-response': {
          const { targetPeerId, transferId, accepted } = payload;
          const targetSession = deviceSessions.get(targetPeerId);
          if (targetSession?.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(JSON.stringify({
              type: 'transfer-response',
              payload: { transferId, accepted }
            }));
          }
          break;
        }

        case 'file-chunk': {
          const { targetPeerId, transferId, chunkIndex, totalChunks, data } = payload;
          const targetSession = deviceSessions.get(targetPeerId);
          if (targetSession?.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(JSON.stringify({
              type: 'file-chunk',
              payload: { transferId, chunkIndex, totalChunks, data }
            }));
          }
          break;
        }

        case 'transfer-complete': {
          const { targetPeerId, transferId } = payload;
          const targetSession = deviceSessions.get(targetPeerId);
          if (targetSession?.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(JSON.stringify({
              type: 'transfer-complete',
              payload: { transferId }
            }));
          }
          break;
        }

        case 'transfer-cancel': {
          const { targetPeerId, transferId } = payload;
          const targetSession = deviceSessions.get(targetPeerId);
          if (targetSession?.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(JSON.stringify({
              type: 'transfer-cancel',
              payload: { transferId }
            }));
          }
          break;
        }
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  ws.on('close', () => {
    const deviceId = wsToDeviceId.get(ws);
    wsToDeviceId.delete(ws);

    if (deviceId) {
      const session = deviceSessions.get(deviceId);
      if (session) {
        session.ws = null;
        console.log(`[MOG-SHARE Server] Device ${session.info.name} (${deviceId}) disconnected. Starting 60s grace period.`);

        // 60-Second Grace Period to prevent mobile Android/iOS tab sleep/file picker from destroying room session
        if (session.disconnectTimer) clearTimeout(session.disconnectTimer);

        session.disconnectTimer = setTimeout(() => {
          console.log(`[MOG-SHARE Server] Grace period expired for device ${session.info.name} (${deviceId})`);
          if (session.info.roomCode) {
            const room = rooms.get(session.info.roomCode);
            if (room) {
              room.peerIds.delete(deviceId);
              if (room.peerIds.size === 0) {
                rooms.delete(session.info.roomCode);
                console.log(`[MOG-SHARE Server] Room ${session.info.roomCode} closed (all peers left).`);
              } else {
                for (const pid of room.peerIds) {
                  const peerSess = deviceSessions.get(pid);
                  if (peerSess?.ws && peerSess.ws.readyState === WebSocket.OPEN) {
                    peerSess.ws.send(JSON.stringify({
                      type: 'peer-left-room',
                      payload: { peerId: deviceId }
                    }));
                  }
                }
              }
            }
          }

          // Broadcast departure for local peers
          for (const [otherId, targetSess] of deviceSessions.entries()) {
            if (otherId !== deviceId && targetSess.ws && targetSess.ws.readyState === WebSocket.OPEN) {
              targetSess.ws.send(JSON.stringify({
                type: 'device-departed',
                payload: { deviceId }
              }));
            }
          }

          deviceSessions.delete(deviceId);
        }, 60000);
      }
    }
  });
});

function broadcastLocalPeers(senderId: string, senderInfo: DeviceInfo) {
  const senderSession = deviceSessions.get(senderId);
  const senderWs = senderSession?.ws;

  for (const [otherId, otherSession] of deviceSessions.entries()) {
    if (otherId !== senderId && otherSession.ws && otherSession.ws.readyState === WebSocket.OPEN) {
      // Notify other device about sender
      otherSession.ws.send(JSON.stringify({
        type: 'device-discovered',
        payload: {
          device: {
            id: senderInfo.id,
            name: senderInfo.name,
            platform: senderInfo.platform,
            isLocal: true,
            status: 'online',
          }
        }
      }));

      // Notify sender about other device
      if (senderWs && senderWs.readyState === WebSocket.OPEN) {
        senderWs.send(JSON.stringify({
          type: 'device-discovered',
          payload: {
            device: {
              id: otherSession.info.id,
              name: otherSession.info.name,
              platform: otherSession.info.platform,
              isLocal: true,
              status: otherSession.ws ? 'online' : 'busy',
            }
          }
        }));
      }
    }
  }
}

// Health & diagnostics endpoint
app.get('/api/health', (_, res) => {
  res.json({
    status: 'ok',
    app: 'MOG-SHARE Core Node',
    version: '1.1.0',
    activeSessions: deviceSessions.size,
    activeRooms: rooms.size,
    rooms: Array.from(rooms.entries()).map(([code, r]) => ({
      code,
      peersCount: r.peerIds.size,
      ageSec: Math.round((Date.now() - r.createdAt) / 1000),
    })),
  });
});

// Serve static client build if present
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
      res.sendFile(path.join(clientDistPath, 'index.html'));
    } else {
      next();
    }
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[MOG-SHARE Server] Active on http://0.0.0.0:${PORT}`);
  console.log(`[MOG-SHARE Server] WebSocket signaling at ws://0.0.0.0:${PORT}/ws`);
});

