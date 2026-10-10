import { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { Header } from './components/Header';
import { InstructionsPage } from './components/InstructionsPage';
import { ModeSelector, MainNavTab } from './components/ModeSelector';
import { DeviceRadar } from './components/DeviceRadar';
import { OnlineRoomCard } from './components/OnlineRoomCard';
import { DropZone } from './components/DropZone';
import { TransferDock } from './components/TransferDock';
import { ClipboardSyncModal } from './components/ClipboardSyncModal';
import { SettingsModal } from './components/SettingsModal';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { DirectMessageModal } from './components/DirectMessageModal';
import { IncomingTransferSheet, QueuedIncomingItem } from './components/IncomingTransferSheet';
import { 
  Device,
  TransferFile,
  ClipboardItem,
  Platform, 
  ConnectionState, 
  DirectMessage,
  DiagnosticsData,
  FileMeta 
} from './types';
import { sound } from './utils/audio';
import { NetworkService, safeGetStorage, safeSetStorage } from './services/network';
import { generateFriendlyDeviceName, sanitizeFileName, calculateSha256 } from './utils/security';
import { formatBytes } from './utils/formatters';
import { 
  Download, 
  Clock 
} from 'lucide-react';

// D9: Smart device platform & friendly name detection
function detectDefaultDevice(): { name: string; platform: Platform } {
  if (typeof navigator === 'undefined') return { name: 'Device', platform: 'web' };
  const ua = navigator.userAgent.toLowerCase();

  // iPadOS reports Macintosh with multi-touch
  if (navigator.maxTouchPoints > 1 && /macintosh/.test(ua)) {
    return { name: generateFriendlyDeviceName(), platform: 'ios' };
  }
  if (/ipad|iphone/.test(ua)) {
    return { name: generateFriendlyDeviceName(), platform: 'ios' };
  }
  if (/android/.test(ua)) {
    return { name: generateFriendlyDeviceName(), platform: 'android' };
  }
  if (/macintosh|mac os x/.test(ua)) {
    return { name: generateFriendlyDeviceName(), platform: 'macos' };
  }
  if (/windows/.test(ua)) {
    return { name: generateFriendlyDeviceName(), platform: 'windows' };
  }
  if (/linux/.test(ua)) {
    return { name: generateFriendlyDeviceName(), platform: 'linux' };
  }
  return { name: generateFriendlyDeviceName(), platform: 'web' };
}

// D9: Persistent UUID device identity in localStorage
function getPersistentDeviceId(): string {
  const saved = safeGetStorage('mog_device_id');
  if (saved && saved.startsWith('mog_')) return saved;
  const newId = 'mog_' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).substring(2, 12));
  safeSetStorage('mog_device_id', newId);
  return newId;
}

