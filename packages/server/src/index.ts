import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';

const app = express();
app.set('trust proxy', true);

// Helmet with relaxed CSP for local dev & WebRTC/WebSockets
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// Lock CORS via env var (supports comma-separated list or fallback to allow all in dev)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : '*';

app.use(
  cors({
    origin: allowedOrigins === '*' ? '*' : allowedOrigins,
    credentials: true,
  })
);

app.use(express.json());

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const server = http.createServer(app);

// Maximum payload 1 MB (prevents memory attacks)
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 1 * 1024 * 1024,
});

export type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'web';

export interface DeviceInfo {
  id: string;
  name: string;
  platform: Platform;
  clientIp: string;
  networkKey: string;
  roomCode?: string;
  joinedAt: number;
}

export interface DeviceSession {
  ws: WebSocket | null;
  info: DeviceInfo;
  disconnectTimer?: NodeJS.Timeout;
}

export interface RoomRecord {
  code: string;
  hostDeviceId: string;
  peerIds: Set<string>;
  createdAt: number;
  lastActivityAt: number;
}

// Global Registries
export const deviceSessions = new Map<string, DeviceSession>();
export const wsToDeviceId = new Map<WebSocket, string>();
export const rooms = new Map<string, RoomRecord>();

// Rate Limiting for Room Join (max 5 attempts per minute per IP, with 60s lockout)
interface RateLimitRecord {
  count: number;
  firstAttempt: number;
  lockedUntil?: number;
}
export const joinRateLimits = new Map<string, RateLimitRecord>();

export function checkJoinRateLimit(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const record = joinRateLimits.get(ip);
  if (!record) {
    joinRateLimits.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true };
  }

  if (record.lockedUntil && now < record.lockedUntil) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((record.lockedUntil - now) / 1000),
    };
  }

  if (now - record.firstAttempt > 60 * 1000) {
    record.count = 1;
    record.firstAttempt = now;
    record.lockedUntil = undefined;
    return { allowed: true };
  }

  record.count++;
  if (record.count > 5) {
    record.lockedUntil = now + 60 * 1000;
    return { allowed: false, retryAfterSec: 60 };
  }

  return { allowed: true };
}

export function extractClientIp(req: http.IncomingMessage): string {
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim()) {
    return cfConnectingIp.trim();
  }
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
    return xForwardedFor.split(',')[0].trim();
  }
  if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
    return xForwardedFor[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

export function computeNetworkKey(rawIp: string): string {
  let ip = rawIp.replace(/^::ffff:/, '').trim();

  // Local loopback
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    return 'local_loopback';
  }

  // IPv6: first 4 hextets (/64 prefix)
  if (ip.includes(':')) {
    const hextets = ip.split(':');
    return hextets.slice(0, 4).join(':');
  }

  // IPv4 public IP
  return ip;
}

export function normalizeRoomCode(raw: string): string {
  if (!raw) return '';
  const digitsOnly = raw.replace(/[^\w]/g, '').toUpperCase();
  if (digitsOnly.length === 6) {
    return `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3, 6)}`;
  }
  return raw.trim().toUpperCase();
}

export function generateSecureRoomCode(): string {
  const num = crypto.randomInt(100000, 1000000);
  const str = num.toString();
  return `${str.slice(0, 3)}-${str.slice(3, 6)}`;
}

// Zod validation schemas
const PlatformSchema = z.enum(['ios', 'android', 'macos', 'windows', 'linux', 'web']);

const InboundMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ping'),
    payload: z.any().optional(),
  }),
  z.object({
    type: z.literal('register'),
    payload: z.object({
      id: z.string().min(1).max(64),
      name: z.string().min(1).max(40),
      platform: PlatformSchema.optional().default('web'),
    }),
  }),
  z.object({
    type: z.literal('create-room'),
    payload: z.any().optional(),
  }),
  z.object({
    type: z.literal('join-room'),
    payload: z.object({
      roomCode: z.string().min(1).max(30),
    }),
  }),
  z.object({
    type: z.literal('leave-room'),
    payload: z.any().optional(),
  }),
  z.object({
    type: z.literal('signal'),
    payload: z.object({
      targetPeerId: z.string().min(1).max(64),
      signalData: z.any(),
    }),
  }),
  z.object({
    type: z.literal('clipboard-broadcast'),
    payload: z.object({
      content: z.string().max(100000),
    }),
  }),
  z.object({
    type: z.literal('direct-message'),
    payload: z.object({
      targetPeerId: z.string().min(1).max(64),
      text: z.string().max(10000),
    }),
  }),
  z.object({
    type: z.literal('transfer-request'),
    payload: z.object({
      targetPeerId: z.string().min(1).max(64),
      transferId: z.string().min(1).max(64),
      fileMeta: z.object({
        name: z.string().max(255),
        size: z.number().nonnegative(),
        type: z.string().max(100),
        sha256: z.string().optional(),
      }),
    }),
  }),
  z.object({
    type: z.literal('transfer-response'),
    payload: z.object({
      targetPeerId: z.string().min(1).max(64),
      transferId: z.string().min(1).max(64),
      accepted: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('file-chunk'),
    payload: z.object({
      targetPeerId: z.string().min(1).max(64),
      transferId: z.string().min(1).max(64),
      chunkIndex: z.number().int().nonnegative(),
      totalChunks: z.number().int().positive(),
      data: z.string(),
    }),
  }),
  z.object({
    type: z.literal('transfer-complete'),
    payload: z.object({
      targetPeerId: z.string().min(1).max(64),
      transferId: z.string().min(1).max(64),
    }),
  }),
  z.object({
    type: z.literal('transfer-cancel'),
    payload: z.object({
      targetPeerId: z.string().min(1).max(64),
      transferId: z.string().min(1).max(64),
    }),
  }),
]);

// Room Pruning Engine (Hard TTL: 24h, Idle TTL: 30min, Empty Room: immediate/5min)
setInterval(() => {
  const now = Date.now();
  const HARD_TTL = 24 * 60 * 60 * 1000;
  const IDLE_TTL = 30 * 60 * 1000;

  for (const [code, room] of rooms.entries()) {
    // Check if hard TTL exceeded
    if (now - room.createdAt > HARD_TTL) {
      rooms.delete(code);
      console.log(`[MOG-SHARE Server] Pruned room ${code} (hard 24h TTL)`);
      continue;
    }

    // Check if idle TTL exceeded
    if (now - room.lastActivityAt > IDLE_TTL) {
      rooms.delete(code);
      console.log(`[MOG-SHARE Server] Pruned room ${code} (idle 30m TTL)`);
      continue;
    }

    // Check if all peers disconnected or empty
    if (room.peerIds.size === 0) {
      rooms.delete(code);
      console.log(`[MOG-SHARE Server] Pruned empty room: ${code}`);
    }
  }
}, 30 * 1000);

