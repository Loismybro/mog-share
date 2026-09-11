import { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { TacticalBackground } from './components/TacticalBackground';
import { Header } from './components/Header';
import { ModeSelector } from './components/ModeSelector';
import { DeviceRadar } from './components/DeviceRadar';
import { OnlineRoomCard } from './components/OnlineRoomCard';
import { DropZone } from './components/DropZone';
import { TransferDock } from './components/TransferDock';
import { ClipboardSyncModal } from './components/ClipboardSyncModal';
import { SettingsModal } from './components/SettingsModal';
import { Device, ShareMode, TransferFile, ClipboardItem, Platform } from './types';
import { sound } from './utils/audio';
import { Download, Check, X, ShieldCheck } from 'lucide-react';
import { formatBytes } from './utils/formatters';

export function App() {
  const [deviceName, setDeviceName] = useState(() => {
    return localStorage.getItem('mog_device_name') || "Alex's MacBook Pro";
  });
  const [platform, setPlatform] = useState<Platform>(() => {
    return (localStorage.getItem('mog_platform') as Platform) || 'macos';
  });
  const [autoAccept, setAutoAccept] = useState(() => {
    return localStorage.getItem('mog_auto_accept') === 'true';
  });
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [mode, setMode] = useState<ShareMode>('local');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const [isClipboardOpen, setIsClipboardOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [transfers, setTransfers] = useState<TransferFile[]>([]);
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardItem[]>([]);

  const [incomingPrompt, setIncomingPrompt] = useState<{
    fromPeer: Device;
    fileMeta: { name: string; size: number; type: string };
    transferId: string;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const myDeviceIdRef = useRef<string>(
    'mog_' + Math.random().toString(36).substring(2, 9)
  );

  const [localDevices, setLocalDevices] = useState<Device[]>([
    {
      id: 'demo-iphone',
      name: "Sarah's iPhone 16 Pro",
      platform: 'ios',
      isLocal: true,
      status: 'online',
    },
    {
      id: 'demo-pixel',
      name: "Sam's Pixel 9 Pro",
      platform: 'android',
      isLocal: true,
      status: 'online',
    },
    {
      id: 'demo-linux',
      name: 'Studio Linux Box',
      platform: 'linux',
      isLocal: true,
      status: 'online',
    },
  ]);

  const [onlineRoomPeers, setOnlineRoomPeers] = useState<Device[]>([]);

  useEffect(() => {
    sound.enabled = soundEnabled;
  }, [soundEnabled]);
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket;

    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'register',
          payload: {
            id: myDeviceIdRef.current,
            name: deviceName,
            platform,
          }
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'device-discovered': {
              const dev = msg.payload.device;
              if (dev.id !== myDeviceIdRef.current) {
                setLocalDevices((prev) => {
                  if (prev.some((d) => d.id === dev.id)) return prev;
                  return [...prev, dev];
                });
              }
              break;
            }

            case 'device-departed': {
              const { deviceId } = msg.payload;
              setLocalDevices((prev) => prev.filter((d) => d.id !== deviceId));
              break;
            }

            case 'room-created': {
              setRoomCode(msg.payload.roomCode);
              break;
            }

            case 'room-joined': {
              setRoomCode(msg.payload.roomCode);
              break;
            }

            case 'peer-joined-room': {
              const { peer } = msg.payload;
              if (peer && peer.id !== myDeviceIdRef.current) {
                setOnlineRoomPeers((prev) => {
                  if (prev.some((p) => p.id === peer.id)) return prev;
                  return [...prev, peer];
                });
                sound.playFanfare();
              }
              break;
            }

            case 'peer-left-room': {
              const { peerId } = msg.payload;
              setOnlineRoomPeers((prev) => prev.filter((p) => p.id !== peerId));
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
              sound.playFanfare();
              break;
            }

            case 'transfer-request': {
              const { fromPeer, fileMeta } = msg.payload;
              const transferId = 'transfer_' + Date.now();

              if (autoAccept) {
                executeSimulatedReceive(fromPeer, fileMeta, transferId);
              } else {
                sound.playFanfare();
                setIncomingPrompt({ fromPeer, fileMeta, transferId });
              }
              break;
            }
          }
        } catch (e) {
          console.error('Error parsing ws event:', e);
        }
      };
    } catch {
      // WS error guard
    }

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [deviceName, platform, autoAccept]);

  // Handle URL hash on load (e.g. #room=482-901)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#room=')) {
      const code = hash.replace('#room=', '');
      if (code) {
        setMode('online');
        setTimeout(() => {
          handleJoinRoom(code);
        }, 400);
      }
    }
  }, []);

  const handleCreateRoom = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'create-room' }));
    } else {
      const part1 = Math.floor(100 + Math.random() * 900);
      const part2 = Math.floor(100 + Math.random() * 900);
      setRoomCode(`${part1}-${part2}`);
    }
  };

  const handleJoinRoom = (code: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'join-room',
        payload: { roomCode: code }
      }));
    } else {
      setRoomCode(code);
      setOnlineRoomPeers([
        {
          id: 'remote-peer-' + Math.random().toString(36).substring(2, 6),
          name: 'Remote Peer Device',
          platform: 'ios',
          isLocal: false,
          status: 'online',
        }
      ]);
    }
  };

  const handleLeaveRoom = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'leave-room' }));
    }
    setRoomCode(null);
    setOnlineRoomPeers([]);
    window.location.hash = '';
  };

  const handleBroadcastClipboard = (content: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'clipboard-broadcast',
        payload: { content }
      }));
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
  };

  const handleSavePlatform = (p: Platform) => {
    setPlatform(p);
    localStorage.setItem('mog_platform', p);
  };

  const handleToggleAutoAccept = () => {
    const next = !autoAccept;
    setAutoAccept(next);
    localStorage.setItem('mog_auto_accept', String(next));
  };

  // Transfer Send Loop
  const handleSendFiles = () => {
    if (stagedFiles.length === 0) return;
    const target = (mode === 'local' ? localDevices : onlineRoomPeers).find(
      (d) => d.id === selectedDeviceId
    );
    if (!target) return;

    sound.playPop();

    stagedFiles.forEach((file) => {
      const transferId = 'tx_' + Math.random().toString(36).substring(2, 9);
      const isLan = mode === 'local';
      // Local: 95-125 MB/s, Online: 20-35 MB/s
      const speed = isLan 
        ? (95 + Math.random() * 30) * 1024 * 1024 
        : (25 + Math.random() * 10) * 1024 * 1024;
      const eta = Math.max(1, Math.round(file.size / speed));

      const newTransfer: TransferFile = {
        id: transferId,
        name: file.name,
        size: file.size,
        type: file.type,
        progress: 0,
        speedBytesPerSec: speed,
        etaSeconds: eta,
        status: 'transferring',
        direction: 'sending',
        peerName: target.name,
        createdAt: Date.now(),
      };

      setTransfers((prev) => [newTransfer, ...prev]);

      let currentProgress = 0;
      const interval = setInterval(() => {
        currentProgress += Math.floor(Math.random() * 14) + 16;
        if (currentProgress >= 100) {
          currentProgress = 100;
          clearInterval(interval);

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
        } else {
          setTransfers((prev) =>
            prev.map((t) =>
              t.id === transferId
                ? {
                    ...t,
                    progress: currentProgress,
                    etaSeconds: Math.max(1, Math.round(((100 - currentProgress) / 100) * eta)),
                  }
                : t
            )
          );
        }
      }, 220);
    });

    setStagedFiles([]);
  };

  const executeSimulatedReceive = (
    peer: Device,
    meta: { name: string; size: number; type: string },
    transferId: string
  ) => {
    const speed = (100 + Math.random() * 20) * 1024 * 1024;
    const eta = Math.max(1, Math.round(meta.size / speed));

    const dummyBlob = new Blob(['MOG-SHARE ultra-speed payload contents'], {
      type: meta.type || 'application/octet-stream',
    });
    const blobUrl = URL.createObjectURL(dummyBlob);

    const newTransfer: TransferFile = {
      id: transferId,
      name: meta.name,
      size: meta.size,
      type: meta.type,
      progress: 0,
      speedBytesPerSec: speed,
      etaSeconds: eta,
      status: 'transferring',
      direction: 'receiving',
      peerName: peer.name,
      blobUrl,
      createdAt: Date.now(),
    };

    setTransfers((prev) => [newTransfer, ...prev]);

    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 15) + 15;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId
              ? { ...t, progress: 100, status: 'completed', speedBytesPerSec: 0, etaSeconds: 0 }
              : t
          )
        );
        sound.playFanfare();
      } else {
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId ? { ...t, progress } : t
          )
        );
      }
    }, 200);
  };

  const handleCancelTransfer = (id: string) => {
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
      {/* Tactical Ambient Geometric Background */}
      <TacticalBackground />

      {/* Main Container */}
      <div>
        <Header
          mode={mode}
          connectedPeersCount={activeDevices.length}
          soundEnabled={soundEnabled}
          onToggleSound={() => setSoundEnabled(!soundEnabled)}
          onOpenClipboard={() => setIsClipboardOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          deviceName={deviceName}
        />

        {/* Local vs Online Neo-Brutalist Switch */}
        <ModeSelector currentMode={mode} onModeChange={setMode} />

        {/* Central Radar or Online Room */}
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
          />
        )}

        {/* Drag & Drop File Zone */}
        <DropZone
          files={stagedFiles}
          onFilesChange={setStagedFiles}
          targetDevice={currentTarget}
          onSend={handleSendFiles}
          isTransferring={isTransferring}
        />
      </div>

      {/* Floating Transfer Dock */}
      <TransferDock
        transfers={transfers}
        onCancelTransfer={handleCancelTransfer}
        onClearCompleted={handleClearCompleted}
      />

      {/* Incoming Transfer Alert */}
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
                onClick={() => {
                  sound.playPop();
                  setIncomingPrompt(null);
                }}
                className="neo-btn neo-btn-dark flex-1 py-3 text-xs font-black uppercase"
              >
                <X className="w-4 h-4 stroke-[3]" />
                <span>Decline</span>
              </button>

              <button
                onClick={() => {
                  sound.playPop();
                  executeSimulatedReceive(
                    incomingPrompt.fromPeer,
                    incomingPrompt.fileMeta,
                    incomingPrompt.transferId
                  );
                  setIncomingPrompt(null);
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

      {/* Universal Clipboard Modal */}
      <ClipboardSyncModal
        isOpen={isClipboardOpen}
        onClose={() => setIsClipboardOpen(false)}
        onBroadcastClipboard={handleBroadcastClipboard}
        receivedItems={clipboardHistory}
      />

      {/* Settings Modal */}
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

      {/* Minimal Tactical Footer */}
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
