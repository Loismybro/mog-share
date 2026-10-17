import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Wifi,
  Globe,
  Upload,
  FolderUp,
  Send,
  Download,
  Check,
  X,
  Copy,
  QrCode,
  MessageSquare,
  History,
  FolderHeart,
  Settings,
  Volume2,
  VolumeX,
  Sparkles,
  ShieldCheck,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  Trash2,
  Eye,
  ArrowRight,
  Radio,
  Zap,
  Layers,
  LogOut,
} from 'lucide-react';
import type {
  ConnState,
  Device,
  IncomingRequest,
  TransferFile,
  ChatMessage,
} from '../types';
import { NetworkService } from '../services/network';
import { RadarScanner } from './RadarScanner';
import { ReceiveModal } from './ReceiveModal';
import { ConnectPcModal } from './ConnectPcModal';
import { FilePreviewModal } from './FilePreviewModal';
import { PersonalSpaceView } from './PersonalSpaceView';
import CipherReach from './CipherReach';
import MorphingGlyphCloud from './MorphingGlyphCloud';
import { soundEffects } from '../utils/soundEffects';
import {
  getPersonalSpaceItems,
  saveToPersonalSpace,
  deleteFromPersonalSpace,
  clearPersonalSpace,
  subscribePersonalSpace,
  type PersonalSpaceItem,
} from '../utils/personalSpace';

const network = new NetworkService();

const GLYPH_PHRASES = [
  'MOGSHARE',
  'ZERO DATA',
  'DIRECT P2P',
  'ENCRYPTED',
];