// WebSocket Keep-Alive Heartbeat (every 25s ping, terminate if missing pong)
interface AliveWebSocket extends WebSocket {
  isAlive?: boolean;
}

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    const ws = client as AliveWebSocket;
    if (ws.isAlive === false) {
      console.log('[MOG-SHARE Server] Terminating stale socket that missed pong');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 25 * 1000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

wss.on('connection', (socket: WebSocket, req) => {
  const ws = socket as AliveWebSocket;
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const rawIp = extractClientIp(req);
  const networkKey = computeNetworkKey(rawIp);

  ws.on('message', (rawData) => {
    try {
      const parsed = JSON.parse(rawData.toString());
      const validation = InboundMessageSchema.safeParse(parsed);
      if (!validation.success) {
        console.warn('[MOG-SHARE Server] Invalid message payload rejected:', validation.error.message);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: 'Invalid message payload rejected by security schema' },
          })
        );
        return;
      }

      const message = validation.data;
      const { type } = message;

      switch (type) {
        case 'ping': {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong', payload: { timestamp: Date.now() } }));
          }
          break;
        }

        case 'register': {
          const { id: deviceId, name, platform } = message.payload;

          // Reject duplicate connection with identical ID if active on another socket
          const existingSession = deviceSessions.get(deviceId);
          if (
            existingSession &&
            existingSession.ws &&
            existingSession.ws !== ws &&
            existingSession.ws.readyState === WebSocket.OPEN
          ) {
            console.warn(`[MOG-SHARE Server] ID conflict detected for ${deviceId}. Rejecting second connection.`);
            ws.send(
              JSON.stringify({
                type: 'id-conflict',
                payload: { message: 'Device ID is already active on another connection. Regenerating ID.' },
              })
            );
            ws.close();
            return;
          }

          wsToDeviceId.set(ws, deviceId);

          let session = existingSession;
          if (session) {
            // Reconnecting device within grace period
            if (session.disconnectTimer) {
              clearTimeout(session.disconnectTimer);
              session.disconnectTimer = undefined;
              console.log(`[MOG-SHARE Server] Device ${name} (${deviceId}) reconnected`);
            }
            session.ws = ws;
            session.info.name = name;
            session.info.platform = platform;
            session.info.clientIp = rawIp;
            session.info.networkKey = networkKey;

            // If device was in a room and room still exists, restore session immediately
            if (session.info.roomCode) {
              const activeRoom = rooms.get(session.info.roomCode);
              if (activeRoom && activeRoom.peerIds.has(deviceId)) {
                activeRoom.lastActivityAt = Date.now();
                ws.send(
                  JSON.stringify({
                    type: 'room-joined',
                    payload: { roomCode: session.info.roomCode },
                  })
                );

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

                ws.send(
                  JSON.stringify({
                    type: 'room-peers',
                    payload: { roomCode: session.info.roomCode, peers },
                  })
                );

                for (const pid of activeRoom.peerIds) {
                  if (pid !== deviceId) {
                    const peerSess = deviceSessions.get(pid);
                    if (peerSess?.ws && peerSess.ws.readyState === WebSocket.OPEN) {
                      peerSess.ws.send(
                        JSON.stringify({
                          type: 'peer-joined-room',
                          payload: {
                            peer: {
                              id: session.info.id,
                              name: session.info.name,
                              platform: session.info.platform,
                              isLocal: false,
                              status: 'online',
                            },
                          },
                        })
                      );
                    }
                  }
                }
              }
            }
          } else {
            // Brand new device
            const info: DeviceInfo = {
              id: deviceId,
              name,
              platform,
              clientIp: rawIp,
              networkKey,
              joinedAt: Date.now(),
            };
            session = { ws, info };
            deviceSessions.set(deviceId, session);
          }

          // D1: Send full peers-snapshot of network group to registering device
          const groupPeers = Array.from(deviceSessions.values())
            .filter((s) => s.info.id !== deviceId && s.info.networkKey === networkKey)
            .map((s) => ({
              id: s.info.id,
              name: s.info.name,
              platform: s.info.platform,
              isLocal: true,
              status: s.ws && s.ws.readyState === WebSocket.OPEN ? 'online' : 'busy',
            }));

          ws.send(
            JSON.stringify({
              type: 'peers-snapshot',
              payload: {
                networkKey,
                peers: groupPeers,
              },
            })
          );

          // Broadcast discovery ONLY to devices in the exact same networkKey group
          broadcastLocalPeers(deviceId, session.info);
          break;
        }

        case 'create-room': {
          const deviceId = wsToDeviceId.get(ws);
          const session = deviceId ? deviceSessions.get(deviceId) : null;
          if (!session) return;

          // Clean up prior room membership if device was in an old room
          if (session.info.roomCode) {
            leaveCurrentRoom(session);
          }

          let code = generateSecureRoomCode();
          while (rooms.has(code)) {
            code = generateSecureRoomCode();
          }

          const now = Date.now();
          const roomRecord: RoomRecord = {
            code,
            hostDeviceId: session.info.id,
            peerIds: new Set([session.info.id]),
            createdAt: now,
            lastActivityAt: now,
          };
          rooms.set(code, roomRecord);
          session.info.roomCode = code;

          ws.send(
            JSON.stringify({
              type: 'room-created',
              payload: { roomCode: code },
            })
          );
          console.log(`[MOG-SHARE Server] Room ${code} created by ${session.info.name}`);
          break;
        }

        case 'join-room': {
          const deviceId = wsToDeviceId.get(ws);
          const session = deviceId ? deviceSessions.get(deviceId) : null;
          if (!session) return;

          // Rate limit join attempts per IP
          const rateCheck = checkJoinRateLimit(rawIp);
          if (!rateCheck.allowed) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: {
                  message: `Too many join attempts. Please wait ${rateCheck.retryAfterSec || 60}s.`,
                },
              })
            );
            return;
          }

          const targetCode = normalizeRoomCode(message.payload.roomCode);
          const room = rooms.get(targetCode);

          if (!room) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { message: `Room "${targetCode}" not found or expired.` },
              })
            );
            return;
          }

          // Max 10 peers per room
          if (room.peerIds.size >= 10 && !room.peerIds.has(session.info.id)) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { message: `Room "${targetCode}" is full (maximum 10 participants).` },
              })
            );
            return;
          }

          // Leave prior room if different
          if (session.info.roomCode && session.info.roomCode !== targetCode) {
            leaveCurrentRoom(session);
          }

          room.peerIds.add(session.info.id);
          room.lastActivityAt = Date.now();
          session.info.roomCode = targetCode;

          // 1. Confirm room join
          ws.send(
            JSON.stringify({
              type: 'room-joined',
              payload: { roomCode: targetCode },
            })
          );

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

          ws.send(
            JSON.stringify({
              type: 'room-peers',
              payload: { roomCode: targetCode, peers: existingPeers },
            })
          );

          // 3. Notify all existing peers in the room about newcomer
          for (const pid of room.peerIds) {
            if (pid !== session.info.id) {
              const peerSess = deviceSessions.get(pid);
              if (peerSess?.ws && peerSess.ws.readyState === WebSocket.OPEN) {
                peerSess.ws.send(
                  JSON.stringify({
                    type: 'peer-joined-room',
                    payload: {
                      peer: {
                        id: session.info.id,
                        name: session.info.name,
                        platform: session.info.platform,
                        isLocal: false,
                        status: 'online',
                      },
                    },
                  })
                );
              }
            }
          }
          console.log(`[MOG-SHARE Server] Device ${session.info.name} joined room ${targetCode}`);
          break;
        }

        case 'leave-room': {
          const deviceId = wsToDeviceId.get(ws);
          const session = deviceId ? deviceSessions.get(deviceId) : null;
          if (session && session.info.roomCode) {
            leaveCurrentRoom(session);
          }
          break;
        }

        case 'signal': {
          const { targetPeerId, signalData } = message.payload;
          const senderId = wsToDeviceId.get(ws);
          const targetSession = deviceSessions.get(targetPeerId);
          if (targetSession?.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(
              JSON.stringify({
                type: 'signal',
                payload: {
                  fromPeerId: senderId,
                  signalData,
                },
              })
            );
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
              room.lastActivityAt = Date.now();
              for (const pid of room.peerIds) {
                if (pid !== senderId) {
                  const targetSess = deviceSessions.get(pid);
                  if (targetSess?.ws && targetSess.ws.readyState === WebSocket.OPEN) {
                    targetSess.ws.send(
                      JSON.stringify({
                        type: 'clipboard-received',
                        payload: {
                          fromDevice: senderSession.info.name,
                          content: message.payload.content,
                          timestamp: Date.now(),
                        },
                      })
                    );
                  }
                }
              }
            }
          } else {
            // Local broadcast ONLY to devices in the same networkKey
            for (const [otherId, targetSess] of deviceSessions.entries()) {
              if (
                otherId !== senderId &&
                targetSess.info.networkKey === senderSession.info.networkKey &&
                targetSess.ws &&
                targetSess.ws.readyState === WebSocket.OPEN
              ) {
                targetSess.ws.send(
                  JSON.stringify({
                    type: 'clipboard-received',
                    payload: {
                      fromDevice: senderSession.info.name,
                      content: message.payload.content,
                      timestamp: Date.now(),
                    },
                  })
                );
              }
            }
          }
          break;
        }

        case 'direct-message': {
          const { targetPeerId, text } = message.payload;
          const senderId = wsToDeviceId.get(ws);
          const senderSession = senderId ? deviceSessions.get(senderId) : null;
          const targetSession = deviceSessions.get(targetPeerId);
          if (targetSession?.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(
              JSON.stringify({
                type: 'direct-message',
                payload: {
                  fromPeerId: senderId,
                  fromDevice: senderSession?.info.name || 'Unknown',
                  text,
                  timestamp: Date.now(),
                },
              })
            );
          }
          break;
        }

        case 'transfer-request': {
          const { targetPeerId, transferId, fileMeta } = message.payload;
          const senderId = wsToDeviceId.get(ws);
          const senderSession = senderId ? deviceSessions.get(senderId) : null;
          const targetSession = deviceSessions.get(targetPeerId);

          if (targetSession?.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(
              JSON.stringify({
                type: 'transfer-request',
                payload: {
                  fromPeer: {
                    id: senderSession?.info.id,
                    name: senderSession?.info.name,
                    platform: senderSession?.info.platform,
                  },
                  transferId,
                  fileMeta,
                },
              })
            );
          }
          break;
        }

        case 'transfer-response': {
          const { targetPeerId, transferId, accepted } = message.payload;
          const targetSession = deviceSessions.get(targetPeerId);
          if (targetSession?.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(
              JSON.stringify({
                type: 'transfer-response',
                payload: { transferId, accepted },
              })
            );
          }
          break;
        }

        case 'file-chunk': {
          const { targetPeerId, transferId, chunkIndex, totalChunks, data } = message.payload;
          const targetSession = deviceSessions.get(targetPeerId);
          if (targetSession?.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(
              JSON.stringify({
                type: 'file-chunk',
                payload: { transferId, chunkIndex, totalChunks, data },
              })
            );
          }
          break;
        }

        case 'transfer-complete': {
          const { targetPeerId, transferId } = message.payload;
          const targetSession = deviceSessions.get(targetPeerId);
          if (targetSession?.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(
              JSON.stringify({
                type: 'transfer-complete',
                payload: { transferId },
              })
            );
          }
          break;
        }

        case 'transfer-cancel': {
          const { targetPeerId, transferId } = message.payload;
          const targetSession = deviceSessions.get(targetPeerId);
          if (targetSession?.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(
              JSON.stringify({
                type: 'transfer-cancel',
                payload: { transferId },
              })
            );
          }
          break;
        }
      }
    } catch (err) {
      console.error('[MOG-SHARE Server] WebSocket processing error:', err);
    }
  });

  ws.on('close', () => {
    const deviceId = wsToDeviceId.get(ws);
    wsToDeviceId.delete(ws);

    if (deviceId) {
      const session = deviceSessions.get(deviceId);
      if (session) {
        session.ws = null;
        console.log(`[MOG-SHARE Server] Device ${session.info.name} (${deviceId}) disconnected. Grace period 60s.`);

        if (session.disconnectTimer) clearTimeout(session.disconnectTimer);

        session.disconnectTimer = setTimeout(() => {
          console.log(`[MOG-SHARE Server] Grace period expired for device ${session.info.name}`);

          // Room departure & host handover
          if (session.info.roomCode) {
            leaveCurrentRoom(session);
          }

          // Broadcast departure ONLY to devices in the exact same networkKey group
          for (const [otherId, targetSess] of deviceSessions.entries()) {
            if (
              otherId !== deviceId &&
              targetSess.info.networkKey === session.info.networkKey &&
              targetSess.ws &&
              targetSess.ws.readyState === WebSocket.OPEN
            ) {
              targetSess.ws.send(
                JSON.stringify({
                  type: 'device-departed',
                  payload: { deviceId },
                })
              );
            }
          }

          deviceSessions.delete(deviceId);
        }, 60000);
      }
    }
  });
});

