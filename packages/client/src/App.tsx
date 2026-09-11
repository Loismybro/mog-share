import { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { TacticalBackground } from './components/TacticalBackground';
import { Header } from './components/Header';
import { InstructionsPage } from './components/InstructionsPage';
import { ModeSelector } from './components/ModeSelector';
import { DeviceRadar } from './components/DeviceRadar';
import { OnlineRoomCard } from './components/OnlineRoomCard';
import { DropZone } from './components/DropZone';
import { TransferDock } from './components/TransferDock';
import { ClipboardSyncModal } from './components/ClipboardSyncModal';
import { SettingsModal } from './components/SettingsModal';
import { Device, ShareMode, TransferFile, ClipboardItem, Platform } from './types';
import { sound } from './utils/audio';
import { Download, Check, X, ShieldCheck, Copy } from 'lucide-react';
import { formatBytes } from './utils/formatters';

function detectDefaultDevice(): { name: string; platform: Platform } {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '').toLowerCase();
  if (/ipad/.test(ua)) return { name: 'Apple iPad', platform: 'ios' };
  if (/iphone/.test(ua)) return { name: 'Apple iPhone', platform: 'ios' };
  if (/android/.test(ua)) {
    if (/samsung/.test(ua)) return { name: 'Samsung Galaxy', platform: 'android' };
    if (/pixel/.test(ua)) return { name: 'Google Pixel', platform: 'android' };
    return { name: 'Android Device', platform: 'android' };
  }
  if (/macintosh|mac os x/.test(ua)) return { name: 'MacBook', platform: 'macos' };
  if (/windows/.test(ua)) return { name: 'Windows PC', platform: 'windows' };
  if (/linux/.test(ua)) return { name: 'Linux Desktop', platform: 'linux' };
  return { name: 'Web Browser', platform: 'macos' };
}

function getPersistentDeviceId(): string {
  let id = localStorage.getItem('mog_device_id');
  if (!id) {
    id = 'mog_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).substring(4);
    localStorage.setItem('mog_device_id', id);
  }
  return id;
}