export function App() {
  // Show the full-screen Welcome Hero on first visit (unless joining via ?room= link)
  const [showStartHero, setShowStartHero] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get('room')) return false;
    return sessionStorage.getItem('mog_entered_app') !== 'true';
  });

  const [activeTab, setActiveTab] = useState<'share' | 'Online' | 'history' | 'vault'>('share');
  const [, setConnState] = useState<ConnState>(network.getState());
  const [peers, setPeers] = useState<Device[]>(network.getPeers());
  const [transfers, setTransfers] = useState<TransferFile[]>(network.getTransfers());
  const [incomingReq, setIncomingReq] = useState<IncomingRequest | null>(
    network.getIncomingRequest(),
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(
    network.getChatMessages(),
  );
  const [roomCode, setRoomCode] = useState<string | null>(network.getRoomCode());
  const [joinRoomInput, setJoinRoomInput] = useState('');
  const [roomCopied, setRoomCopied] = useState(false);

  // Staged files for sending
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Modals & Drawers
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<TransferFile | null>(null);
  const [activeChatPeer, setActiveChatPeer] = useState<Device | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Device Identity & Sound settings
  const [localInfo, setLocalInfo] = useState(network.getLocalInfo());
  const [deviceNameInput, setDeviceNameInput] = useState(localInfo.name);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(soundEffects.isEnabled());
  const [isScanning, setIsScanning] = useState<boolean>(true);

  // Personal Vault
  const [vaultItems, setVaultItems] = useState<PersonalSpaceItem[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getPersonalSpaceItems().then(setVaultItems);
    const unsubVault = subscribePersonalSpace(() => {
      getPersonalSpaceItems().then(setVaultItems);
    });
    return () => unsubVault();
  }, []);

  useEffect(() => {
    const unsub = network.subscribe(() => {
      setConnState(network.getState());
      setPeers([...network.getPeers()]);
      setTransfers([...network.getTransfers()]);
      setIncomingReq(network.getIncomingRequest());
      setChatMessages([...network.getChatMessages()]);
      setRoomCode(network.getRoomCode());
      setLocalInfo(network.getLocalInfo());
    });

    // Check URL for ?room=CODE
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      if (roomParam && roomParam.trim().length >= 4) {
        const clean = roomParam.trim().toUpperCase();
        network.joinRoom(clean);
        setActiveTab('Online');
      }
    }

    return () => {
      unsub();
    };
  }, []);

  const enterWorkspace = () => {
    sessionStorage.setItem('mog_entered_app', 'true');
    setShowStartHero(false);
    network.rescanPeers();
  };

  const formatSize = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTransferSpeed = (t: TransferFile) => {
    if (typeof t.speedBytesPerSec === 'number' && t.speedBytesPerSec > 0) {
      return `${formatSize(t.speedBytesPerSec)}/s`;
    }
    if (typeof t.speed === 'number' && t.speed > 0) {
      return `${formatSize(t.speed)}/s`;
    }
    if (typeof t.speed === 'string' && t.speed) {
      return t.speed;
    }
    return '';
  };

  const stagedTotalBytes = useMemo(
    () => stagedFiles.reduce((acc, f) => acc + f.size, 0),
    [stagedFiles],
  );

  const handleStageFiles = (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    setStagedFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}-${f.size}-${f.lastModified}`));
      const next = [...prev];
      for (const f of arr) {
        const key = `${f.name}-${f.size}-${f.lastModified}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          next.push(f);
        }
      }
      return next;
    });
  };

  const handleRemoveStagedFile = (idx: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSelectPeer = async (peer: Device) => {
    if (stagedFiles.length === 0) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = async () => {
        if (input.files && input.files.length > 0) {
          const picked = Array.from(input.files);
          await network.sendFiles(peer.id, picked);
        }
      };
      input.click();
      return;
    }

    const toSend = [...stagedFiles];
    setStagedFiles([]);
    await network.sendFiles(peer.id, toSend);
  };

  const handleRescan = () => {
    setIsScanning(true);
    network.rescanPeers();
    setTimeout(() => setIsScanning(false), 1800);
  };

  const handleCreateRoom = () => {
    network.createRoom();
  };

  const handleJoinRoom = (codeToJoin?: string) => {
    const code = (codeToJoin ?? joinRoomInput).trim().toUpperCase();
    if (code.length < 4) return;
    network.joinRoom(code);
    setJoinRoomInput('');
  };

  const handleCopyRoomCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setRoomCopied(true);
      setTimeout(() => setRoomCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleDownloadReceivedFile = (t: TransferFile) => {
    const rawBlob = t.fileBlob || t.blob;
    const blobUrl = t.blobUrl || (rawBlob ? URL.createObjectURL(rawBlob) : undefined);
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = t.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChatPeer || !chatInput.trim()) return;
    network.sendChatMessage(activeChatPeer.id, chatInput.trim());
    setChatInput('');
  };

  const handleSaveDeviceName = () => {
    const trimmed = deviceNameInput.trim();
    if (trimmed) {
      network.setDeviceName(trimmed);
      setIsSettingsOpen(false);
    }
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundEffects.setEnabled(next);
  };

  const shareBaseUrl =
    typeof window !== 'undefined'
      ? window.location.origin + window.location.pathname
      : 'http://localhost:3000';

  const getFileIcon = (type: string, name: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-sky-400" />;
    if (type.startsWith('video/')) return <Film className="w-4 h-4 text-indigo-400" />;
    if (type.startsWith('audio/')) return <Music className="w-4 h-4 text-emerald-400" />;
    if (name.endsWith('.zip') || name.endsWith('.rar') || name.endsWith('.7z')) {
      return <Archive className="w-4 h-4 text-amber-400" />;
    }
    return <FileText className="w-4 h-4 text-slate-300" />;
  };

  // =========================================================================
  // FULL-VIEWPORT INTERACTIVE WELCOME / START HERO
  // =========================================================================
  if (showStartHero) {
    return (
      <div className="relative min-h-screen w-full bg-[#07090F] text-[#F3F6FA] overflow-hidden flex flex-col justify-between select-none">
        {/* Full-screen Interactive CipherReach Canvas */}
        <div className="absolute inset-0 z-0 opacity-95">
          <CipherReach
            background="#07090F"
            glyphColor="#E2E8F0"
            accent="#38BDF8"
            accentAmount={35}
            fill={{ seed: 7, density: 100, edgeDensity: 100, fingerDensity: 100 }}
            look={{ glyphSize: 125, squareSize: 72, glow: 25, vignette: 15 }}
            speed={10}
          />
        </div>

        {/* Radial Vignette for high-contrast legibility */}
        <div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 50% 50%, rgba(7,9,15,0.25) 0%, rgba(7,9,15,0.75) 65%, rgba(7,9,15,0.92) 100%)',
          }}
        />

        {/* Top Bar */}
        <header className="relative z-20 w-full max-w-7xl mx-auto px-6 pt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 p-[1px] shadow-lg shadow-sky-500/20">
              <div className="w-full h-full bg-[#07090F] rounded-[11px] flex items-center justify-center">
                <Radio className="w-5 h-5 text-sky-400" />
              </div>
            </div>
            <span className="font-display text-lg font-bold tracking-tight text-white">
              MogShare
            </span>
          </div>

          <button
            onClick={enterWorkspace}
            className="px-4 py-2 rounded-xl mog-glass text-xs font-semibold text-slate-200 hover:text-sky-300 border border-white/10 hover:border-sky-400/30 flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <span>Open App</span>
            <ArrowRight className="w-3.5 h-3.5 text-sky-400" />
          </button>
        </header>

        {/* Center Hero Content */}
        <main className="relative z-20 flex-1 flex flex-col items-center justify-center px-4 text-center max-w-4xl mx-auto my-auto py-8">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full mog-glass border border-sky-400/30 text-xs font-mono text-sky-300 mb-4">
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span>ZERO-DATA LOCAL WI-FI & GLOBAL ENCRYPTED ROOMS</span>
          </div>

          {/* Crisp 60fps MorphingGlyphCloud */}
          <div className="w-full max-w-2xl h-28 sm:h-32 mb-2 pointer-events-auto">
            <MorphingGlyphCloud
              phrases={GLYPH_PHRASES}
              baseColor="#F8FAFC"
              accentColor="#38BDF8"
              background="transparent"
              autoMorphMs={3600}
            />
          </div>

          <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-white max-w-2xl leading-[1.12] mb-4">
            Touchless, high-velocity file beaming across every device.
          </h1>

          <p className="text-sm sm:text-base text-slate-300 max-w-xl mb-8 leading-relaxed">
            Instantly discover nearby Android, iOS, macOS, Windows, and Linux devices on your
            local Wi-Fi with zero mobile data—or bridge across networks with a 6-digit room
            code and SHA-256 block verification.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3.5">
            <button
              onClick={enterWorkspace}
              className="px-7 py-3.5 rounded-2xl mog-btn-primary text-sm font-bold flex items-center gap-2.5 shadow-2xl cursor-pointer"
            >
              <span>Start Sharing</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => {
                enterWorkspace();
                setActiveTab('Online');
                if (!roomCode) handleCreateRoom();
              }}
              className="px-5 py-3.5 rounded-2xl mog-glass hover:bg-white/10 border border-white/15 text-sm font-semibold text-white flex items-center gap-2 transition-all cursor-pointer"
            >
              <Globe className="w-4 h-4 text-sky-400" />
              <span>Create Online Room</span>
            </button>
          </div>
        </main>

        {/* Bottom Feature Strip */}
        <footer className="relative z-20 w-full max-w-5xl mx-auto px-6 pb-6">
          <div className="mog-glass rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400 shrink-0">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-white">Direct WebRTC & LAN Burst</p>
                <p className="text-[11px] text-slate-400">
                  Zero-stall multi-channel streaming with automatic relay fallback
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-400/30 flex items-center justify-center text-indigo-400 shrink-0">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-white">Instant Device Discovery</p>
                <p className="text-[11px] text-slate-400">
                  Interactive 3D nodes represent live nearby & online room peers
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-400 shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-white">SHA-256 Block Integrity</p>
                <p className="text-[11px] text-slate-400">
                  Cryptographic block-by-block verification guarantees zero corruption
                </p>
              </div>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  // =========================================================================
  // MAIN WORKSPACE
  // =========================================================================
  return (
    <div
      className="relative min-h-screen w-full bg-[#07090F] text-[#F3F6FA] flex flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleStageFiles(e.dataTransfer.files);
        }
      }}
    >
      {/* Subtle Ambient CipherReach Background Layer */}
      <div className="fixed inset-0 z-0 opacity-[0.18] pointer-events-none">
        <CipherReach
          background="#07090F"
          glyphColor="#475569"
          accent="#38BDF8"
          accentAmount={25}
          fill={{ seed: 7, density: 85, edgeDensity: 90, fingerDensity: 90 }}
          speed={6}
        />
      </div>

      {/* Drag & Drop Fullscreen Overlay */}
      {isDraggingOver && (
        <div className="fixed inset-0 z-50 bg-sky-950/70 backdrop-blur-md border-2 border-dashed border-sky-400 m-4 rounded-3xl flex flex-col items-center justify-center pointer-events-none">
          <Upload className="w-12 h-12 text-sky-400 mb-3 animate-bounce" />
          <p className="text-xl font-bold text-white">Drop files anywhere to stage for beaming</p>
          <p className="text-xs text-sky-300 mt-1">Supports any file type & size</p>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 w-full mog-glass border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowStartHero(true)}
              className="flex items-center gap-2.5 text-left group cursor-pointer"
              title="Open Welcome Screen"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 p-[1px] shadow-md shadow-sky-500/20 group-hover:scale-105 transition-transform">
                <div className="w-full h-full bg-[#07090F] rounded-[11px] flex items-center justify-center">
                  <Radio className="w-4 h-4 text-sky-400" />
                </div>
              </div>
              <div>
                <span className="font-display text-base font-bold tracking-tight text-white">
                  MogShare
                </span>
                <p className="text-[11px] text-slate-400 hidden sm:block">
                  {localInfo.name} ({localInfo.platform})
                </p>
              </div>
            </button>
          </div>

          {/* Center Navigation Tabs */}
          <nav className="flex items-center gap-1 p-1 rounded-xl bg-black/40 border border-white/10">
            <button
              onClick={() => setActiveTab('share')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'share'
                  ? 'bg-gradient-to-r from-sky-500/25 to-indigo-500/25 text-sky-300 border border-sky-400/35 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Wifi className="w-3.5 h-3.5" />
              <span>Nearby</span>
            </button>

            <button
              onClick={() => setActiveTab('Online')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'Online'
                  ? 'bg-gradient-to-r from-sky-500/25 to-indigo-500/25 text-sky-300 border border-sky-400/35 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Online Room</span>
              {roomCode && (
                <span className="px-1.5 py-0.2 rounded bg-sky-400/20 text-sky-300 font-mono text-[10px]">
                  {roomCode}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-gradient-to-r from-sky-500/25 to-indigo-500/25 text-sky-300 border border-sky-400/35 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Transfers</span>
              {transfers.length > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-white/10 text-slate-200 font-mono text-[10px]">
                  {transfers.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('vault')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'vault'
                  ? 'bg-gradient-to-r from-sky-500/25 to-indigo-500/25 text-sky-300 border border-sky-400/35 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderHeart className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Vault</span>
            </button>
          </nav>

          {/* Right Quick Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsConnectModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Pair Phone or PC via QR / Room Code"
            >
              <QrCode className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden md:inline">Pair Device</span>
            </button>

            <button
              onClick={() => {
                setDeviceNameInput(localInfo.name);
                setIsSettingsOpen(true);
              }}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Device Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {(activeTab === 'share' || activeTab === 'Online') && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT COLUMN (7 cols): 3D Discovery Sphere + Online Room Controls */}
            <div className="lg:col-span-7 space-y-5">
              {(activeTab === 'Online' || roomCode) && (
                <div className="mog-glass rounded-2xl p-5 border border-sky-400/25">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-sky-400 font-semibold mb-1">
                        <Globe className="w-3.5 h-3.5" />
                        <span>Global Encrypted Room Bridge</span>
                      </div>
                      <h2 className="text-base font-bold text-white">
                        Share across different Wi-Fi or mobile networks
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Enter the same 6-character code on any device to connect directly.
                      </p>
                    </div>

                    {roomCode ? (
                      <div className="flex items-center gap-2 bg-black/50 border border-sky-400/35 rounded-xl px-3.5 py-2">
                        <span className="text-lg font-mono font-bold tracking-[0.22em] text-sky-300">
                          {roomCode}
                        </span>
                        <button
                          onClick={handleCopyRoomCode}
                          className="p-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 cursor-pointer"
                          title="Copy Room Code"
                        >
                          {roomCopied ? (
                            <Check className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => network.leaveRoom()}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 cursor-pointer"
                          title="Leave Room"
                        >
                          <LogOut className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={handleCreateRoom}
                          className="px-4 py-2 rounded-xl mog-btn-primary text-xs font-bold cursor-pointer"
                        >
                          Create 6-Digit Room
                        </button>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={joinRoomInput}
                            onChange={(e) => setJoinRoomInput(e.target.value.toUpperCase())}
                            placeholder="ROOM CODE"
                            maxLength={8}
                            className="w-28 px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs font-mono uppercase tracking-widest text-white focus:outline-none focus:border-sky-400"
                          />
                          <button
                            onClick={() => handleJoinRoom()}
                            className="px-3 py-2 rounded-xl mog-btn-secondary text-xs font-semibold text-sky-300 cursor-pointer"
                          >
                            Join
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 3D Radar Scanner */}
              <div className="mog-glass rounded-2xl p-4 sm:p-5">
                <RadarScanner
                  peers={peers}
                  localDevice={localInfo}
                  isScanning={isScanning}
                  onSelectPeer={handleSelectPeer}
                  onChatPeer={(peer) => setActiveChatPeer(peer)}
                  onRescan={handleRescan}
                  selectedFilesCount={stagedFiles.length}
                  selectedTotalSize={
                    stagedFiles.length > 0 ? formatSize(stagedTotalBytes) : undefined
                  }
                />
              </div>
            </div>

            {/* RIGHT COLUMN (5 cols): File Staging Dock + Live Transfer Stream */}
            <div className="lg:col-span-5 space-y-5">
              {/* File Staging Card */}
              <div className="mog-glass rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <Upload className="w-4 h-4 text-sky-400" />
                      <span>File Staging Dock</span>
                    </h2>
                    <p className="text-xs text-slate-400">
                      Stage files or folders, then select any discovered device to send
                    </p>
                  </div>
                  {stagedFiles.length > 0 && (
                    <button
                      onClick={() => setStagedFiles([])}
                      className="text-xs text-slate-400 hover:text-rose-300 font-semibold cursor-pointer"
                    >
                      Clear ({stagedFiles.length})
                    </button>
                  )}
                </div>

                {/* Hidden inputs for files and folders */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleStageFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  // @ts-expect-error webkitdirectory is standard in modern browsers
                  webkitdirectory=""
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleStageFiles(e.target.files);
                    e.target.value = '';
                  }}
                />

                {/* Dropzone Buttons */}
                <div className="grid grid-cols-2 gap-2.5 mb-4">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center p-4 rounded-xl bg-white/[0.03] hover:bg-sky-500/10 border border-dashed border-white/15 hover:border-sky-400/40 transition-all group cursor-pointer"
                  >
                    <Upload className="w-5 h-5 text-sky-400 mb-1.5 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold text-white">Select Files</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">Any format or size</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="flex flex-col items-center justify-center p-4 rounded-xl bg-white/[0.03] hover:bg-indigo-500/10 border border-dashed border-white/15 hover:border-indigo-400/40 transition-all group cursor-pointer"
                  >
                    <FolderUp className="w-5 h-5 text-indigo-400 mb-1.5 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold text-white">Select Folder</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">Batch directory send</span>
                  </button>
                </div>

                {/* Staged Files List */}
                {stagedFiles.length > 0 ? (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {stagedFiles.map((file, idx) => (
                      <div
                        key={`${file.name}-${idx}`}
                        className="flex items-center justify-between gap-2.5 p-2.5 rounded-xl bg-white/[0.04] border border-white/10"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                            {getFileIcon(file.type, file.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-100 truncate">
                              {file.name}
                            </p>
                            <p className="text-[10px] font-mono text-slate-400">
                              {formatSize(file.size)}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveStagedFile(idx)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-white/5 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}

                    {peers.length > 0 && (
                      <div className="pt-2">
                        <p className="text-[11px] font-mono uppercase tracking-wider text-sky-400 mb-2">
                          Send To Discovered Device:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {peers.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => handleSelectPeer(p)}
                              className="px-3 py-2 rounded-xl mog-btn-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>Send to {p.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-4 text-center text-xs text-slate-400">
                    Drag & drop files here, or tap a device directly to pick & send in one step.
                  </div>
                )}
              </div>

              {/* Active & Recent Transfers Stream */}
              <div className="mog-glass rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    <span>Active & Recent Transfers</span>
                  </h3>
                  {transfers.length > 0 && (
                    <button
                      onClick={() => setActiveTab('history')}
                      className="text-xs text-sky-400 hover:underline font-medium cursor-pointer"
                    >
                      View all ({transfers.length})
                    </button>
                  )}
                </div>

                {transfers.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    No transfers in this session yet. Select a file and tap a device to start.
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                    {transfers.slice(0, 6).map((t) => {
                      const isSent = t.direction === 'sending' || t.direction === 'send';
                      const speedStr = formatTransferSpeed(t);
                      const hasBlob = Boolean(t.blobUrl || t.fileBlob || t.blob);
                      return (
                        <div
                          key={t.id}
                          className="p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                                {getFileIcon(t.type, t.name)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-white truncate">{t.name}</p>
                                <p className="text-[10px] font-mono text-slate-400">
                                  {isSent ? '↑ Sent' : '↓ Received'} • {formatSize(t.size)}
                                  {speedStr ? ` • ${speedStr}` : ''}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {t.status === 'completed' && hasBlob && (
                                <>
                                  <button
                                    onClick={() => setPreviewFile(t)}
                                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-sky-300 cursor-pointer"
                                    title="Preview File"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDownloadReceivedFile(t)}
                                    className="px-2.5 py-1 rounded-lg mog-btn-primary text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                  >
                                    <Download className="w-3 h-3" />
                                    <span>Save</span>
                                  </button>
                                </>
                              )}
                              {t.status === 'completed' && (
                                <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono font-semibold">
                                  VERIFIED
                                </span>
                              )}
                              {t.status === 'failed' && (
                                <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] font-mono font-semibold">
                                  FAILED
                                </span>
                              )}
                            </div>
                          </div>

                          {(t.status === 'transferring' ||
                            t.status === 'pending' ||
                            t.status === 'waiting') && (
                            <div>
                              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-sky-400 to-indigo-500 transition-all duration-150"
                                  style={{ width: `${Math.max(4, t.progress)}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-1">
                                <span>{t.progress}%</span>
                                <span>{speedStr || 'Streaming…'}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TRANSFERS HISTORY TAB */}
        {activeTab === 'history' && (
          <div className="mog-glass rounded-2xl p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="text-lg font-bold text-white">Transfer History</h2>
                <p className="text-xs text-slate-400">
                  SHA-256 verified file transfers in this session
                </p>
              </div>
              {transfers.some((t) => t.status === 'completed' || t.status === 'failed') && (
                <button
                  onClick={() => network.clearFinishedTransfers()}
                  className="px-3 py-1.5 rounded-xl mog-btn-secondary text-xs font-semibold text-slate-300 hover:text-rose-300 flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Completed</span>
                </button>
              )}
            </div>

            {transfers.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">
                No file transfers recorded yet.
              </div>
            ) : (
              <div className="space-y-3">
                {transfers.map((t) => {
                  const isSent = t.direction === 'sending' || t.direction === 'send';
                  const hasBlob = Boolean(t.blobUrl || t.fileBlob || t.blob);
                  return (
                    <div
                      key={t.id}
                      className="mog-glass-card rounded-xl p-4 flex flex-wrap items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                          {getFileIcon(t.type, t.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white truncate">{t.name}</p>
                          <p className="text-xs font-mono text-slate-400">
                            {isSent ? 'Sent' : 'Received'} • {formatSize(t.size)} •{' '}
                            {t.status.toUpperCase()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {hasBlob && (
                          <>
                            <button
                              onClick={() => setPreviewFile(t)}
                              className="px-3 py-1.5 rounded-lg mog-btn-secondary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Preview</span>
                            </button>
                            <button
                              onClick={() => handleDownloadReceivedFile(t)}
                              className="px-3.5 py-1.5 rounded-lg mog-btn-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* PERSONAL VAULT TAB */}
        {activeTab === 'vault' && (
          <PersonalSpaceView
            items={vaultItems}
            onAddFiles={async (files) => {
              for (const f of Array.from(files)) {
                await saveToPersonalSpace({
                  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  name: f.name,
                  size: f.size,
                  type: f.type || 'application/octet-stream',
                  senderName: localInfo.name,
                  receivedAt: Date.now(),
                  blob: f,
                });
              }
              const updated = await getPersonalSpaceItems();
              setVaultItems(updated);
            }}
            onRemoveItem={async (id) => {
              await deleteFromPersonalSpace(id);
              const updated = await getPersonalSpaceItems();
              setVaultItems(updated);
            }}
            onClearAll={async () => {
              await clearPersonalSpace();
              setVaultItems([]);
            }}
            onStageItemForShare={async (item) => {
              let blob = item.blob;
              if (!blob && item.blobUrl) {
                const res = await fetch(item.blobUrl);
                blob = await res.blob();
              }
              if (!blob) return;
              const file = new File([blob], item.name, { type: item.type });
              handleStageFiles([file]);
              setActiveTab('share');
            }}
          />
        )}
      </main>

      {/* Incoming Request Approval Modal */}
      <ReceiveModal
        request={incomingReq}
        onAccept={() => network.acceptRequest()}
        onDecline={() => network.declineRequest()}
      />

      {/* Connect / Pair QR & Room Modal */}
      <ConnectPcModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        shareUrl={shareBaseUrl}
        roomCode={roomCode}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={(code) => handleJoinRoom(code)}
      />

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          file={{
            id: previewFile.id,
            name: previewFile.name,
            size: previewFile.size,
            type: previewFile.type,
            blobUrl: previewFile.blobUrl,
            blob: previewFile.fileBlob || previewFile.blob,
          }}
          peers={peers}
          onClose={() => setPreviewFile(null)}
          pushToast={() => undefined}
        />
      )}

      {/* Peer Chat Drawer */}
      {activeChatPeer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md h-full mog-glass border-l border-white/15 flex flex-col justify-between p-5">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <MessageSquare className="w-5 h-5 text-sky-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">{activeChatPeer.name}</h3>
                  <p className="text-[11px] text-slate-400">Direct P2P Instant Messaging</p>
                </div>
              </div>
              <button
                onClick={() => setActiveChatPeer(null)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-2.5">
              {chatMessages.filter(
                (m) => m.senderId === activeChatPeer.id || m.isSelf,
              ).length === 0 ? (
                <p className="text-center text-xs text-slate-500 py-8">
                  Send an encrypted message or link to {activeChatPeer.name}
                </p>
              ) : (
                chatMessages
                  .filter((m) => m.senderId === activeChatPeer.id || m.isSelf)
                  .map((m) => (
                    <div
                      key={m.id}
                      className={`flex flex-col ${m.isSelf ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[82%] px-3.5 py-2 rounded-2xl text-xs ${
                          m.isSelf
                            ? 'bg-sky-500 text-slate-950 font-semibold'
                            : 'bg-white/10 text-slate-100'
                        }`}
                      >
                        {m.text}
                      </div>
                      <span className="text-[10px] text-slate-500 mt-1">
                        {new Date(m.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))
              )}
            </div>

            <form onSubmit={handleSendChat} className="pt-3 border-t border-white/10 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Write a message or paste text…"
                className="flex-1 px-3.5 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl mog-btn-primary text-xs font-bold cursor-pointer"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Device Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl mog-glass border border-white/15 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-sky-400" />
                <span>Device Identity & Preferences</span>
              </h3>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Display Name
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={deviceNameInput}
                  onChange={(e) => setDeviceNameInput(e.target.value)}
                  className="flex-1 px-3.5 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400"
                />
                <button
                  onClick={handleSaveDeviceName}
                  className="px-4 py-2 rounded-xl mog-btn-primary text-xs font-bold cursor-pointer"
                >
                  Save
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-white/[0.04] border border-white/10">
              <div className="flex items-center gap-2.5">
                {soundEnabled ? (
                  <Volume2 className="w-4 h-4 text-sky-400" />
                ) : (
                  <VolumeX className="w-4 h-4 text-slate-400" />
                )}
                <div>
                  <p className="text-xs font-bold text-white">Sound Effects</p>
                  <p className="text-[11px] text-slate-400">
                    Audio chimes enabled by default for discovery & transfers
                  </p>
                </div>
              </div>
              <button
                onClick={handleToggleSound}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  soundEnabled
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                    : 'bg-white/10 text-slate-400'
                }`}
              >
                {soundEnabled ? 'Enabled' : 'Muted'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