// Helper: Leave room with host handover
function leaveCurrentRoom(session: DeviceSession) {
  if (!session.info.roomCode) return;
  const roomCode = session.info.roomCode;
  const room = rooms.get(roomCode);

  if (room) {
    room.peerIds.delete(session.info.id);
    room.lastActivityAt = Date.now();

    if (room.peerIds.size === 0) {
      rooms.delete(roomCode);
      console.log(`[MOG-SHARE Server] Room ${roomCode} closed (all peers left).`);
    } else {
      // Host leave behavior: Oldest remaining peer becomes host
      if (room.hostDeviceId === session.info.id) {
        const nextHost = Array.from(room.peerIds)[0];
        room.hostDeviceId = nextHost;
        console.log(`[MOG-SHARE Server] Room ${roomCode} host handed over to ${nextHost}`);
      }

      for (const pid of room.peerIds) {
        const peerSess = deviceSessions.get(pid);
        if (peerSess?.ws && peerSess.ws.readyState === WebSocket.OPEN) {
          peerSess.ws.send(
            JSON.stringify({
              type: 'peer-left-room',
              payload: { peerId: session.info.id },
            })
          );
        }
      }
    }
  }

  delete session.info.roomCode;
}

// Broadcast discovery ONLY to devices with matching networkKey
function broadcastLocalPeers(senderId: string, senderInfo: DeviceInfo) {
  for (const [otherId, otherSession] of deviceSessions.entries()) {
    if (
      otherId !== senderId &&
      otherSession.info.networkKey === senderInfo.networkKey &&
      otherSession.ws &&
      otherSession.ws.readyState === WebSocket.OPEN
    ) {
      // Notify other device about sender
      otherSession.ws.send(
        JSON.stringify({
          type: 'device-discovered',
          payload: {
            device: {
              id: senderInfo.id,
              name: senderInfo.name,
              platform: senderInfo.platform,
              isLocal: true,
              status: 'online',
            },
          },
        })
      );
    }
  }
}