export function App() {
  const [deviceName, setDeviceName] = useState(() => {
    const saved = localStorage.getItem('mog_device_name');
    if (saved && saved !== "Alex's MacBook Pro") return saved;
    return detectDefaultDevice().name;
  });
  const [platform, setPlatform] = useState<Platform>(() => {
    const saved = localStorage.getItem('mog_platform') as Platform;
    if (saved) return saved;
    return detectDefaultDevice().platform;
  });
  const [autoAccept, setAutoAccept] = useState(() => {
    return localStorage.getItem('mog_auto_accept') === 'true';
  });
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Initialize room & mode from URL hash or sessionStorage
  const getInitialRoomAndMode = () => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const hashRoom = hash.startsWith('#room=') ? hash.replace('#room=', '').trim() : null;
    const sessionRoom = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('mog_room_code') : null;
    const code = hashRoom || sessionRoom || null;
    return {
      code,
      mode: (code ? 'online' : 'local') as ShareMode,
    };
  };

  const initialSetup = getInitialRoomAndMode();
  const [mode, setMode] = useState<ShareMode>(initialSetup.mode);
  const [roomCode, setRoomCode] = useState<string | null>(initialSetup.code);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const [isClipboardOpen, setIsClipboardOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'transfer' | 'instructions'>('transfer');

  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [transfers, setTransfers] = useState<TransferFile[]>([]);
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardItem[]>([]);
  const [clipboardToast, setClipboardToast] = useState<{ fromDevice: string; content: string } | null>(null);

  const [incomingPrompt, setIncomingPrompt] = useState<{
    fromPeer: Device;
    fileMeta: { name: string; size: number; type: string };
    transferId: string;
  } | null>(null);

  const myDeviceIdRef = useRef<string>(getPersistentDeviceId());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const pendingRoomJoinRef = useRef<string | null>(initialSetup.code);

  const deviceNameRef = useRef(deviceName);
  deviceNameRef.current = deviceName;
  const platformRef = useRef(platform);
  platformRef.current = platform;
  const autoAcceptRef = useRef(autoAccept);
  autoAcceptRef.current = autoAccept;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const roomCodeRef = useRef(roomCode);
  roomCodeRef.current = roomCode;

  const [localDevices, setLocalDevices] = useState<Device[]>([]);
  const [onlineRoomPeers, setOnlineRoomPeers] = useState<Device[]>([]);

  // Buffers for receiving file chunks as typed Uint8Arrays
  const receivingBuffersRef = useRef<
    Map<
      string,
      {
        meta: { name: string; size: number; type: string };
        chunks: (Uint8Array | undefined)[];
        totalChunks: number;
        receivedCount: number;
        startTime: number;
      }
    >
  >(new Map());

  // Files staged waiting for remote peer acceptance
  const pendingOutgoingFilesRef = useRef<
    Map<string, { file: File; targetPeerId: string }>
  >(new Map());

  // Active sender cancellation tokens
  const activeSendersRef = useRef<Map<string, { cancelled: boolean }>>(new Map());

  useEffect(() => {
    sound.enabled = soundEnabled;
  }, [soundEnabled]);

  // Robust, Auto-Reconnecting WebSocket Engine
  const connectWebSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams(window.location.search);
    const customWs = params.get('ws') || 
                     localStorage.getItem('mog_custom_ws_url') || 
                     (import.meta.env.VITE_WS_URL as string | undefined);

    const wsUrl = customWs ? customWs : `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[MOG-SHARE] WebSocket Connected');
        reconnectAttemptsRef.current = 0;

        // 1. Register persistent device ID
        ws.send(
          JSON.stringify({
            type: 'register',
            payload: {
              id: myDeviceIdRef.current,
              name: deviceNameRef.current,
              platform: platformRef.current,
            },
          })
        );

        // 2. Automatically restore or join pending room
        const codeToJoin = pendingRoomJoinRef.current || roomCodeRef.current;
        if (codeToJoin) {
          console.log(`[MOG-SHARE] Auto-joining room: ${codeToJoin}`);
          ws.send(
            JSON.stringify({
              type: 'join-room',
              payload: { roomCode: codeToJoin },
            })
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'pong':
              break;

            case 'error': {
              console.warn('[MOG-SHARE Server Error]:', msg.payload?.message);
              setRoomError(msg.payload?.message || 'Room error occurred');
              break;
            }

            case 'device-discovered': {
              const dev = msg.payload.device;
              if (dev.id !== myDeviceIdRef.current) {
                setLocalDevices((prev) => {
                  const filtered = prev.filter((d) => d.id !== dev.id);
                  return [...filtered, dev];
                });
                if (modeRef.current === 'local') {
                  setSelectedDeviceId((curr) => curr || dev.id);
                }
              }
              break;
            }

            case 'device-departed': {
              const { deviceId } = msg.payload;
              setLocalDevices((prev) => prev.filter((d) => d.id !== deviceId));
              if (modeRef.current === 'local') {
                setSelectedDeviceId((curr) => (curr === deviceId ? null : curr));
              }
              break;
            }

            case 'room-created': {
              const code = msg.payload.roomCode;
              setRoomCode(code);
              setRoomError(null);
              sessionStorage.setItem('mog_room_code', code);
              window.location.hash = `#room=${code}`;
              pendingRoomJoinRef.current = null;
              sound.playPop();
              break;
            }

            case 'room-joined': {
              const code = msg.payload.roomCode;
              setRoomCode(code);
              setRoomError(null);
              sessionStorage.setItem('mog_room_code', code);
              window.location.hash = `#room=${code}`;
              pendingRoomJoinRef.current = null;
              sound.playPop();
              break;
            }

            case 'room-peers': {
              const { peers } = msg.payload;
              if (Array.isArray(peers)) {
                setOnlineRoomPeers(peers);
                if (peers.length > 0) {
                  setSelectedDeviceId((curr) => {
                    if (!curr || !peers.some((p: Device) => p.id === curr)) {
                      return peers[0].id;
                    }
                    return curr;
                  });
                  sound.playFanfare();
                }
              }
              break;
            }

            case 'peer-joined-room': {
              const { peer } = msg.payload;
              if (peer && peer.id !== myDeviceIdRef.current) {
                setOnlineRoomPeers((prev) => {
                  const filtered = prev.filter((p) => p.id !== peer.id);
                  return [...filtered, peer];
                });
                // Auto-select the newly joined peer
                setSelectedDeviceId(peer.id);
                sound.playFanfare();
              }
              break;
            }

            case 'peer-left-room': {
              const { peerId } = msg.payload;
              setOnlineRoomPeers((prev) => prev.filter((p) => p.id !== peerId));
              setSelectedDeviceId((curr) => (curr === peerId ? null : curr));
              break;
            }

            case 'clipboard-received': {
              const { fromDevice, content, timestamp } = msg.payload;
              setClipboardHistory((prev) => [
                {
                  id: Math.random().toString(),
                  fromDevice,
                  content,
                  timestamp,
                },
                ...prev,
              ]);
              setClipboardToast({ fromDevice, content });
              sound.playFanfare();
              break;
            }

            case 'transfer-request': {
              const { fromPeer, fileMeta, transferId } = msg.payload;
              if (autoAcceptRef.current) {
                handleAcceptTransfer(fromPeer, fileMeta, transferId);
              } else {
                sound.playFanfare();
                setIncomingPrompt({ fromPeer, fileMeta, transferId });
              }
              break;
            }

            case 'transfer-response': {
              const { transferId, accepted } = msg.payload;
              if (!accepted) {
                setTransfers((prev) =>
                  prev.map((t) => (t.id === transferId ? { ...t, status: 'cancelled' } : t))
                );
                pendingOutgoingFilesRef.current.delete(transferId);
                break;
              }
              const pending = pendingOutgoingFilesRef.current.get(transferId);
              if (pending) {
                startStreamingFile(pending.file, pending.targetPeerId, transferId);
              }
              break;
            }

            case 'file-chunk': {
              const { transferId, chunkIndex, totalChunks, data } = msg.payload;
              const buffer = receivingBuffersRef.current.get(transferId);
              if (buffer) {
                if (!buffer.chunks[chunkIndex]) {
                  // Decode Base64 chunk to Uint8Array directly to conserve mobile RAM
                  const binaryStr = atob(data);
                  const len = binaryStr.length;
                  const bytes = new Uint8Array(len);
                  for (let j = 0; j < len; j++) {
                    bytes[j] = binaryStr.charCodeAt(j);
                  }
                  buffer.chunks[chunkIndex] = bytes;
                  buffer.receivedCount++;
                }

                const progress = Math.min(99, Math.round((buffer.receivedCount / totalChunks) * 100));
                const elapsed = (Date.now() - buffer.startTime) / 1000;
                const bytesSoFar = Math.min(
                  buffer.meta.size,
                  (buffer.receivedCount / totalChunks) * buffer.meta.size
                );
                const speed = elapsed > 0 ? bytesSoFar / elapsed : 0;
                const remaining = buffer.meta.size - bytesSoFar;
                const eta = speed > 0 ? Math.max(1, Math.round(remaining / speed)) : 1;

                setTransfers((prev) =>
                  prev.map((t) =>
                    t.id === transferId
                      ? { ...t, progress, speedBytesPerSec: speed, etaSeconds: eta }
                      : t
                  )
                );
              }
              break;
            }

            case 'transfer-complete': {
              const { transferId } = msg.payload;
              const buffer = receivingBuffersRef.current.get(transferId);
              if (buffer) {
                try {
                  // Assembled directly from pre-decoded typed Uint8Array chunks
                  const validChunks = buffer.chunks.filter((c): c is Uint8Array => Boolean(c));
                  const fileBlob = new Blob(validChunks as unknown as BlobPart[], {
                    type: buffer.meta.type || 'application/octet-stream',
                  });
                  const blobUrl = URL.createObjectURL(fileBlob);

                  // Trigger automatic file download
                  const a = document.createElement('a');
                  a.href = blobUrl;
                  a.download = buffer.meta.name;
                  document.body.appendChild(a);
                  a.click();
                  setTimeout(() => {
                    if (document.body.contains(a)) document.body.removeChild(a);
                  }, 1000);

                  setTransfers((prev) =>
                    prev.map((t) =>
                      t.id === transferId
                        ? {
                            ...t,
                            progress: 100,
                            status: 'completed',
                            speedBytesPerSec: 0,
                            etaSeconds: 0,
                            blobUrl,
                          }
                        : t
                    )
                  );

                  sound.playFanfare();
                  confetti({
                    particleCount: 70,
                    spread: 80,
                    origin: { y: 0.85 },
                    colors: ['#00F59B', '#FFC900', '#60A5FA', '#FF90E8'],
                  });
                } catch (err) {
                  console.error('Error assembling received file:', err);
                }
                receivingBuffersRef.current.delete(transferId);
              }
              break;
            }

            case 'transfer-cancel': {
              const { transferId } = msg.payload;
              setTransfers((prev) =>
                prev.map((t) => (t.id === transferId ? { ...t, status: 'cancelled' } : t))
              );
              receivingBuffersRef.current.delete(transferId);
              break;
            }
          }
        } catch (e) {
          console.error('Error parsing ws event:', e);
        }
      };

      ws.onclose = () => {
        console.warn('[MOG-SHARE] WebSocket Closed. Scheduling reconnect...');
        wsRef.current = null;
        const delay = Math.min(5000, 500 * Math.pow(1.5, reconnectAttemptsRef.current));
        reconnectAttemptsRef.current++;
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, delay);
      };

      ws.onerror = () => {
        if (wsRef.current) wsRef.current.close();
      };
    } catch {
      // WS constructor error guard
    }
  }, []);

  // Initialize WebSocket once on mount
  useEffect(() => {
    connectWebSocket();

    // Ping interval to keep connection alive on cellular / Cloudflare tunnels
    const pingInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);

    // Reconnect immediately when mobile browser tab resumes from file picker or background
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (
          !wsRef.current ||
          wsRef.current.readyState === WebSocket.CLOSED ||
          wsRef.current.readyState === WebSocket.CLOSING
        ) {
          console.log('[MOG-SHARE] Tab resumed visible, reconnecting socket...');
          connectWebSocket();
        }
      }
    };

    const handleOnline = () => {
      console.log('[MOG-SHARE] Device back online, reconnecting socket...');
      connectWebSocket();
    };

    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#room=')) {
        const code = hash.replace('#room=', '').trim();
        if (code && code !== roomCodeRef.current) {
          setMode('online');
          handleJoinRoom(code);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      clearInterval(pingInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('hashchange', handleHashChange);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWebSocket]);

  // Mode change handler with target auto-selection
  const handleModeChange = (newMode: ShareMode) => {
    setMode(newMode);
    if (newMode === 'online') {
      if (onlineRoomPeers.length > 0) {
        setSelectedDeviceId(onlineRoomPeers[0].id);
      }
    } else {
      if (localDevices.length > 0) {
        setSelectedDeviceId(localDevices[0].id);
      }
    }
  };

  const handleCreateRoom = () => {
    setRoomError(null);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'create-room' }));
    } else {
      connectWebSocket();
    }
  };

  const handleJoinRoom = (code: string) => {
    setRoomError(null);
    const cleanCode = code.trim();
    if (!cleanCode) return;

    pendingRoomJoinRef.current = cleanCode;
    sessionStorage.setItem('mog_room_code', cleanCode);
    window.location.hash = `#room=${cleanCode}`;
    setRoomCode(cleanCode);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'join-room',
          payload: { roomCode: cleanCode },
        })
      );
    } else {
      connectWebSocket();
    }
  };

  const handleLeaveRoom = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'leave-room' }));
    }
    setRoomCode(null);
    setOnlineRoomPeers([]);
    setRoomError(null);
    pendingRoomJoinRef.current = null;
    sessionStorage.removeItem('mog_room_code');
    window.location.hash = '';
  };

  const handleBroadcastClipboard = (content: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'clipboard-broadcast',
          payload: { content },
        })
      );
    }
    setClipboardHistory((prev) => [
      {
        id: Math.random().toString(),
        fromDevice: `${deviceName} (You)`,
        content,
        timestamp: Date.now(),
      },
      ...prev,
    ]);
  };

  const handleSaveDeviceName = (name: string) => {
    setDeviceName(name);
    localStorage.setItem('mog_device_name', name);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'register',
          payload: {
            id: myDeviceIdRef.current,
            name,
            platform,
          },
        })
      );
    }
  };

  const handleSavePlatform = (p: Platform) => {
    setPlatform(p);
    localStorage.setItem('mog_platform', p);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'register',
          payload: {
            id: myDeviceIdRef.current,
            name: deviceName,
            platform: p,
          },
        })
      );
    }
  };

  const handleToggleAutoAccept = () => {
    const next = !autoAccept;
    setAutoAccept(next);
    localStorage.setItem('mog_auto_accept', String(next));
  };

  // Real File Sending Loop with Target Validation
  const handleSendFiles = () => {
    if (stagedFiles.length === 0) return;
    const target = (mode === 'local' ? localDevices : onlineRoomPeers).find(
      (d) => d.id === selectedDeviceId
    );
    if (!target) return;

    sound.playPop();

    stagedFiles.forEach((file) => {
      const transferId = 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      pendingOutgoingFilesRef.current.set(transferId, { file, targetPeerId: target.id });

      const newTransfer: TransferFile = {
        id: transferId,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        progress: 0,
        speedBytesPerSec: 0,
        etaSeconds: Math.max(1, Math.round(file.size / (30 * 1024 * 1024))),
        status: 'transferring',
        direction: 'sending',
        peerName: target.name,
        createdAt: Date.now(),
      };

      setTransfers((prev) => [newTransfer, ...prev]);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'transfer-request',
            payload: {
              targetPeerId: target.id,
              transferId,
              fileMeta: {
                name: file.name,
                size: file.size,
                type: file.type || 'application/octet-stream',
              },
            },
          })
        );
      }
    });

    setStagedFiles([]);
  };

  // Stream File in Real Binary Chunks with Backpressure Control
  const startStreamingFile = (file: File, targetPeerId: string, transferId: string) => {
    const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    let chunkIndex = 0;
    const startTime = Date.now();
    const token = { cancelled: false };
    activeSendersRef.current.set(transferId, token);

    const sendNextChunk = () => {
      if (token.cancelled) return;

      // Mobile backpressure guard: pause reading if WebSocket buffer exceeds 128KB
      if (wsRef.current && wsRef.current.bufferedAmount > 128 * 1024) {
        setTimeout(sendNextChunk, 20);
        return;
      }

      if (chunkIndex >= totalChunks) {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'transfer-complete',
              payload: {
                targetPeerId,
                transferId,
              },
            })
          );
        }

        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId
              ? { ...t, progress: 100, status: 'completed', speedBytesPerSec: 0, etaSeconds: 0 }
              : t
          )
        );
        sound.playFanfare();
        confetti({
          particleCount: 60,
          spread: 70,
          origin: { y: 0.85 },
          colors: ['#ff90e8', '#ffc900', '#00f59b', '#90b8f8'],
        });
        activeSendersRef.current.delete(transferId);
        pendingOutgoingFilesRef.current.delete(transferId);
        return;
      }

      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(file.size, start + CHUNK_SIZE);
      const slice = file.slice(start, end);
      const reader = new FileReader();

      reader.onload = () => {
        if (token.cancelled) return;
        const resultStr = reader.result as string;
        const base64Data = resultStr.includes(',') ? resultStr.split(',')[1] : resultStr;

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'file-chunk',
              payload: {
                targetPeerId,
                transferId,
                chunkIndex,
                totalChunks,
                data: base64Data,
              },
            })
          );
        }

        chunkIndex++;
        const progress = Math.min(99, Math.round((chunkIndex / totalChunks) * 100));
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? end / elapsed : 0;
        const remaining = file.size - end;
        const eta = speed > 0 ? Math.max(1, Math.round(remaining / speed)) : 1;

        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId
              ? { ...t, progress, speedBytesPerSec: speed, etaSeconds: eta }
              : t
          )
        );

        setTimeout(sendNextChunk, 2);
      };

      reader.readAsDataURL(slice);
    };

    sendNextChunk();
  };

  const handleAcceptTransfer = (
    fromPeer: Device,
    fileMeta: { name: string; size: number; type: string },
    transferId: string
  ) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'transfer-response',
          payload: {
            targetPeerId: fromPeer.id,
            transferId,
            accepted: true,
          },
        })
      );
    }

    const CHUNK_SIZE = 64 * 1024;
    const totalChunks = Math.max(1, Math.ceil(fileMeta.size / CHUNK_SIZE));
    receivingBuffersRef.current.set(transferId, {
      meta: fileMeta,
      chunks: new Array(totalChunks),
      totalChunks,
      receivedCount: 0,
      startTime: Date.now(),
    });

    const newTransfer: TransferFile = {
      id: transferId,
      name: fileMeta.name,
      size: fileMeta.size,
      type: fileMeta.type,
      progress: 0,
      speedBytesPerSec: 0,
      etaSeconds: Math.max(1, Math.round(fileMeta.size / (30 * 1024 * 1024))),
      status: 'transferring',
      direction: 'receiving',
      peerName: fromPeer.name,
      createdAt: Date.now(),
    };

    setTransfers((prev) => [newTransfer, ...prev]);
    setIncomingPrompt(null);
  };

  const handleDeclineTransfer = (fromPeer: Device, transferId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'transfer-response',
          payload: {
            targetPeerId: fromPeer.id,
            transferId,
            accepted: false,
          },
        })
      );
    }
    setIncomingPrompt(null);
  };

  const handleCancelTransfer = (id: string) => {
    const senderToken = activeSendersRef.current.get(id);
    if (senderToken) {
      senderToken.cancelled = true;
      activeSendersRef.current.delete(id);
    }
    receivingBuffersRef.current.delete(id);
    setTransfers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: 'cancelled' } : t))
    );
  };

  const handleClearCompleted = () => {
    setTransfers((prev) => prev.filter((t) => t.status === 'transferring'));
  };

  const activeDevices = mode === 'local' ? localDevices : onlineRoomPeers;
  const currentTarget = activeDevices.find((d) => d.id === selectedDeviceId) || null;
  const isTransferring = transfers.some((t) => t.status === 'transferring');

  return (
    <div className="min-h-screen pb-28 flex flex-col justify-between tactical-canvas-bg text-slate-100 selection:bg-[#FFC900] selection:text-black relative overflow-hidden">
      <TacticalBackground />

      {/* Real-time Clipboard Toast Alert */}
      {clipboardToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 animate-pop max-w-md w-full px-4">
          <div className="neo-box p-3.5 bg-[#131722] border-3 border-[#00F59B] shadow-[6px_6px_0px_#000] flex items-center justify-between gap-3 text-white">
            <div className="min-w-0 flex-1">
              <span className="neo-badge bg-[#00F59B] text-black text-[9px] py-0 px-1.5 inline-block mb-1">
                CLIPBOARD FROM {clipboardToast.fromDevice.toUpperCase()}
              </span>
              <p className="text-xs font-mono font-bold text-slate-200 truncate m-0">
                "{clipboardToast.content}"
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(clipboardToast.content);
                sound.playPop();
                setClipboardToast(null);
              }}
              className="neo-btn neo-btn-mint px-3 py-1.5 text-xs font-black uppercase text-black shrink-0 flex items-center gap-1"
            >
              <Copy className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Copy</span>
            </button>
          </div>
        </div>
      )}

      <div>
        <Header
          mode={mode}
          connectedPeersCount={activeDevices.length}
          soundEnabled={soundEnabled}
          onToggleSound={() => setSoundEnabled(!soundEnabled)}
          onOpenClipboard={() => setIsClipboardOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          deviceName={deviceName}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {activeTab === 'transfer' ? (
          <>
            <ModeSelector currentMode={mode} onModeChange={handleModeChange} />

            {mode === 'local' ? (
              <DeviceRadar
                devices={localDevices}
                selectedDeviceId={selectedDeviceId}
                onSelectDevice={(device) => setSelectedDeviceId(device.id)}
                myDeviceName={deviceName}
                myPlatform={platform}
              />
            ) : (
              <OnlineRoomCard
                roomCode={roomCode}
                onCreateRoom={handleCreateRoom}
                onJoinRoom={handleJoinRoom}
                onLeaveRoom={handleLeaveRoom}
                connectedRoomPeers={onlineRoomPeers}
                selectedDeviceId={selectedDeviceId}
                onSelectDevice={(peer) => setSelectedDeviceId(peer.id)}
                errorMessage={roomError}
                onClearError={() => setRoomError(null)}
              />
            )}

            <DropZone
              files={stagedFiles}
              onFilesChange={setStagedFiles}
              targetDevice={currentTarget}
              onSend={handleSendFiles}
              isTransferring={isTransferring}
            />
          </>
        ) : (
          <InstructionsPage onBackToHub={() => setActiveTab('transfer')} />
        )}
      </div>

      <TransferDock
        transfers={transfers}
        onCancelTransfer={handleCancelTransfer}
        onClearCompleted={handleClearCompleted}
      />

      {incomingPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-pop">
          <div className="neo-box p-6 max-w-sm w-full bg-[#131722] border-3 border-[#2a324b] shadow-[8px_8px_0px_#000] text-center text-white">
            <div className="w-14 h-14 rounded-2xl bg-[#00F59B] border-3 border-black shadow-[3px_3px_0px_#000] flex items-center justify-center mx-auto mb-3">
              <Download className="w-7 h-7 text-black stroke-[2.5] animate-bounce" />
            </div>

            <span className="neo-badge bg-[#FFC900] text-black mb-2 inline-block">
              INCOMING TRANSFER
            </span>
            <h4 className="text-base font-black uppercase text-white m-0 font-mono">
              Incoming Payload
            </h4>
            <p className="text-xs font-medium text-slate-400 mt-1 mb-4">
              <strong className="text-white font-bold">{incomingPrompt.fromPeer.name}</strong> wants to send:
            </p>

            <div className="p-3 rounded-xl bg-[#1a1f2e] border-2 border-[#2a324b] text-xs text-left mb-5 shadow-[2px_2px_0px_#000]">
              <p className="font-bold text-white truncate m-0">
                {incomingPrompt.fileMeta.name}
              </p>
              <p className="text-[11px] text-slate-400 font-mono font-bold m-0 mt-0.5">
                {formatBytes(incomingPrompt.fileMeta.size)} • Direct P2P
              </p>
            </div>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => {
                  sound.playPop();
                  handleDeclineTransfer(incomingPrompt.fromPeer, incomingPrompt.transferId);
                }}
                className="neo-btn neo-btn-dark flex-1 py-3 text-xs font-black uppercase"
              >
                <X className="w-4 h-4 stroke-[3]" />
                <span>Decline</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  sound.playPop();
                  handleAcceptTransfer(
                    incomingPrompt.fromPeer,
                    incomingPrompt.fileMeta,
                    incomingPrompt.transferId
                  );
                }}
                className="neo-btn neo-btn-mint flex-1 py-3 text-xs font-black uppercase text-black"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>Accept</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <ClipboardSyncModal
        isOpen={isClipboardOpen}
        onClose={() => setIsClipboardOpen(false)}
        onBroadcastClipboard={handleBroadcastClipboard}
        receivedItems={clipboardHistory}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        deviceName={deviceName}
        onSaveDeviceName={handleSaveDeviceName}
        platform={platform}
        onSavePlatform={handleSavePlatform}
        autoAccept={autoAccept}
        onToggleAutoAccept={handleToggleAutoAccept}
      />

      <footer className="w-full text-center py-5 text-xs font-mono font-bold text-slate-500 relative z-10">
        <div className="flex items-center justify-center gap-4">
          <span className="uppercase text-slate-300">MOG-SHARE CORE ENGINE</span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-4 h-4 text-[#00F59B] stroke-[2.5]" />
            <span className="text-slate-400">0% Cloud Storage • 100% P2P</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;