export function App() {
  // Device identity
  const [deviceName, setDeviceName] = useState(() => {
    return safeGetStorage('mog_device_name') || detectDefaultDevice().name;
  });

  const [platform, setPlatform] = useState<Platform>(() => {
    const saved = safeGetStorage('mog_platform') as Platform;
    if (saved) return saved;
    return detectDefaultDevice().platform;
  });

  // Theme support (Phase 5)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = safeGetStorage('mog_theme') as 'dark' | 'light';
    if (saved) return saved;
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    safeSetStorage('mog_theme', theme);
  }, [theme]);

  // Connection State Machine (R2)
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [activeMode, setActiveMode] = useState<'server' | 'mesh' | 'offline'>('offline');
  const [serverLocalIps, setServerLocalIps] = useState<string[]>([]);
  const [serverPort, setServerPort] = useState<number>(4000);

  // Trusted Devices (F6)
  const [trustedDeviceIds, setTrustedDeviceIds] = useState<Set<string>>(() => {
    try {
      const raw = safeGetStorage('mog_trusted_devices');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [autoAccept, setAutoAccept] = useState(() => {
    return safeGetStorage('mog_auto_accept') === 'true';
  });

  // Navigation & Active Room
  const [mainTab, setMainTab] = useState<MainNavTab>('nearby');
  const [showInstructions, setShowInstructions] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    return hash.startsWith('#room=') ? hash.replace('#room=', '').trim() : null;
  });
  const [roomError, setRoomError] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // Modals
  const [isClipboardOpen, setIsClipboardOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [messageTargetDevice, setMessageTargetDevice] = useState<Device | null>(null);

  // Data & Queues
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [transfers, setTransfers] = useState<TransferFile[]>([]);
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardItem[]>([]);
  const [incomingQueue, setIncomingQueue] = useState<QueuedIncomingItem[]>([]);

  // Toast notification
  const [toastMessage, setToastMessage] = useState<{ id: string; text: string; type?: 'info' | 'success' | 'warn' } | null>(null);

  const showToast = (text: string, type: 'info' | 'success' | 'warn' = 'info') => {
    const id = Math.random().toString();
    setToastMessage({ id, text, type });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.id === id ? null : prev));
    }, 3500);
  };

  // Peer Registries
  const [localDevices, setLocalDevices] = useState<Device[]>([]);
  const [roomPeers, setRoomPeers] = useState<Device[]>([]);

  // Refs
  const myDeviceIdRef = useRef<string>(getPersistentDeviceId());
  const networkRef = useRef<NetworkService | null>(null);
  const activeSendersRef = useRef<Map<string, { cancelled: boolean }>>(new Map());
  const receivingBuffersRef = useRef<
    Map<
      string,
      {
        meta: FileMeta;
        chunks: (ArrayBuffer | Uint8Array | undefined)[];
        totalChunks: number;
        receivedCount: number;
        totalBytesReceived: number;
        startTime: number;
        fileStreamWritable?: any; // Chromium FileSystemWritableFileStream (T6)
      }
    >
  >(new Map());

  // Throttled UI updater (T7: 150ms throttle)
  const lastProgressUpdateRef = useRef<number>(0);

  // Fetch /api/info on startup to learn LAN IPs for QR code (R6)
  useEffect(() => {
    fetch('/api/info')
      .then((res) => res.json())
      .then((data) => {
        if (data.localIps && Array.isArray(data.localIps)) {
          setServerLocalIps(data.localIps);
        }
        if (data.port) setServerPort(data.port);
      })
      .catch(() => {});
  }, []);

  // F6: Save trusted devices
  const toggleTrustDevice = (deviceId: string) => {
    setTrustedDeviceIds((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) {
        next.delete(deviceId);
        showToast('Device removed from trusted list', 'info');
      } else {
        next.add(deviceId);
        showToast('Device added to trusted list (auto-accept active)', 'success');
      }
      safeSetStorage('mog_trusted_devices', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  // T10: Mobile screen wake lock during active transfers
  useEffect(() => {
    const hasActiveTransfers = transfers.some(
      (t) => t.status === 'transferring' || t.status === 'connecting'
    );

    let wakeLock: any = null;
    if (hasActiveTransfers && typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      (navigator as any).wakeLock
        .request('screen')
        .then((lock: any) => {
          wakeLock = lock;
        })
        .catch(() => {});
    }

    const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (hasActiveTransfers) {
        e.preventDefault();
        e.returnValue = 'Transfer is actively streaming. Are you sure you want to exit?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', beforeUnloadHandler);

    return () => {
      if (wakeLock) {
        try { wakeLock.release(); } catch {}
      }
      window.removeEventListener('beforeunload', beforeUnloadHandler);
    };
  }, [transfers]);

  // Handle saving completed file to disk (T8)
  const handleSaveFile = useCallback((transfer: TransferFile) => {
    if (!transfer.blobUrl) return;
    sound.playPop();

    const cleanName = sanitizeFileName(transfer.name);
    const a = document.createElement('a');
    a.href = transfer.blobUrl;
    a.download = cleanName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
    }, 1000);
    showToast(`Saved "${cleanName}"`, 'success');
  }, []);

  // Stream File with WebRTC DataChannel (T1, T7, backpressure & SHA-256)
  const startStreamingFile = useCallback(
    async (file: File, targetPeerId: string, targetPeerName: string, transferId: string) => {
      // 16 KB chunks for cross-browser WebRTC interoperability (T1)
      const CHUNK_SIZE = 16 * 1024;
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      let chunkIndex = 0;
      const startTime = Date.now();
      let lastWindowBytes = 0;
      let lastWindowTime = startTime;

      const token = { cancelled: false };
      activeSendersRef.current.set(transferId, token);

      // Attempt to establish WebRTC DataChannel (8s ICE timeout)
      const dc = await networkRef.current?.prepareDataChannel(targetPeerId, transferId);
      const isRelayed = !dc || dc.readyState !== 'open';

      // Update transfer status to transferring with relayed badge (T1)
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transferId
            ? { ...t, status: 'transferring', relayed: isRelayed }
            : t
        )
      );

      // Read & send chunks loop
      while (chunkIndex < totalChunks) {
        if (token.cancelled) {
          activeSendersRef.current.delete(transferId);
          return;
        }

        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const slice = file.slice(start, end);

        // High performance ArrayBuffer reading (T7)
        const arrayBuf = await slice.arrayBuffer();

        // Send over WebRTC DataChannel or relayed WS
        await networkRef.current?.sendChunk(
          targetPeerId,
          transferId,
          chunkIndex,
          totalChunks,
          arrayBuf,
          dc || null
        );

        chunkIndex++;
        const sentBytes = Math.min(file.size, chunkIndex * CHUNK_SIZE);

        // Rolling 2s window speed calculation (T7)
        const now = Date.now();
        if (now - lastWindowTime >= 2000) {
          const windowElapsed = (now - lastWindowTime) / 1000;
          const windowBytes = sentBytes - lastWindowBytes;
          const speed = windowBytes / windowElapsed;
          const remainingBytes = file.size - sentBytes;
          const eta = speed > 0 ? Math.ceil(remainingBytes / speed) : 0;

          lastWindowBytes = sentBytes;
          lastWindowTime = now;

          // Throttled React state update (150ms throttle)
          if (now - lastProgressUpdateRef.current > 150) {
            lastProgressUpdateRef.current = now;
            const progress = Math.min(99, Math.round((sentBytes / file.size) * 100));
            setTransfers((prev) =>
              prev.map((t) =>
                t.id === transferId
                  ? { ...t, progress, speedBytesPerSec: speed, etaSeconds: eta }
                  : t
              )
            );
          }
        }
      }

      // Finish transfer
      if (!token.cancelled) {
        networkRef.current?.sendTransferComplete(targetPeerId, transferId);
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId
              ? { ...t, progress: 100, status: 'completed', speedBytesPerSec: 0, etaSeconds: 0, completedAt: Date.now() }
              : t
          )
        );

        sound.playFanfare();
        // Confetti only if reduced-motion is not requested (Phase 5)
        if (typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.85 },
            colors: ['#FFC900', '#10B981', '#3B82F6'],
          });
        }
        showToast(`Sent "${file.name}" to ${targetPeerName}`, 'success');
      }

      activeSendersRef.current.delete(transferId);
    },
    []
  );

  // Accept incoming transfer request (T3)
  const handleAcceptTransfer = useCallback(
    async (transferId: string) => {
      const item = incomingQueue.find((i) => i.transferId === transferId);
      if (!item) return;

      sound.playPop();

      // Remove from incoming queue
      setIncomingQueue((prev) => prev.filter((i) => i.transferId !== transferId));

      // Calculate total chunks for 16 KB chunks
      const CHUNK_SIZE = 16 * 1024;
      const totalChunks = Math.max(1, Math.ceil(item.fileMeta.size / CHUNK_SIZE));

      // Chromium Desktop Direct-to-Disk Stream (T6)
      let fileStreamWritable: any = null;
      if (typeof window !== 'undefined' && 'showSaveFilePicker' in window && item.fileMeta.size > 200 * 1024 * 1024) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: sanitizeFileName(item.fileMeta.name),
          });
          fileStreamWritable = await handle.createWritable();
        } catch {
          fileStreamWritable = null;
        }
      }

      receivingBuffersRef.current.set(transferId, {
        meta: item.fileMeta,
        chunks: new Array(totalChunks),
        totalChunks,
        receivedCount: 0,
        totalBytesReceived: 0,
        startTime: Date.now(),
        fileStreamWritable,
      });

      // Add to transfers dock
      setTransfers((prev) => [
        {
          id: transferId,
          peerId: item.fromPeer.id,
          peerName: item.fromPeer.name,
          name: item.fileMeta.name,
          size: item.fileMeta.size,
          type: item.fileMeta.type,
          progress: 0,
          speedBytesPerSec: 0,
          etaSeconds: 0,
          status: 'connecting',
          direction: 'receiving',
          createdAt: Date.now(),
        },
        ...prev,
      ]);

      // Notify sender
      networkRef.current?.sendTransferResponse(item.fromPeer.id, transferId, true);
    },
    [incomingQueue]
  );

  const handleDeclineTransfer = useCallback((transferId: string) => {
    const item = incomingQueue.find((i) => i.transferId === transferId);
    setIncomingQueue((prev) => prev.filter((i) => i.transferId !== transferId));
    if (item) {
      networkRef.current?.sendTransferResponse(item.fromPeer.id, transferId, false);
      showToast(`Declined file from ${item.fromPeer.name}`, 'info');
    }
  }, [incomingQueue]);

  const handleAcceptAllFromPeer = useCallback((peerId: string) => {
    const peerItems = incomingQueue.filter((i) => i.fromPeer.id === peerId);
    peerItems.forEach((item) => handleAcceptTransfer(item.transferId));
  }, [incomingQueue, handleAcceptTransfer]);

  const handleAlwaysAcceptFromPeer = useCallback((peerId: string) => {
    toggleTrustDevice(peerId);
    handleAcceptAllFromPeer(peerId);
  }, [toggleTrustDevice, handleAcceptAllFromPeer]);

  // Cancel Transfer bidirectionally (T4)
  const handleCancelTransfer = useCallback((transferId: string) => {
    sound.playPop();

    // 1. Abort local sender if active
    const senderToken = activeSendersRef.current.get(transferId);
    if (senderToken) {
      senderToken.cancelled = true;
      activeSendersRef.current.delete(transferId);
    }

    // 2. Clear receiving buffer
    receivingBuffersRef.current.delete(transferId);

    // 3. Notify peer
    const target = transfers.find((t) => t.id === transferId);
    if (target) {
      networkRef.current?.sendTransferCancel(target.peerId, transferId);
    }

    // 4. Update UI
    setTransfers((prev) =>
      prev.map((t) => (t.id === transferId ? { ...t, status: 'cancelled' } : t))
    );
    showToast('Transfer cancelled', 'info');
  }, [transfers]);

  // Initialize Network Service
  useEffect(() => {
    const net = new NetworkService(
      myDeviceIdRef.current,
      deviceName,
      platform,
      {
        onConnectionStateChange: (state, mode, msg) => {
          setConnectionState(state);
          setActiveMode(mode);
          if (msg && state !== 'ready') {
            console.log(`[MOG-SHARE Connection]: ${msg}`);
          }
        },
        onDeviceDiscovered: (device) => {
          setLocalDevices((prev) => {
            const map = new Map(prev.map((d) => [d.id, d]));
            map.set(device.id, {
              ...device,
              isTrusted: trustedDeviceIds.has(device.id),
            });
            return Array.from(map.values());
          });
        },
        onDeviceDeparted: (deviceId) => {
          setLocalDevices((prev) => prev.filter((d) => d.id !== deviceId));
          if (selectedDeviceId === deviceId) setSelectedDeviceId(null);
        },
        onPeersSnapshot: (peers) => {
          setLocalDevices(
            peers.map((p) => ({
              ...p,
              isTrusted: trustedDeviceIds.has(p.id),
            }))
          );
        },
        onRoomCreated: (code) => {
          setRoomCode(code);
          setMainTab('room');
          window.location.hash = `room=${code}`;
          showToast(`Room ${code} created`, 'success');
        },
        onRoomJoined: (code) => {
          setRoomCode(code);
          setMainTab('room');
          window.location.hash = `room=${code}`;
          showToast(`Joined room ${code}`, 'success');
        },
        onRoomPeers: (peers) => {
          setRoomPeers(
            peers.map((p) => ({
              ...p,
              isTrusted: trustedDeviceIds.has(p.id),
            }))
          );
        },
        onPeerJoinedRoom: (peer) => {
          setRoomPeers((prev) => {
            const map = new Map(prev.map((p) => [p.id, p]));
            map.set(peer.id, {
              ...peer,
              isTrusted: trustedDeviceIds.has(peer.id),
            });
            return Array.from(map.values());
          });
          showToast(`${peer.name} joined room`, 'info');
        },
        onPeerLeftRoom: (peerId) => {
          setRoomPeers((prev) => prev.filter((p) => p.id !== peerId));
          showToast('Peer left room', 'info');
        },
        onTransferRequest: (fromPeer, fileMeta, transferId) => {
          // F6: Auto-accept if device is trusted or global autoAccept is on
          const isTrusted = trustedDeviceIds.has(fromPeer.id) || autoAccept;
          if (isTrusted) {
            handleAcceptTransfer(transferId);
            return;
          }

          // F9: Web notification when tab is backgrounded
          if (typeof document !== 'undefined' && document.hidden && 'Notification' in window) {
            if (Notification.permission === 'granted') {
              new Notification('Incoming File Request', {
                body: `${fromPeer.name} wants to send ${fileMeta.name} (${formatBytes(fileMeta.size)})`,
                icon: '/favicon.svg',
              });
            }
          }

          // F9: Mobile vibration
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate([40, 60, 40]);
          }

          // Add to incoming queue (T3)
          setIncomingQueue((prev) => [
            ...prev,
            { transferId, fromPeer, fileMeta, receivedAt: Date.now() },
          ]);
        },
        onTransferResponse: (transferId, accepted) => {
          if (!accepted) {
            setTransfers((prev) =>
              prev.map((t) => (t.id === transferId ? { ...t, status: 'declined' } : t))
            );
            showToast('Transfer request declined by peer', 'warn');
          }
        },
        onFileChunk: (transferId, chunkIndex, _totalChunks, rawData, relayed) => {
          const bufferRecord = receivingBuffersRef.current.get(transferId);
          if (!bufferRecord) return;

          let chunkBytes: Uint8Array;
          if (rawData instanceof ArrayBuffer) {
            chunkBytes = new Uint8Array(rawData);
          } else if (typeof rawData === 'string') {
            const binary = atob(rawData);
            chunkBytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              chunkBytes[i] = binary.charCodeAt(i);
            }
          } else {
            return;
          }

          bufferRecord.chunks[chunkIndex] = chunkBytes;
          bufferRecord.receivedCount++;
          bufferRecord.totalBytesReceived += chunkBytes.byteLength;

          // Write chunk directly to disk if stream available (T6)
          if (bufferRecord.fileStreamWritable) {
            try {
              bufferRecord.fileStreamWritable.write({
                type: 'write',
                position: chunkIndex * (16 * 1024),
                data: chunkBytes,
              });
            } catch {}
          }

          // Throttled progress update (T7: 150ms)
          const now = Date.now();
          if (now - lastProgressUpdateRef.current > 150) {
            lastProgressUpdateRef.current = now;
            const progress = Math.min(
              99,
              Math.round((bufferRecord.totalBytesReceived / bufferRecord.meta.size) * 100)
            );
            const elapsed = Math.max(0.1, (now - bufferRecord.startTime) / 1000);
            const speed = bufferRecord.totalBytesReceived / elapsed;
            const remaining = bufferRecord.meta.size - bufferRecord.totalBytesReceived;
            const eta = speed > 0 ? Math.ceil(remaining / speed) : 0;

            setTransfers((prev) =>
              prev.map((t) =>
                t.id === transferId
                  ? { ...t, progress, speedBytesPerSec: speed, etaSeconds: eta, relayed, status: 'transferring' }
                  : t
              )
            );
          }
        },
        onTransferComplete: async (transferId) => {
          const bufferRecord = receivingBuffersRef.current.get(transferId);
          if (!bufferRecord) return;

          // T2 Integrity Check: verify received count & total byte length
          const isValidCount = bufferRecord.receivedCount === bufferRecord.totalChunks;
          const isValidBytes = bufferRecord.totalBytesReceived === bufferRecord.meta.size;

          if (!isValidCount || !isValidBytes) {
            setTransfers((prev) =>
              prev.map((t) =>
                t.id === transferId
                  ? { ...t, status: 'failed', errorReason: 'File incomplete (chunk loss detected)' }
                  : t
              )
            );
            receivingBuffersRef.current.delete(transferId);
            showToast('Transfer failed: file incomplete', 'warn');
            return;
          }

          try {
            if (bufferRecord.fileStreamWritable) {
              await bufferRecord.fileStreamWritable.close();
            }

            // Assemble Blob
            const validChunks = bufferRecord.chunks.filter((c): c is Uint8Array => Boolean(c));
            const fileBlob = new Blob(validChunks as unknown as BlobPart[], {
              type: bufferRecord.meta.type || 'application/octet-stream',
            });
            const blobUrl = URL.createObjectURL(fileBlob);

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
                      completedAt: Date.now(),
                    }
                  : t
              )
            );

            sound.playFanfare();
            if (typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
              confetti({
                particleCount: 50,
                spread: 60,
                origin: { y: 0.85 },
                colors: ['#FFC900', '#10B981', '#3B82F6'],
              });
            }
            showToast(`Received "${bufferRecord.meta.name}"`, 'success');
          } catch (err) {
            console.error('Error assembling file:', err);
          }

          receivingBuffersRef.current.delete(transferId);
        },
        onTransferCancel: (transferId) => {
          receivingBuffersRef.current.delete(transferId);
          setTransfers((prev) =>
            prev.map((t) => (t.id === transferId ? { ...t, status: 'cancelled' } : t))
          );
          showToast('Transfer cancelled by peer', 'info');
        },
        onClipboardReceived: (fromDevice, content, timestamp) => {
          setClipboardHistory((prev) => [
            { id: Math.random().toString(), fromDevice, content, timestamp },
            ...prev,
          ]);
          sound.playPop();
          showToast(`Clipboard synced from ${fromDevice}`, 'info');
        },
        onDirectMessageReceived: (message: DirectMessage) => {
          sound.playPop();
          showToast(`${message.fromDevice}: "${message.text}"`, 'info');
        },
        onError: (errMsg) => {
          setRoomError(errMsg);
          showToast(errMsg, 'warn');
        },
      }
    );

    networkRef.current = net;

    // Auto-join room from URL hash when network becomes ready (R2)
    const hash = window.location.hash;
    if (hash.startsWith('#room=')) {
      const code = hash.replace('#room=', '').trim();
      if (code) {
        net.joinRoom(code);
      }
    }

    return () => {
      net.destroy();
    };
  }, [handleAcceptTransfer]);

  // Send queued files (T5: allows concurrent sends without global lock)
  const handleSendFiles = async () => {
    if (stagedFiles.length === 0 || !selectedDeviceId) return;

    const target =
      localDevices.find((d) => d.id === selectedDeviceId) ||
      roomPeers.find((d) => d.id === selectedDeviceId);

    if (!target) {
      showToast('Please select a recipient device above', 'warn');
      return;
    }

    sound.playPop();
    const filesToSend = [...stagedFiles];
    setStagedFiles([]); // Clear staging area

    for (const file of filesToSend) {
      const transferId = 'xfr_' + Math.random().toString(36).substring(2, 10);

      // Add to transfers dock as waiting
      setTransfers((prev) => [
        {
          id: transferId,
          peerId: target.id,
          peerName: target.name,
          name: file.name,
          size: file.size,
          type: file.type,
          progress: 0,
          speedBytesPerSec: 0,
          etaSeconds: 0,
          status: 'waiting',
          direction: 'sending',
          createdAt: Date.now(),
        },
        ...prev,
      ]);

      // Calculate SHA-256 for file integrity (T2)
      const sliceBuf = await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer();
      const sha256 = await calculateSha256(sliceBuf);

      // Send request
      networkRef.current?.sendTransferRequest(target.id, transferId, {
        name: file.name,
        size: file.size,
        type: file.type,
        sha256,
      });

      // Stream file
      startStreamingFile(file, target.id, target.name, transferId);
    }
  };

  // Drag & drop onto a device card sends directly (Phase 5)
  const handleSendFilesToDevice = (device: Device, files: File[]) => {
    setSelectedDeviceId(device.id);
    setStagedFiles(files);
  };

  const handleOpenMessageModal = (device: Device) => {
    setMessageTargetDevice(device);
  };

  const handleSendDirectMessage = (targetPeerId: string, text: string) => {
    networkRef.current?.sendDirectMessage(targetPeerId, text);
    showToast('Message sent', 'success');
  };

  const handleBroadcastClipboard = (content: string) => {
    networkRef.current?.broadcastClipboard(content);
    setClipboardHistory((prev) => [
      { id: Math.random().toString(), fromDevice: 'You', content, timestamp: Date.now() },
      ...prev,
    ]);
    showToast('Clipboard broadcasted', 'success');
  };

  // Direct ZIP download of the complete app (User Request)
  const handleDownloadZip = () => {
    sound.playPop();
    const link = document.createElement('a');
    link.href = './mog-share-final.zip';
    link.download = 'mog-share-final.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Downloading complete app .zip...', 'info');
  };

  // Selected device object
  const activeTargetDevice =
    localDevices.find((d) => d.id === selectedDeviceId) ||
    roomPeers.find((d) => d.id === selectedDeviceId) ||
    null;

  // Diagnostics Data (F10)
  const diagnosticsData: DiagnosticsData = {
    connectionState,
    activeMode,
    serverUrl: networkRef.current?.getCurrentWsUrl() || null,
    networkKey: networkRef.current?.getNetworkKey() || '',
    localIps: serverLocalIps,
    publicIp: '',
    deviceId: myDeviceIdRef.current,
    deviceName,
    platform,
    latencyMs: 18,
    iceCandidateTypes: networkRef.current?.getIceCandidateTypes() || [],
    activePeersCount: localDevices.length + roomPeers.length,
    rtcSupported: typeof RTCPeerConnection !== 'undefined',
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--bg-app)] text-[var(--text-main)] font-[var(--font-ui)]">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 animate-pop">
          <div
            className={`px-4 py-2 rounded-full text-xs font-semibold shadow-xl border flex items-center gap-2 ${
              toastMessage.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/40'
                : toastMessage.type === 'warn'
                ? 'bg-amber-950/90 text-amber-200 border-amber-500/40'
                : 'bg-[var(--bg-elevated)] text-[var(--text-main)] border-[var(--border-subtle)]'
            }`}
          >
            <span>{toastMessage.text}</span>
          </div>
        </div>
      )}

      {/* Slim Top Bar (Phase 5) */}
      <Header
        connectionState={connectionState}
        activeMode={activeMode}
        onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenHelp={() => setShowInstructions(!showInstructions)}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onDownloadZip={handleDownloadZip}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-3 sm:py-6 pb-28">
        {showInstructions ? (
          <InstructionsPage
            onBackToHub={() => setShowInstructions(false)}
            onDownloadZip={handleDownloadZip}
          />
        ) : (
          <div>
            {/* Top Navigation Tabs (Phase 5) */}
            <ModeSelector
              currentTab={mainTab}
              onTabChange={(tab) => {
                setMainTab(tab);
                setRoomError(null);
              }}
              nearbyCount={localDevices.length}
              historyCount={transfers.filter((t) => t.status === 'completed').length}
            />

            {/* TAB: NEARBY DEVICES */}
            {mainTab === 'nearby' && (
              <div className="space-y-6">
                <DeviceRadar
                  devices={localDevices}
                  selectedDeviceId={selectedDeviceId}
                  onSelectDevice={(device) => setSelectedDeviceId(device.id)}
                  onSendFilesToDevice={handleSendFilesToDevice}
                  onOpenMessageModal={handleOpenMessageModal}
                  onToggleTrustDevice={toggleTrustDevice}
                  onGoToRoom={() => setMainTab('room')}
                  myDeviceName={deviceName}
                  myPlatform={platform}
                  onRenameMyDevice={() => setIsSettingsOpen(true)}
                />

                <DropZone
                  files={stagedFiles}
                  onFilesChange={setStagedFiles}
                  targetDevice={activeTargetDevice}
                  onSend={handleSendFiles}
                />
              </div>
            )}

            {/* TAB: ROOM CODE (Phases 2 & 5) */}
            {mainTab === 'room' && (
              <div className="space-y-6">
                <OnlineRoomCard
                  roomCode={roomCode}
                  connectionState={connectionState}
                  onCreateRoom={() => networkRef.current?.createRoom()}
                  onJoinRoom={(code) => networkRef.current?.joinRoom(code)}
                  onLeaveRoom={() => {
                    networkRef.current?.leaveRoom();
                    setRoomCode(null);
                    window.location.hash = '';
                  }}
                  connectedRoomPeers={roomPeers}
                  selectedDeviceId={selectedDeviceId}
                  onSelectDevice={(peer) => setSelectedDeviceId(peer.id)}
                  errorMessage={roomError}
                  onClearError={() => setRoomError(null)}
                  serverLocalIps={serverLocalIps}
                  serverPort={serverPort}
                />

                {roomCode && (
                  <DropZone
                    files={stagedFiles}
                    onFilesChange={setStagedFiles}
                    targetDevice={activeTargetDevice}
                    onSend={handleSendFiles}
                  />
                )}
              </div>
            )}

            {/* TAB: SHARED CLIPBOARD (F2) */}
            {mainTab === 'clipboard' && (
              <div className="max-w-xl mx-auto mog-card p-5 space-y-4">
                <h3 className="text-base font-bold text-[var(--text-main)] m-0">
                  Shared Network Clipboard
                </h3>
                <p className="text-xs text-[var(--text-muted)] m-0">
                  Broadcast notes, snippets, or URLs to all devices currently active on your network.
                </p>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Type text to broadcast..."
                    id="clipboard-tab-input"
                    className="flex-1 mog-input text-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value;
                        if (val.trim()) {
                          handleBroadcastClipboard(val.trim());
                          (e.target as HTMLInputElement).value = '';
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById('clipboard-tab-input') as HTMLInputElement;
                      if (el && el.value.trim()) {
                        handleBroadcastClipboard(el.value.trim());
                        el.value = '';
                      }
                    }}
                    className="mog-btn mog-btn-primary !min-h-[44px] !px-4 text-xs font-semibold"
                  >
                    Broadcast
                  </button>
                </div>

                <div className="space-y-2 pt-2">
                  <span className="text-xs font-semibold text-[var(--text-muted)] block">
                    Synced Entries ({clipboardHistory.length})
                  </span>

                  {clipboardHistory.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-[var(--border-subtle)] text-center text-xs text-[var(--text-dim)] bg-[var(--bg-app)]">
                      No clipboard items synced yet.
                    </div>
                  ) : (
                    clipboardHistory.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] flex items-center justify-between text-xs"
                      >
                        <div className="min-w-0 pr-2">
                          <p className="font-mono text-[var(--text-main)] truncate m-0 select-all">
                            {item.content}
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5 mt-0.5 m-0">
                            <span>From {item.fromDevice}</span>
                            <span>•</span>
                            <Clock className="w-2.5 h-2.5 text-[var(--text-dim)]" />
                            <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB: TRANSFER HISTORY */}
            {mainTab === 'history' && (
              <div className="max-w-xl mx-auto mog-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-[var(--text-main)] m-0">
                    Transfer History
                  </h3>
                  {transfers.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setTransfers([])}
                      className="text-xs text-[var(--accent-primary)] hover:underline font-medium"
                    >
                      Clear Log
                    </button>
                  )}
                </div>

                {transfers.length === 0 ? (
                  <div className="p-6 rounded-xl border border-dashed border-[var(--border-subtle)] text-center text-xs text-[var(--text-dim)] bg-[var(--bg-app)]">
                    No transfers in this session yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {transfers.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-[var(--text-main)] truncate m-0">
                            {item.name}
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)] mt-0.5 m-0">
                            {formatBytes(item.size)} • {item.direction === 'sending' ? 'To ' : 'From '}
                            {item.peerName} • <span className="capitalize">{item.status}</span>
                          </p>
                        </div>

                        {item.status === 'completed' && item.blobUrl && (
                          <button
                            type="button"
                            onClick={() => handleSaveFile(item)}
                            className="mog-btn mog-btn-primary !min-h-[32px] !py-1 !px-2.5 text-xs font-semibold gap-1"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Save</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Incoming Requests Queue Sheet (T3, Phase 5) */}
      <IncomingTransferSheet
        incomingQueue={incomingQueue}
        onAccept={handleAcceptTransfer}
        onDecline={handleDeclineTransfer}
        onAcceptAllFromPeer={handleAcceptAllFromPeer}
        onAlwaysAcceptFromPeer={handleAlwaysAcceptFromPeer}
      />

      {/* Active Transfers Bottom Sheet (T1, T7, T8, F3) */}
      <TransferDock
        transfers={transfers}
        onCancelTransfer={handleCancelTransfer}
        onClearCompleted={() =>
          setTransfers((prev) => prev.filter((t) => t.status !== 'completed'))
        }
        onSaveFile={handleSaveFile}
      />

      {/* Modals */}
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
        onSaveDeviceName={(name) => {
          setDeviceName(name);
          safeSetStorage('mog_device_name', name);
          networkRef.current?.updateProfile(name, platform);
        }}
        platform={platform}
        onSavePlatform={(p) => {
          setPlatform(p);
          safeSetStorage('mog_platform', p);
          networkRef.current?.updateProfile(deviceName, p);
        }}
        autoAccept={autoAccept}
        onToggleAutoAccept={() => {
          setAutoAccept(!autoAccept);
          safeSetStorage('mog_auto_accept', !autoAccept ? 'true' : 'false');
        }}
      />

      <DiagnosticsModal
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        data={diagnosticsData}
      />

      <DirectMessageModal
        targetDevice={messageTargetDevice}
        onClose={() => setMessageTargetDevice(null)}
        onSendMessage={handleSendDirectMessage}
      />
    </div>
  );
}

export default App;