// Health & diagnostics endpoint (R4: NO live room codes returned, counts only)
app.get('/api/health', (_, res) => {
  res.json({
    status: 'ok',
    app: 'MOG-SHARE Core Node',
    version: '2.0.0',
    activeSessions: deviceSessions.size,
    activeRooms: rooms.size,
  });
});

// Info endpoint for QR codes & LAN links (R6)
app.get('/api/info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const localIps: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (netList) {
      for (const net of netList) {
        if (net.family === 'IPv4' && !net.internal) {
          localIps.push(net.address);
        }
      }
    }
  }

  res.json({
    localIps,
    port: PORT,
    clientIp: extractClientIp(req),
  });
});

// Direct ZIP download endpoint for distribution
app.get('/api/download-zip', (_, res) => {
  const possiblePaths = [
    path.resolve(__dirname, '../../client/dist/mog-share-final.zip'),
    path.resolve(__dirname, '../../../mog-share-final.zip'),
    path.resolve(__dirname, '../../../../mog-share-final.zip'),
    path.resolve(process.cwd(), 'mog-share-final.zip'),
    path.resolve(process.cwd(), 'dist/mog-share-final.zip'),
    '/teamspace/studios/this_studio/mog-share-final.zip',
    '/teamspace/studios/this_studio/mog-share/mog-share-final.zip',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return res.download(p, 'mog-share-final.zip');
    }
  }
  res.status(404).json({ error: 'ZIP archive is being generated. Please retry in a few moments.' });
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

// Start server
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[MOG-SHARE Server] Active on http://0.0.0.0:${PORT}`);
    console.log(`[MOG-SHARE Server] WebSocket signaling at ws://0.0.0.0:${PORT}/ws`);
  });
}

export { app, server, wss };
