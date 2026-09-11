import express from 'express';
import http from 'http';
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

const clients = new Map<WebSocket, DeviceInfo>();
const rooms = new Map<string, Set<WebSocket>>();

function generateMogCode(): string {
  const part1 = Math.floor(100 + Math.random() * 900);
  const part2 = Math.floor(100 + Math.random() * 900);
  return `${part1}-${part2}`;
}

// Cleanup stale rooms
setInterval(() => {
  for (const [code, members] of rooms.entries()) {
    if (members.size === 0) {
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000);

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
        case 'register': {
          const info: DeviceInfo = {
            id: payload.id,
            name: payload.name,
            platform: payload.platform || 'web',
            clientIp,
            joinedAt: Date.now(),
          };
          clients.set(ws, info);
          broadcastLocalPeers(ws, info);
          break;
        }

        case 'create-room': {
          let code = generateMogCode();
          while (rooms.has(code)) {
            code = generateMogCode();
          }
          const roomSet = new Set<WebSocket>([ws]);
          rooms.set(code, roomSet);

          const info = clients.get(ws);
          if (info) info.roomCode = code;

          ws.send(JSON.stringify({
            type: 'room-created',
            payload: { roomCode: code }
          }));
          break;
        }

        case 'join-room': {
          const targetCode = payload.roomCode?.trim();
          const roomSet = rooms.get(targetCode);

          if (!roomSet || roomSet.size === 0) {
            ws.send(JSON.stringify({
              type: 'error',
              payload: { message: `Room "${targetCode}" not found.` }
            }));
            return;
          }

          roomSet.add(ws);
          const joinerInfo = clients.get(ws);
          if (joinerInfo) joinerInfo.roomCode = targetCode;

          ws.send(JSON.stringify({
            type: 'room-joined',
            payload: { roomCode: targetCode }
          }));

          for (const member of roomSet) {
            if (member !== ws && member.readyState === WebSocket.OPEN) {
              const existingInfo = clients.get(member);
              member.send(JSON.stringify({
                type: 'peer-joined-room',
                payload: { peer: joinerInfo }
              }));
              ws.send(JSON.stringify({
                type: 'peer-joined-room',
                payload: { peer: existingInfo }
              }));
            }
          }
          break;
        }

        case 'signal': {
          const { targetPeerId, signalData } = payload;
          const senderInfo = clients.get(ws);
          for (const [clientWs, info] of clients.entries()) {
            if (info.id === targetPeerId && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'signal',
                payload: {
                  fromPeerId: senderInfo?.id,
                  signalData
                }
              }));
              break;
            }
          }
          break;
        }

        case 'clipboard-broadcast': {
          const senderInfo = clients.get(ws);
          if (!senderInfo) return;

          const recipients = senderInfo.roomCode 
            ? Array.from(rooms.get(senderInfo.roomCode) || [])
            : Array.from(clients.keys());

          for (const clientWs of recipients) {
            if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'clipboard-received',
                payload: {
                  fromDevice: senderInfo.name,
                  content: payload.content,
                  timestamp: Date.now()
                }
              }));
            }
          }
          break;
        }

        case 'transfer-request': {
          const { targetPeerId, transferId, fileMeta } = payload;
          const senderInfo = clients.get(ws);
          for (const [clientWs, info] of clients.entries()) {
            if (info.id === targetPeerId && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'transfer-request',
                payload: {
                  fromPeer: {
                    id: senderInfo?.id,
                    name: senderInfo?.name,
                    platform: senderInfo?.platform,
                  },
                  transferId,
                  fileMeta
                }
              }));
              break;
            }
          }
          break;
        }

        case 'transfer-response': {
          const { targetPeerId, transferId, accepted } = payload;
          for (const [clientWs, info] of clients.entries()) {
            if (info.id === targetPeerId && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'transfer-response',
                payload: { transferId, accepted }
              }));
              break;
            }
          }
          break;
        }

        case 'file-chunk': {
          const { targetPeerId, transferId, chunkIndex, totalChunks, data } = payload;
          for (const [clientWs, info] of clients.entries()) {
            if (info.id === targetPeerId && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'file-chunk',
                payload: { transferId, chunkIndex, totalChunks, data }
              }));
              break;
            }
          }
          break;
        }

        case 'transfer-complete': {
          const { targetPeerId, transferId } = payload;
          for (const [clientWs, info] of clients.entries()) {
            if (info.id === targetPeerId && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'transfer-complete',
                payload: { transferId }
              }));
              break;
            }
          }
          break;
        }

        case 'transfer-cancel': {
          const { targetPeerId, transferId } = payload;
          for (const [clientWs, info] of clients.entries()) {
            if (info.id === targetPeerId && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'transfer-cancel',
                payload: { transferId }
              }));
              break;
            }
          }
          break;
        }

        case 'leave-room': {
          const info = clients.get(ws);
          if (info && info.roomCode) {
            const roomSet = rooms.get(info.roomCode);
            if (roomSet) {
              roomSet.delete(ws);
              if (roomSet.size === 0) rooms.delete(info.roomCode);
              else {
                for (const member of roomSet) {
                  if (member.readyState === WebSocket.OPEN) {
                    member.send(JSON.stringify({
                      type: 'peer-left-room',
                      payload: { peerId: info.id }
                    }));
                  }
                }
              }
            }
            delete info.roomCode;
          }
          break;
        }
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info) {
      if (info.roomCode) {
        const roomSet = rooms.get(info.roomCode);
        if (roomSet) {
          roomSet.delete(ws);
          for (const member of roomSet) {
            if (member.readyState === WebSocket.OPEN) {
              member.send(JSON.stringify({
                type: 'peer-left-room',
                payload: { peerId: info.id }
              }));
            }
          }
        }
      }
      for (const [clientWs] of clients.entries()) {
        if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'device-departed',
            payload: { deviceId: info.id }
          }));
        }
      }
      clients.delete(ws);
    }
  });
});

function broadcastLocalPeers(senderWs: WebSocket, senderInfo: DeviceInfo) {
  for (const [clientWs, otherInfo] of clients.entries()) {
    if (clientWs !== senderWs && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({
        type: 'device-discovered',
        payload: {
          device: {
            id: senderInfo.id,
            name: senderInfo.name,
            platform: senderInfo.platform,
            isLocal: true,
          }
        }
      }));

      senderWs.send(JSON.stringify({
        type: 'device-discovered',
        payload: {
          device: {
            id: otherInfo.id,
            name: otherInfo.name,
            platform: otherInfo.platform,
            isLocal: true,
          }
        }
      }));
    }
  }
}

app.get('/api/health', (_, res) => {
  res.json({
    status: 'ok',
    app: 'MOG-SHARE Core Node',
    version: '1.0.0',
    activeClients: clients.size,
    activeRooms: rooms.size,
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[MOG-SHARE Server] Active on http://0.0.0.0:${PORT}`);
  console.log(`[MOG-SHARE Server] WebSocket signaling at ws://0.0.0.0:${PORT}/ws`);
});
