import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { zipSync } from 'fflate';
import {
  Archive,
  Check,
  ClipboardList,
  Copy,
  Download,
  History as HistoryIcon,
  Laptop,
  Link2,
  Loader2,
  Lock,
  LogOut,
  MessageSquare,
  MonitorSmartphone,
  RefreshCw,
  Send,
  Settings as SettingsIcon,
  Share2,
  Smartphone,
  Trash2,
  Users,
  Wifi,
  X,
  AlertTriangle,
  HardDrive,
  Eye,
  Image as ImageIcon,
  Music,
  Film,
  FileText,
  Box,
  Folder,
  Radio,
  ArrowUpRight,
  ArrowDownLeft,
  Sparkles,
  Pause,
  Play,
  Cpu,
  BatteryCharging,
  Globe,
  Sun,
  Moon,
  Sunset,
  UploadCloud,
  ExternalLink,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import {
  NetworkService,
  normalizeRoomCode,
  safeGet,
  safeSet,
  supportsStreamSave,
} from '../services/network';
import { ROOM_CODE_LENGTH } from '@shareapp/shared';
import { addHistory, clearHistory, getHistory, type HistoryEntry } from '../utils/history';
import type {
  ClipboardItem,
  ConnState,
  Device,
  IncomingRequest,
  Platform,
  TransferFile,
} from '../types';
import { formatBytes, formatSpeed, formatTime } from '../utils/formatters';
import { haptics } from '../haptics/index.js';
import { DiagnosticsRunner } from '../diagnostics/index.js';
import {
  type PersonalSpaceItem,
  getPersonalSpaceItems,
  saveToPersonalSpace,
  deleteFromPersonalSpace,
  subscribePersonalSpace,
  detectFileCategory,
} from '../utils/personalSpace';
import {
  detectDeviceProfileSync,
  enrichDeviceProfile,
  type DetectedDeviceProfile,
} from '../utils/deviceDetector';
import { PersonalSpaceView } from './PersonalSpaceView';
import { FilePreviewModal, type PreviewableFile } from './FilePreviewModal';
import { RadarScanner } from './RadarScanner';
import { ConnectPcModal } from './ConnectPcModal';
import { ReceiveModal } from './ReceiveModal';

function platformIcon(platform: Platform, size = 20) {
  if (platform === 'ios' || platform === 'android') return <Smartphone size={size} aria-hidden />;
  if (platform === 'web') return <MonitorSmartphone size={size} aria-hidden />;
  return <Laptop size={size} aria-hidden />;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').slice(0, 180) || 'download';
}
const EXEC_RE = /\.(exe|apk|bat|cmd|sh|msi|scr|ps1|jar)$/i;
const BIG_FILE_WARN = 500 * 1024 * 1024;

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  file(cb: (f: File) => void, err?: (e: unknown) => void): void;
  createReader(): { readEntries(cb: (entries: FsEntry[]) => void, err?: (e: unknown) => void): void };
}

async function collectDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items || []);
  const entries: FsEntry[] = [];
  for (const item of items) {
    const getEntry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null })
      .webkitGetAsEntry;
    const entry = typeof getEntry === 'function' ? getEntry.call(item) : null;
    if (entry) entries.push(entry);
  }
  if (!entries.length) return Array.from(dt.files || []);

  const files: File[] = [];
  async function walk(entry: FsEntry): Promise<void> {
    if (entry.isFile) {
      const f = await new Promise<File | null>((res) => entry.file((x) => res(x), () => res(null)));
      if (f) files.push(f);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise<FsEntry[]>((res) =>
          reader.readEntries((e) => res(e), () => res([]))
        );
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  }
  for (const e of entries) await walk(e);
  return files;
}

async function readSharedFiles(): Promise<File[]> {
  try {
    const cache = await caches.open('mog-shared-files');
    const keys = await cache.keys();
    const files: File[] = [];
    for (const req of keys) {
      const res = await cache.match(req);
      if (!res) continue;
      let name = 'shared-file';
      try {
        name = decodeURIComponent(res.headers.get('x-file-name') || '') || 'shared-file';
      } catch {
        /* keep default */
      }
      const type = res.headers.get('content-type') || 'application/octet-stream';
      const blob = await res.blob();
      files.push(new File([blob], name, { type }));
      await cache.delete(req);
    }
    return files;
  } catch {
    return [];
  }
}

interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

type Tab = 'nearby' | 'vault' | 'room' | 'clipboard' | 'history';
type Theme = 'twilight' | 'dark' | 'light' | 'auto';

export default function App() {
  const initialProfile = useMemo(() => detectDeviceProfileSync(), []);
  const [deviceProfile, setDeviceProfile] = useState<DetectedDeviceProfile>(initialProfile);
  const platform = deviceProfile.platform;

  const [deviceName, setDeviceName] = useState<string>(
    () => safeGet('mog_device_name') || initialProfile.suggestedName
  );
  const [lanAddresses, setLanAddresses] = useState<string[]>([]);

  const [connState, setConnState] = useState<ConnState>('connecting');
  const [connDetail, setConnDetail] = useState<string | undefined>();
  const [peers, setPeers] = useState<Device[]>([]);
  const [demoEnabled, setDemoEnabled] = useState<boolean>(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomPeers, setRoomPeers] = useState<Device[]>([]);
  const [roomBusy, setRoomBusy] = useState<'creating' | 'joining' | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomLocked, setRoomLocked] = useState(false);

  const [transfers, setTransfers] = useState<Map<string, TransferFile>>(new Map());
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [clipboardItems, setClipboardItems] = useState<ClipboardItem[]>([]);
  const [autoCopyClipboard, setAutoCopyClipboard] = useState<boolean>(
    () => safeGet('mog_auto_copy_clip') === 'true'
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [vaultItems, setVaultItems] = useState<PersonalSpaceItem[]>([]);
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);
  const [showConnectPc, setShowConnectPc] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);

  const [tab, setTab] = useState<Tab>('nearby');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [bundleAsZip, setBundleAsZip] = useState<boolean>(false);
  const [targetPeer, setTargetPeer] = useState<Device | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [messagePeer, setMessagePeer] = useState<Device | null>(null);
  const [windowDragOver, setWindowDragOver] = useState(false);

  const [serverUrl, setServerUrl] = useState<string>(() => safeGet('mog_server_url') || '');
  const [publicUrl, setPublicUrl] = useState<string>(() => safeGet('mog_public_url') || '');
  const [theme, setTheme] = useState<Theme>(
    () => (safeGet('mog_theme') as Theme) || 'twilight'
  );
  const [autoAccept, setAutoAccept] = useState<string[]>(() => {
    try {
      return JSON.parse(safeGet('mog_auto_accept') || '[]');
    } catch {
      return [];
    }
  });
  const [autoAcceptNearby, setAutoAcceptNearby] = useState<boolean>(() => {
    return safeGet('mog_auto_accept_nearby') !== 'false';
  });

  const netRef = useRef<NetworkService | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const toastId = useRef(0);
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null);
  const autoAcceptRef = useRef(autoAccept);
  const autoAcceptNearbyRef = useRef(autoAcceptNearby);
  const autoCopyClipRef = useRef(autoCopyClipboard);
  const historyRecorded = useRef(new Set<string>());
  const saveTransferRef = useRef<(t: TransferFile) => void>(() => {});
  autoAcceptRef.current = autoAccept;
  autoAcceptNearbyRef.current = autoAcceptNearby;
  autoCopyClipRef.current = autoCopyClipboard;

  const pushToast = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const loadVault = useCallback(async () => {
    try {
      const list = await getPersonalSpaceItems();
      setVaultItems(list);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadVault();
    return subscribePersonalSpace(() => {
      void loadVault();
    });
  }, [loadVault]);

  // Enrich auto-detected hardware profile (Client Hints + Battery) & fetch LAN IP
  useEffect(() => {
    void enrichDeviceProfile(initialProfile).then((enriched) => {
      setDeviceProfile(enriched);
      netRef.current?.updateProfile(deviceName, enriched.platform, enriched);
    });
    fetch('/api/info')
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (info?.lanAddresses && Array.isArray(info.lanAddresses)) {
          setLanAddresses(info.lanAddresses);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme management
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    safeSet('mog_theme', theme);
  }, [theme]);

  // Network bootstrap
  useEffect(() => {
    const net = new NetworkService(
      deviceName,
      platform,
      {
        onStateChange: (s, d) => {
          setConnState(s);
          setConnDetail(d);
        },
        onPeersChanged: setPeers,
        onRoomCreated: (code) => {
          setRoomCode(code);
          setRoomBusy(null);
          setRoomError(null);
          setTab('room');
        },
        onRoomJoined: (code) => {
          setRoomCode(code);
          setRoomBusy(null);
          setRoomError(null);
          setTab('room');
        },
        onRoomLeft: () => {
          setRoomCode(null);
          setRoomPeers([]);
          setRoomBusy(null);
          setRoomLocked(false);
        },
        onRoomPeers: setRoomPeers,
        onRoomError: (msg) => {
          setRoomBusy(null);
          setRoomError(msg);
          setRoomCode(null);
          setRoomPeers([]);
        },
        onIncomingRequest: (req) => {
          if (autoAcceptNearbyRef.current || autoAcceptRef.current.includes(req.fromId)) {
            void netRef.current?.respondToRequest(req, true);
            return;
          }
          setIncoming((q) => [...q, req]);
          notifyHidden(`Incoming file from ${req.fromName}`, req.meta.name);
        },
        onTransferUpdate: (t) => {
          setTransfers((prev) => {
            const next = new Map(prev);
            next.set(t.id, t);
            return next;
          });
          if (
            t.status === 'completed' &&
            t.direction === 'receiving' &&
            (t.blobUrl || t.fileBlob) &&
            autoAcceptNearbyRef.current &&
            !historyRecorded.current.has(t.id + '_autosaved')
          ) {
            historyRecorded.current.add(t.id + '_autosaved');
            saveTransferRef.current(t);
          }
          if (
            t.status === 'completed' &&
            t.direction === 'receiving' &&
            !historyRecorded.current.has(t.id + '_vault')
          ) {
            historyRecorded.current.add(t.id + '_vault');
            void saveToPersonalSpace({
              id: t.id,
              name: t.name,
              size: t.size,
              type: t.type,
              category: detectFileCategory(t.name, t.type),
              senderName: t.peerName,
              senderId: t.peerId,
              receivedAt: Date.now(),
              blob: t.fileBlob,
              blobUrl: t.blobUrl,
              channel: t.channel,
            });
            pushToast('success', `Received ${t.name} — saved in Personal Space Vault`);
          }
          const terminal = ['completed', 'failed', 'declined', 'expired', 'cancelled'];
          if (terminal.includes(t.status) && !historyRecorded.current.has(t.id)) {
            historyRecorded.current.add(t.id);
            if (t.status === 'completed') haptics.play('complete');
            else if (t.status === 'failed') haptics.play('error');
            void addHistory({
              id: t.id,
              name: t.name,
              size: t.size,
              direction: t.direction,
              peerName: t.peerName,
              status: t.status,
              channel: t.channel,
              finishedAt: Date.now(),
            });
          }
        },
        onClipboardReceived: (fromDevice, content, timestamp, meta) => {
          setClipboardItems((items) =>
            [
              {
                id: `${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
                content,
                fromDevice,
                fromId: meta?.fromId,
                isDirect: meta?.isDirect,
                isOutgoing: false,
                timestamp,
              },
              ...items,
            ].slice(0, 60)
          );
          if (autoCopyClipRef.current) {
            void copyText(content);
            pushToast('success', `Message from ${fromDevice} auto-copied to clipboard!`);
          } else {
            pushToast('info', `Message received from ${fromDevice}`);
          }
        },
        onError: (msg) => pushToast('error', msg),
      },
      serverUrl || null,
      initialProfile
    );
    netRef.current = net;

    const code = normalizeRoomCode(window.location.hash);
    if (code.length === ROOM_CODE_LENGTH) {
      setRoomBusy('joining');
      net.joinRoom(code);
    }

    if (window.location.hash.includes('shared')) {
      void readSharedFiles().then((files) => {
        if (files.length) {
          setSelectedFiles((prev) => [...prev, ...files]);
          pushToast(
            'info',
            `${files.length} shared file${files.length > 1 ? 's' : ''} staged for transfer`
          );
        }
      });
    }

    return () => {
      net.destroy();
      netRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === 'history') void getHistory().then(setHistory);
  }, [tab, transfers]);

  useEffect(() => {
    if (peers.length > 0) {
      setShowChecklist(false);
      return;
    }
    const t = setTimeout(() => setShowChecklist(true), 5500);
    return () => clearTimeout(t);
  }, [peers.length, connState]);

  // Global window drag & drop files support
  useEffect(() => {
    let dragDepth = 0;
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
        dragDepth++;
        setWindowDragOver(true);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) setWindowDragOver(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      dragDepth = 0;
      setWindowDragOver(false);
      if (!e.dataTransfer) return;
      e.preventDefault();
      void collectDroppedFiles(e.dataTransfer).then((files) => {
        if (files.length) {
          setSelectedFiles((prev) => [...prev, ...files]);
          setTab('nearby');
          pushToast(
            'success',
            `Staged ${files.length} dropped file${files.length > 1 ? 's' : ''} — tap a peer to send!`
          );
        }
      });
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [pushToast]);

  const hasActive = useMemo(
    () =>
      Array.from(transfers.values()).some(
        (t) =>
          t.status === 'transferring' ||
          t.status === 'in_progress' ||
          t.status === 'connecting' ||
          t.status === 'waiting'
      ),
    [transfers]
  );

  useEffect(() => {
    if (hasActive) {
      try {
        (
          navigator as unknown as {
            wakeLock?: { request(type: string): Promise<{ release(): Promise<void> }> };
          }
        ).wakeLock
          ?.request('screen')
          .then((l) => {
            wakeLockRef.current = l;
          })
          .catch(() => undefined);
      } catch {
        /* unsupported */
      }
      const onUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
      };
      window.addEventListener('beforeunload', onUnload);
      return () => {
        window.removeEventListener('beforeunload', onUnload);
        wakeLockRef.current?.release().catch(() => undefined);
        wakeLockRef.current = null;
      };
    }
  }, [hasActive]);

  function notifyHidden(title: string, body: string) {
    try {
      if (document.visibilityState === 'hidden' && 'Notification' in window) {
        if (Notification.permission === 'granted') new Notification(title, { body });
        else if (Notification.permission === 'default') void Notification.requestPermission();
      }
      haptics.play('incomingRequest');
    } catch {
      /* best effort */
    }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const saveName = (name: string) => {
    const clean = name.trim().slice(0, 44) || deviceProfile.suggestedName;
    setDeviceName(clean);
    safeSet('mog_device_name', clean);
    netRef.current?.updateProfile(clean, platform, deviceProfile);
  };

  const toggleDemoPeer = () => {
    const next = !demoEnabled;
    setDemoEnabled(next);
    netRef.current?.setDemoPeerEnabled(next);
    pushToast(
      'info',
      next
        ? 'Virtual Demo Peer activated! Tap it in Radar to test file transfers & chat.'
        : 'Virtual Demo Peer disabled.'
    );
  };

  const pickFilesFor = (peer: Device) => {
    setTargetPeer(peer);
    fileInputRef.current?.click();
  };

  const prepareFilesForSend = async (
    files: (File | Blob)[],
    customName?: string
  ): Promise<File[]> => {
    const normalized: File[] = files.map((f, i) =>
      f instanceof File
        ? f
        : new File([f], customName || `shared_file_${i + 1}`, {
            type: f.type || 'application/octet-stream',
          })
    );

    if (bundleAsZip && normalized.length > 1) {
      const entries: Record<string, Uint8Array> = {};
      for (const f of normalized) {
        const buf = await f.arrayBuffer();
        const relPath = (f as any).webkitRelativePath || sanitizeFileName(f.name);
        let key = relPath;
        let idx = 1;
        while (entries[key]) key = `${idx++}_${relPath}`;
        entries[key] = new Uint8Array(buf);
      }
      const zipped = zipSync(entries, { level: 0 });
      const copy = new Uint8Array(zipped.length);
      copy.set(zipped);
      const zipFile = new File([copy.buffer], `MogShare-Bundle-${normalized.length}-files.zip`, {
        type: 'application/zip',
      });
      return [zipFile];
    }

    return normalized;
  };

  const startSend = async (peer: Device, files: (File | Blob)[], customName?: string) => {
    if (!files.length) return;
    try {
      const readyFiles = await prepareFilesForSend(files, customName);
      for (const f of readyFiles) {
        void netRef.current?.sendFile(peer, f);
      }
      pushToast(
        'info',
        `Beaming ${readyFiles.length} file${readyFiles.length > 1 ? 's' : ''} to ${peer.name}`
      );
      setSelectedFiles([]);
      setTargetPeer(null);
    } catch {
      pushToast('error', 'Failed to prepare files for transfer');
    }
  };

  const sendStagedToAllPeers = async () => {
    const activeTargets = roomCode ? roomPeers : peers;
    if (!selectedFiles.length || !activeTargets.length) return;
    const readyFiles = await prepareFilesForSend(selectedFiles);
    for (const peer of activeTargets) {
      for (const f of readyFiles) {
        void netRef.current?.sendFile(peer, f);
      }
    }
    pushToast(
      'success',
      `Broadcasting ${readyFiles.length} file${readyFiles.length > 1 ? 's' : ''} to ${activeTargets.length} devices!`
    );
    setSelectedFiles([]);
  };

  const onFilesChosen = (files: FileList | null) => {
    if (!files?.length) return;
    const arr = Array.from(files);
    if (targetPeer) void startSend(targetPeer, arr);
    else setSelectedFiles((prev) => [...prev, ...arr]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) {
        setSelectedFiles((prev) => [...prev, ...files]);
        pushToast(
          'info',
          `${files.length} file${files.length > 1 ? 's' : ''} staged from clipboard`
        );
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [pushToast]);

  const acceptRequest = (req: IncomingRequest, always = false) => {
    if (always) {
      const next = Array.from(new Set([...autoAccept, req.fromId]));
      setAutoAccept(next);
      safeSet('mog_auto_accept', JSON.stringify(next));
    }
    void netRef.current?.respondToRequest(req, true);
    setIncoming((q) => q.filter((r) => r.transferId !== req.transferId));
  };

  const declineRequest = (req: IncomingRequest) => {
    void netRef.current?.respondToRequest(req, false);
    setIncoming((q) => q.filter((r) => r.transferId !== req.transferId));
  };

  const acceptAllFrom = (fromId: string) => {
    const batch = incoming.filter((r) => r.fromId === fromId);
    for (const r of batch) void netRef.current?.respondToRequest(r, true);
    setIncoming((q) => q.filter((r) => r.fromId !== fromId));
  };

  const saveTransfer = (t: TransferFile | PreviewableFile) => {
    let url = t.blobUrl;
    let cleanup = false;
    if (!url && (t as any).fileBlob) {
      url = URL.createObjectURL((t as any).fileBlob);
      cleanup = true;
    } else if (!url && (t as any).blob) {
      url = URL.createObjectURL((t as any).blob);
      cleanup = true;
    }
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFileName(t.name);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (cleanup) {
      setTimeout(() => URL.revokeObjectURL(url!), 10_000);
    }
  };
  saveTransferRef.current = saveTransfer;

  const handleOpenTransfer = (t: TransferFile) => {
    setPreviewFile({
      id: t.id,
      name: t.name,
      size: t.size,
      type: t.type,
      category: detectFileCategory(t.name, t.type),
      blobUrl: t.blobUrl,
      blob: t.fileBlob,
      senderName: t.peerName,
      receivedAt: t.createdAt,
    });
  };

  const saveAllAsZip = async (list: TransferFile[]) => {
    const done = list.filter(
      (t) => t.direction === 'receiving' && t.status === 'completed' && (t.blobUrl || t.fileBlob)
    );
    if (done.length < 2) return;
    try {
      const entries: Record<string, Uint8Array> = {};
      for (const t of done) {
        let buf: ArrayBuffer;
        if (t.fileBlob) {
          buf = await t.fileBlob.arrayBuffer();
        } else if (t.blobUrl) {
          buf = await (await fetch(t.blobUrl)).arrayBuffer();
        } else {
          continue;
        }
        let name = sanitizeFileName(t.name);
        let n = 1;
        while (entries[name]) name = `${n++}-${sanitizeFileName(t.name)}`;
        entries[name] = new Uint8Array(buf);
      }
      const zipped = zipSync(entries, { level: 0 });
      const copy = new Uint8Array(zipped.length);
      copy.set(zipped);
      const blob = new Blob([copy.buffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mog-share-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      pushToast('success', `Zipped ${done.length} files`);
    } catch {
      pushToast('error', 'Could not build the ZIP');
    }
  };

  const clearFinished = () => {
    setTransfers((prev) => {
      const next = new Map<string, TransferFile>();
      for (const [id, t] of prev) {
        if (
          t.status === 'transferring' ||
          t.status === 'in_progress' ||
          t.status === 'connecting' ||
          t.status === 'waiting' ||
          t.status === 'paused'
        ) {
          next.set(id, t);
        } else if (t.blobUrl) {
          URL.revokeObjectURL(t.blobUrl);
        }
      }
      return next;
    });
  };

  const retryTransfer = (t: TransferFile) => {
    if (t.direction !== 'sending') return;
    const peer =
      peers.find((p) => p.id === t.peerId) || roomPeers.find((p) => p.id === t.peerId);
    if (peer && t.fileBlob) {
      void startSend(peer, [t.fileBlob], t.name);
      return;
    }
    pushToast('info', 'Select the file again to retry this transfer.');
    if (peer) pickFilesFor(peer);
  };

  const buildRoomLink = useCallback(
    async (code: string): Promise<string> => {
      let base = publicUrl.trim();
      if (!base) {
        const host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') {
          try {
            const res = await fetch('/api/info');
            const info = await res.json();
            const lan = info?.lanAddresses?.[0];
            if (lan) {
              base = `${window.location.protocol}//${lan}:${window.location.port || '4000'}`;
            }
          } catch {
            /* fall back below */
          }
        }
      }
      if (!base) base = window.location.origin;
      try {
        const url = new URL(base);
        url.hash = `room=${code}`;
        return url.toString();
      } catch {
        return `${window.location.origin}/#room=${code}`;
      }
    },
    [publicUrl]
  );

  const allPeers = roomCode ? roomPeers : peers;
  const transferList = useMemo(
    () => Array.from(transfers.values()).sort((a, b) => b.createdAt - a.createdAt),
    [transfers]
  );

  const cycleTheme = () => {
    const order: Theme[] = ['twilight', 'dark', 'light'];
    const idx = order.indexOf(theme === 'auto' ? 'twilight' : theme);
    const next = order[(idx + 1) % order.length];
    setTheme(next);
  };

  return (
    <div className="dashboard-layout">
      {/* Full-Window Drag-and-Drop Overlay */}
      {windowDragOver && (
        <div className="global-drop-overlay">
          <div className="global-drop-box">
            <UploadCloud size={52} />
            <h2>Drop Files or Folders to Stage</h2>
            <p>Release anywhere to stage for instant P2P transfer</p>
          </div>
        </div>
      )}

      {/* Sleek Slight-Dark Command Rail (Sidebar on Desktop, Header on Mobile) */}
      <aside className="command-rail">
        <div className="rail-top">
          <div className="brand-header">
            <div className="brand">
              <span className="brand-mark" aria-hidden>
                <Zap size={20} />
              </span>
              <div className="brand-text-col">
                <span className="brand-name">MogShare</span>
                <span className="brand-tag mono">P2P QUANTUM HUB 3.0</span>
              </div>
            </div>

            <div className="mobile-top-actions">
              <button
                className="icon-btn rail-icon-btn"
                onClick={cycleTheme}
                title={`Theme: ${theme}. Click to switch`}
                aria-label="Switch color theme"
              >
                {theme === 'dark' ? (
                  <Moon size={17} />
                ) : theme === 'light' ? (
                  <Sun size={17} />
                ) : (
                  <Sunset size={17} />
                )}
              </button>
              <button
                className="icon-btn rail-icon-btn"
                onClick={() => setShowSettings(true)}
                aria-label="Settings"
              >
                <SettingsIcon size={17} />
              </button>
            </div>
          </div>

          {/* Connection Status Pill */}
          <button
            className="conn-status-bar"
            onClick={() => setShowDiagnostics(true)}
            aria-label={`Connection: ${connState}. Open diagnostics`}
          >
            <span className={`conn-dot conn-${connState}`} aria-hidden />
            <span className="conn-label">
              {connState === 'ready'
                ? `Online · ${netRef.current?.getActiveTransportRung() || 'WS'}${
                    netRef.current?.getLatencyMs() ? ` · ${netRef.current?.getLatencyMs()}ms` : ''
                  }`
                : connState === 'reconnecting'
                ? 'Reconnecting signaling…'
                : connState === 'connecting'
                ? connDetail || 'Probing network…'
                : 'Local Bus Active (Offline)'}
            </span>
            <ShieldCheck size={14} className="conn-shield" />
          </button>

          {/* Auto-Detected Device Telemetry Card */}
          <div className="self-telemetry-card">
            <div className="telemetry-top">
              <div className="telemetry-avatar">{platformIcon(platform, 20)}</div>
              <div className="telemetry-info">
                <div className="telemetry-label-row">
                  <span className="telemetry-tag mono">AUTO-DETECTED DEVICE</span>
                  {deviceProfile.batteryLevel != null && (
                    <span className="telemetry-battery mono">
                      {deviceProfile.isCharging && <BatteryCharging size={11} />}
                      {deviceProfile.batteryLevel}%
                    </span>
                  )}
                </div>
                <strong className="telemetry-name" title={deviceName}>
                  {deviceName}
                </strong>
                <span className="telemetry-specs mono">
                  {deviceProfile.model} · {deviceProfile.os} · {deviceProfile.browser}
                </span>
              </div>
            </div>
            <div className="telemetry-meta-bar mono">
              <span>
                <Globe size={11} />{' '}
                {lanAddresses[0] ? `LAN ${lanAddresses[0]}` : deviceProfile.connectionLabel}
              </span>
              <button className="telemetry-rename-btn" onClick={() => setRenaming(true)}>
                Rename
              </button>
            </div>
          </div>

          {/* Primary Navigation */}
          <nav className="rail-nav" aria-label="Main">
            {(
              [
                ['nearby', 'Radar & Hub', <Radio size={19} key="n" />, peers.length],
                ['vault', 'Space Vault', <HardDrive size={19} key="v" />, vaultItems.length],
                ['room', 'Room Bridge', <Users size={19} key="r" />, roomCode ? 1 : 0],
                [
                  'clipboard',
                  'Chat & Clips',
                  <ClipboardList size={19} key="c" />,
                  clipboardItems.length,
                ],
                ['history', 'Activity Log', <HistoryIcon size={19} key="h" />, 0],
              ] as Array<[Tab, string, React.ReactNode, number]>
            ).map(([key, label, icon, badgeCount]) => (
              <button
                key={key}
                className={`rail-nav-btn ${tab === key ? 'active' : ''}`}
                onClick={() => setTab(key)}
                aria-current={tab === key ? 'page' : undefined}
              >
                <span className="rail-nav-icon">{icon}</span>
                <span className="rail-nav-label">{label}</span>
                {key === 'room' && roomCode ? (
                  <span className="rail-pill-badge emerald mono">{roomCode.slice(0, 4)}</span>
                ) : badgeCount > 0 ? (
                  <span className="rail-pill-badge mono">{badgeCount}</span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>

        {/* Bottom Rail Quick Utilities */}
        <div className="rail-footer">
          <button
            className={`rail-util-btn ${demoEnabled ? 'active-demo' : ''}`}
            onClick={toggleDemoPeer}
            title="Spawn a simulated peer to test transfers and chat on this device"
          >
            <Sparkles size={15} />
            <span>{demoEnabled ? 'Demo Peer: Active' : 'Simulate Peer (Test)'}</span>
          </button>

          <button
            className="rail-util-btn"
            onClick={() => setShowConnectPc(true)}
            title="Pair Phone or PC via QR / LAN URL"
          >
            <Laptop size={15} />
            <span>Connect Phone / PC</span>
          </button>

          <div className="rail-footer-row">
            <button
              className="rail-mini-btn"
              onClick={cycleTheme}
              title={`Theme: ${theme} (Bright-to-Slight-Dark Combo)`}
            >
              {theme === 'dark' ? (
                <>
                  <Moon size={14} /> Slight Dark
                </>
              ) : theme === 'light' ? (
                <>
                  <Sun size={14} /> Bright
                </>
              ) : (
                <>
                  <Sunset size={14} /> Twilight Combo
                </>
              )}
            </button>
            <button
              className="rail-mini-btn"
              onClick={() => setShowDiagnostics(true)}
              title="Run network diagnostics"
            >
              <Cpu size={14} /> Diagnostics
            </button>
            <button
              className="rail-mini-btn"
              onClick={() => setShowSettings(true)}
              title="App settings"
            >
              <SettingsIcon size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <main className="workspace-main">
        {tab === 'nearby' && (
          <NearbyView
            peers={peers}
            connState={connState}
            showChecklist={showChecklist}
            selectedFiles={selectedFiles}
            bundleAsZip={bundleAsZip}
            onToggleBundleZip={() => setBundleAsZip((b) => !b)}
            onPickFor={pickFilesFor}
            onDropFiles={(peer, files) => void startSend(peer, files)}
            onSendSelected={(peer) => void startSend(peer, selectedFiles)}
            onSendToAll={() => void sendStagedToAllPeers()}
            onClearSelected={() => setSelectedFiles([])}
            onRemoveSelected={(idx) =>
              setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))
            }
            onAddFiles={() => {
              setTargetPeer(null);
              fileInputRef.current?.click();
            }}
            onAddFolder={() => {
              setTargetPeer(null);
              folderInputRef.current?.click();
            }}
            onAddChosenFiles={(files) => {
              if (targetPeer) void startSend(targetPeer, files);
              else setSelectedFiles((prev) => [...prev, ...files]);
            }}
            onGoRoom={() => setTab('room')}
            onMessage={(peer) => setMessagePeer(peer)}
            deviceName={deviceName}
            deviceProfile={deviceProfile}
            onRename={() => setRenaming(true)}
            autoAcceptNearby={autoAcceptNearby}
            onToggleAutoAccept={() => {
              const next = !autoAcceptNearby;
              setAutoAcceptNearby(next);
              safeSet('mog_auto_accept_nearby', next ? 'true' : 'false');
            }}
            onOpenReceiveMode={() => setShowReceiveModal(true)}
            onOpenConnectPc={() => setShowConnectPc(true)}
            onRescan={() => {
              netRef.current?.rescan();
              pushToast('info', 'Scanning Wi-Fi, Hotspot & Local Tabs for devices…');
            }}
            demoEnabled={demoEnabled}
            onToggleDemo={toggleDemoPeer}
            onSimulateIncoming={() => void netRef.current?.simulateIncomingSampleFile()}
          />
        )}
        {tab === 'vault' && (
          <PersonalSpaceView
            items={vaultItems}
            peers={allPeers}
            onOpenFile={(item) => setPreviewFile(item)}
            onSendToPeer={(peer, blob, name) => void startSend(peer, [blob], name)}
            pushToast={pushToast}
            onRefresh={loadVault}
          />
        )}
        {tab === 'room' && (
          <RoomView
            roomCode={roomCode}
            roomPeers={roomPeers}
            busy={roomBusy}
            error={roomError}
            locked={roomLocked}
            connReady={connState === 'ready'}
            onCreate={() => {
              setRoomError(null);
              setRoomBusy('creating');
              netRef.current?.createRoom();
            }}
            onJoin={(code) => {
              setRoomError(null);
              setRoomBusy('joining');
              netRef.current?.joinRoom(code);
            }}
            onLeave={() => netRef.current?.leaveRoom()}
            onPickFor={pickFilesFor}
            onMessage={(peer) => setMessagePeer(peer)}
            onPassphrase={(p) => {
              void netRef.current?.setRoomPassphrase(p || null);
              setRoomLocked(Boolean(p));
              pushToast(
                'info',
                p ? 'Room relay traffic is now AES-GCM encrypted' : 'Room passphrase cleared'
              );
            }}
            buildRoomLink={buildRoomLink}
            pushToast={pushToast}
            clearBusy={() => setRoomBusy(null)}
          />
        )}
        {tab === 'clipboard' && (
          <ClipboardView
            items={clipboardItems}
            peers={allPeers}
            encrypted={roomLocked}
            autoCopy={autoCopyClipboard}
            onToggleAutoCopy={() => {
              const next = !autoCopyClipboard;
              setAutoCopyClipboard(next);
              safeSet('mog_auto_copy_clip', next ? 'true' : 'false');
            }}
            onBroadcast={(text, targetPeerId) => {
              if (targetPeerId) {
                const target = allPeers.find((p) => p.id === targetPeerId);
                netRef.current?.sendDirectMessage(targetPeerId, text);
                setClipboardItems((prev) => [
                  {
                    id: `${Date.now()}_out`,
                    content: text,
                    fromDevice: 'You',
                    toDevice: target?.name || 'Peer',
                    isOutgoing: true,
                    isDirect: true,
                    timestamp: Date.now(),
                  },
                  ...prev,
                ]);
                pushToast('success', `Direct message sent to ${target?.name || 'peer'}`);
              } else {
                netRef.current?.broadcastClipboard(text);
                setClipboardItems((prev) => [
                  {
                    id: `${Date.now()}_out`,
                    content: text,
                    fromDevice: 'You',
                    toDevice: 'All Connected Devices',
                    isOutgoing: true,
                    isDirect: false,
                    timestamp: Date.now(),
                  },
                  ...prev,
                ]);
                pushToast('success', 'Shared with all connected devices');
              }
            }}
            onClear={() => setClipboardItems([])}
            pushToast={pushToast}
          />
        )}
        {tab === 'history' && (
          <HistoryView
            entries={history}
            onClear={() => {
              void clearHistory().then(() => setHistory([]));
            }}
          />
        )}
      </main>

      {/* Mobile Floating Bottom Navigation */}
      <nav className="mobile-tabbar" aria-label="Mobile Navigation">
        {(
          [
            ['nearby', 'Radar', <Radio size={19} key="i" />],
            ['vault', 'Vault', <HardDrive size={19} key="i" />],
            ['room', 'Room', <Users size={19} key="i" />],
            ['clipboard', 'Chat', <ClipboardList size={19} key="i" />],
            ['history', 'Log', <HistoryIcon size={19} key="i" />],
          ] as Array<[Tab, string, React.ReactNode]>
        ).map(([key, label, icon]) => (
          <button
            key={key}
            className={`mobile-tab-btn ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
          >
            {icon}
            <span>{label}</span>
            {key === 'room' && roomCode && <span className="tab-badge" aria-hidden />}
            {key === 'vault' && vaultItems.length > 0 && (
              <span className="tab-count-badge">{vaultItems.length}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Hidden inputs for files and folders */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => onFilesChosen(e.target.files)}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is standard in modern browsers
        webkitdirectory=""
        directory=""
        hidden
        onChange={(e) => onFilesChosen(e.target.files)}
      />

      {/* Live Transfer Drawer */}
      {transferList.length > 0 && (
        <TransferSheet
          transfers={transferList}
          onCancel={(id) => netRef.current?.cancelTransfer(id)}
          onPause={(id) => netRef.current?.pauseTransfer(id)}
          onResume={(id) => netRef.current?.resumeTransfer(id)}
          onOpen={handleOpenTransfer}
          onSave={saveTransfer}
          onSaveAllZip={() => void saveAllAsZip(transferList)}
          onRetry={retryTransfer}
          onClear={clearFinished}
        />
      )}

      {/* Incoming Request Sheet */}
      {incoming.length > 0 && (
        <IncomingSheet
          queue={incoming}
          onAccept={acceptRequest}
          onDecline={declineRequest}
          onAcceptAll={acceptAllFrom}
        />
      )}

      {/* Modals */}
      {showSettings && (
        <SettingsModal
          deviceName={deviceName}
          serverUrl={serverUrl}
          publicUrl={publicUrl}
          theme={theme}
          autoAcceptCount={autoAccept.length}
          autoAcceptNearby={autoAcceptNearby}
          onClose={() => setShowSettings(false)}
          onSave={(name, server, pub, th, autoNearby) => {
            saveName(name);
            setServerUrl(server);
            safeSet('mog_server_url', server);
            setPublicUrl(pub);
            safeSet('mog_public_url', pub);
            setTheme(th);
            setAutoAcceptNearby(autoNearby);
            safeSet('mog_auto_accept_nearby', autoNearby ? 'true' : 'false');
            netRef.current?.setCustomServerUrl(server || null);
            setShowSettings(false);
          }}
          onClearTrusted={() => {
            setAutoAccept([]);
            safeSet('mog_auto_accept', '[]');
          }}
        />
      )}
      {showDiagnostics && (
        <DiagnosticsModal
          connState={connState}
          serverUrl={netRef.current?.getActiveUrl() || '—'}
          deviceId={netRef.current?.getDeviceId() || '—'}
          latencyMs={netRef.current?.getLatencyMs() ?? null}
          roomCode={roomCode}
          peerCount={peers.length}
          deviceProfile={deviceProfile}
          onClose={() => setShowDiagnostics(false)}
          pushToast={pushToast}
        />
      )}
      {renaming && (
        <RenameModal
          current={deviceName}
          suggested={deviceProfile.suggestedName}
          onClose={() => setRenaming(false)}
          onSave={(n) => {
            saveName(n);
            setRenaming(false);
          }}
        />
      )}
      {messagePeer && (
        <MessageModal
          peer={messagePeer}
          onClose={() => setMessagePeer(null)}
          onSend={(text) => {
            netRef.current?.sendDirectMessage(messagePeer.id, text);
            setClipboardItems((prev) => [
              {
                id: `${Date.now()}_dm`,
                content: text,
                fromDevice: 'You',
                toDevice: messagePeer.name,
                isOutgoing: true,
                isDirect: true,
                timestamp: Date.now(),
              },
              ...prev,
            ]);
            pushToast('success', `Direct message sent to ${messagePeer.name}`);
            setMessagePeer(null);
          }}
        />
      )}
      {showConnectPc && (
        <ConnectPcModal
          onClose={() => setShowConnectPc(false)}
          publicUrl={publicUrl}
          roomCode={roomCode}
          pushToast={pushToast}
        />
      )}
      {showReceiveModal && (
        <ReceiveModal
          onClose={() => setShowReceiveModal(false)}
          deviceName={deviceName}
          roomCode={roomCode}
          publicUrl={publicUrl}
          autoAcceptNearby={autoAcceptNearby}
          onToggleAutoAccept={() => {
            const next = !autoAcceptNearby;
            setAutoAcceptNearby(next);
            safeSet('mog_auto_accept_nearby', next ? 'true' : 'false');
          }}
          onGoVault={() => setTab('vault')}
          onSimulateIncoming={() => void netRef.current?.simulateIncomingSampleFile()}
          buildRoomLink={buildRoomLink}
          pushToast={pushToast}
        />
      )}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          peers={allPeers}
          onClose={() => setPreviewFile(null)}
          onSave={saveTransfer}
          onDelete={async (id) => {
            await deleteFromPersonalSpace(id);
            await loadVault();
            setPreviewFile(null);
            pushToast('info', 'File removed from Personal Space Vault');
          }}
          onSendToPeer={(peer, blob, name) => void startSend(peer, [blob], name)}
          pushToast={pushToast}
        />
      )}

      {/* Toasts */}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nearby Hub View
// ---------------------------------------------------------------------------
function NearbyView(props: {
  peers: Device[];
  connState: ConnState;
  showChecklist: boolean;
  selectedFiles: File[];
  bundleAsZip: boolean;
  onToggleBundleZip: () => void;
  onPickFor: (peer: Device) => void;
  onDropFiles: (peer: Device, files: File[]) => void;
  onSendSelected: (peer: Device) => void;
  onSendToAll: () => void;
  onClearSelected: () => void;
  onRemoveSelected: (index: number) => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onAddChosenFiles: (files: File[]) => void;
  onGoRoom: () => void;
  onMessage: (peer: Device) => void;
  deviceName: string;
  deviceProfile: DetectedDeviceProfile;
  onRename: () => void;
  autoAcceptNearby: boolean;
  onToggleAutoAccept: () => void;
  onOpenReceiveMode: () => void;
  onOpenConnectPc: () => void;
  onRescan: () => void;
  demoEnabled: boolean;
  onToggleDemo: () => void;
  onSimulateIncoming: () => void;
}) {
  const { peers, selectedFiles } = props;
  const [dragOver, setDragOver] = useState<string | null>(null);
  const totalSize = selectedFiles.reduce((s, f) => s + f.size, 0);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const apkInputRef = useRef<HTMLInputElement>(null);

  const previews = useMemo(
    () =>
      selectedFiles.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)),
    [selectedFiles]
  );
  useEffect(
    () => () => {
      previews.forEach((u) => {
        if (u) URL.revokeObjectURL(u);
      });
    },
    [previews]
  );

  return (
    <div className="view">
      {/* Top Workspace Header */}
      <div className="section-header-row">
        <div>
          <h1 className="view-title">Cross-Platform Transfer Hub</h1>
          <p className="view-sub">
            Zero-install P2P file beaming with auto-device detection across Android, iOS, Windows, Mac & Linux.
          </p>
        </div>
        <div className="header-pill-controls">
          <button
            className={`btn btn-sm ${props.autoAcceptNearby ? 'btn-emerald' : 'btn-secondary'}`}
            onClick={props.onToggleAutoAccept}
          >
            <Zap size={14} />
            <span>{props.autoAcceptNearby ? 'AirDrop Auto-Accept: ON' : 'Auto-Accept: OFF'}</span>
          </button>
          <button className="btn btn-sm btn-secondary" onClick={props.onOpenConnectPc}>
            <Laptop size={14} /> Pair Phone / PC
          </button>
        </div>
      </div>

      {/* Dual Hero Action Cards (Send & Receive) */}
      <div className="hero-actions-grid">
        <button
          className="hero-action-card hero-send"
          onClick={props.onAddFiles}
          title="Select files to beam via P2P DataChannel"
        >
          <div className="hero-action-icon">
            <ArrowUpRight size={28} />
          </div>
          <div className="hero-action-content">
            <span className="hero-action-kicker mono">OUTBOUND STREAM</span>
            <span className="hero-action-title">Send Files</span>
            <span className="hero-action-desc">
              Photos, Videos, Music, APKs, Documents or Whole Folders
            </span>
          </div>
        </button>

        <button
          className="hero-action-card hero-receive"
          onClick={props.onOpenReceiveMode}
          title="Open QR & Sonar Receive Beacon"
        >
          <div className="hero-action-icon">
            <ArrowDownLeft size={28} />
          </div>
          <div className="hero-action-content">
            <span className="hero-action-kicker mono">INBOUND BEACON</span>
            <span className="hero-action-title">Receive Files</span>
            <span className="hero-action-desc">
              Show QR Code, Room PIN, or test incoming stream
            </span>
          </div>
        </button>
      </div>

      {/* Quick Category File Pickers */}
      <div className="category-strip-card">
        <div className="category-strip-head">
          <span className="field-label" style={{ margin: 0 }}>
            QUICK MEDIA & FOLDER PICKERS
          </span>
          <span className="muted small">Or drag & drop files anywhere on screen</span>
        </div>
        <div className="send-cat-grid">
          <button
            className="send-cat-btn cat-photos"
            onClick={() => photoInputRef.current?.click()}
          >
            <ImageIcon size={19} />
            <span>Photos</span>
          </button>
          <button
            className="send-cat-btn cat-videos"
            onClick={() => videoInputRef.current?.click()}
          >
            <Film size={19} />
            <span>Videos</span>
          </button>
          <button
            className="send-cat-btn cat-music"
            onClick={() => musicInputRef.current?.click()}
          >
            <Music size={19} />
            <span>Audio</span>
          </button>
          <button className="send-cat-btn cat-docs" onClick={() => docInputRef.current?.click()}>
            <FileText size={19} />
            <span>Docs</span>
          </button>
          <button className="send-cat-btn cat-apps" onClick={() => apkInputRef.current?.click()}>
            <Box size={19} />
            <span>APKs</span>
          </button>
          <button className="send-cat-btn cat-folder" onClick={props.onAddFolder}>
            <Folder size={19} />
            <span>Folder</span>
          </button>
          <button className="send-cat-btn cat-all" onClick={props.onAddFiles}>
            <UploadCloud size={19} />
            <span>All Files</span>
          </button>
        </div>
      </div>

      {/* Hidden inputs for categories */}
      <input
        ref={photoInputRef}
        type="file"
        multiple
        accept="image/*"
        hidden
        onChange={(e) => {
          if (e.target.files) {
            props.onAddChosenFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />
      <input
        ref={musicInputRef}
        type="file"
        multiple
        accept="audio/*"
        hidden
        onChange={(e) => {
          if (e.target.files) {
            props.onAddChosenFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        multiple
        accept="video/*"
        hidden
        onChange={(e) => {
          if (e.target.files) {
            props.onAddChosenFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />
      <input
        ref={docInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.md"
        hidden
        onChange={(e) => {
          if (e.target.files) {
            props.onAddChosenFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />
      <input
        ref={apkInputRef}
        type="file"
        multiple
        accept=".apk,.xapk,.zip,.bin,.tar,.gz"
        hidden
        onChange={(e) => {
          if (e.target.files) {
            props.onAddChosenFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />

      {/* Staged Files Dock */}
      {selectedFiles.length > 0 && (
        <div className="staged-dock-card">
          <div className="staged-dock-top">
            <div className="staged-dock-info">
              <span className="badge badge-indigo">
                {selectedFiles.length} FILE{selectedFiles.length > 1 ? 'S' : ''} STAGED
              </span>
              <span className="mono font-bold">{formatBytes(totalSize)}</span>
              {selectedFiles.length > 1 && (
                <label className="zip-bundle-toggle">
                  <input
                    type="checkbox"
                    checked={props.bundleAsZip}
                    onChange={props.onToggleBundleZip}
                  />
                  <span>Bundle as single .ZIP</span>
                </label>
              )}
            </div>
            <div className="staged-dock-actions">
              {peers.length > 0 && (
                <button className="btn btn-xs btn-primary" onClick={props.onSendToAll}>
                  <Send size={13} /> Send to All ({peers.length})
                </button>
              )}
              <button
                className="btn btn-xs btn-secondary"
                onClick={props.onAddFiles}
                title="Add more files"
              >
                + Add More
              </button>
              <button
                className="icon-btn"
                onClick={props.onClearSelected}
                aria-label="Clear staged files"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="thumb-row">
            {selectedFiles.slice(0, 14).map((f, i) => (
              <button
                key={`${f.name}-${i}`}
                className="thumb"
                title={`${f.name} (${formatBytes(f.size)}) — tap to remove`}
                onClick={() => props.onRemoveSelected(i)}
              >
                {previews[i] ? (
                  <img src={previews[i]!} alt={f.name} />
                ) : (
                  <span className="thumb-ext mono">
                    {(f.name.split('.').pop() || 'file').slice(0, 4)}
                  </span>
                )}
                <span className="thumb-name">{f.name}</span>
              </button>
            ))}
            {selectedFiles.length > 14 && (
              <span className="muted small font-bold">+{selectedFiles.length - 14} more</span>
            )}
          </div>
        </div>
      )}

      {/* Futuristic Slight-Dark Radar Console */}
      <RadarScanner
        deviceName={props.deviceName}
        deviceSubtitle={`${props.deviceProfile.model} · ${props.deviceProfile.os}`}
        peers={peers}
        isScanning={props.connState === 'ready'}
        hasStagedFiles={selectedFiles.length > 0}
        demoEnabled={props.demoEnabled}
        onToggleDemo={props.onToggleDemo}
        onSimulateIncoming={props.onSimulateIncoming}
        onRescan={props.onRescan}
        onSelectPeer={(p) =>
          selectedFiles.length ? props.onSendSelected(p) : props.onPickFor(p)
        }
        onMessagePeer={(p) => props.onMessage(p)}
      />

      {/* Discovered Devices Grid */}
      <div className="discovered-section">
        <div className="section-header-row" style={{ marginBottom: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            Discovered Nearby Devices ({peers.length})
          </h2>
          <div className="flex items-center gap-2">
            <button className="btn btn-xs btn-secondary" onClick={props.onRescan}>
              <RefreshCw size={12} /> Refresh Scan
            </button>
            <button className="btn btn-xs btn-secondary" onClick={props.onGoRoom}>
              <Users size={12} /> Use Room Code
            </button>
          </div>
        </div>

        {peers.length === 0 ? (
          <div className="card empty-peers-card">
            <div className="empty-peers-top">
              <div className="pulse-ring" aria-hidden>
                <Wifi size={24} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: 16 }}>
                  {props.connState === 'ready'
                    ? 'Listening for devices on Wi-Fi, Hotspot & Browser Tabs…'
                    : 'Connecting to local discovery bus…'}
                </h3>
                <p className="muted small" style={{ margin: 0 }}>
                  Open MogShare on another phone/PC on the same Wi-Fi, open a second browser tab, or spawn a simulated peer below to test immediately.
                </p>
              </div>
            </div>

            <div className="empty-peers-actions">
              <button className="btn btn-sm btn-primary" onClick={props.onToggleDemo}>
                <Sparkles size={15} /> Spawn Simulated Peer (Test Now)
              </button>
              <button className="btn btn-sm btn-secondary" onClick={props.onOpenConnectPc}>
                <Laptop size={15} /> Show QR / WebShare URL
              </button>
              <button className="btn btn-sm btn-secondary" onClick={props.onGoRoom}>
                <Link2 size={15} /> Connect via 8-Char Room Code
              </button>
            </div>

            {props.showChecklist && (
              <div className="troubleshooting-box">
                <strong>Quick Connectivity Tips:</strong>
                <ul>
                  <li>
                    Ensure both devices are on the same Wi-Fi or mobile hotspot, or open a second tab on this computer.
                  </li>
                  <li>
                    If guest Wi-Fi / AP isolation or VPN is active, use <strong>Room Bridge</strong> to connect across any network.
                  </li>
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="device-grid">
            {peers.map((p) => (
              <div
                key={p.id}
                className={`card device-card ${dragOver === p.id ? 'drag-over' : ''} ${
                  p.isSimulated ? 'device-simulated' : ''
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(p.id);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  void collectDroppedFiles(e.dataTransfer).then((files) => {
                    if (files.length) props.onDropFiles(p, files);
                  });
                }}
              >
                <button
                  className="device-main"
                  onClick={() =>
                    selectedFiles.length ? props.onSendSelected(p) : props.onPickFor(p)
                  }
                >
                  <span className="device-avatar">{platformIcon(p.platform, 22)}</span>
                  <span className="device-info">
                    <span className="device-name-row">
                      <span className="device-name">{p.name}</span>
                      {p.isSimulated && <span className="badge badge-cyan">DEMO</span>}
                    </span>
                    <span className="device-specs mono">
                      {p.model || p.os || p.platform}
                      {p.browser ? ` · ${p.browser}` : ''}
                      {p.rttMs != null ? ` · ${p.rttMs}ms` : ''}
                      {p.batteryLevel != null ? ` · 🔋${p.batteryLevel}%` : ''}
                    </span>
                    <span className="device-hint">
                      {selectedFiles.length
                        ? `⚡ Tap to beam ${selectedFiles.length} staged file${
                            selectedFiles.length > 1 ? 's' : ''
                          }`
                        : `${p.connType || 'Direct P2P'} · Tap to send or drop files`}
                    </span>
                  </span>
                </button>
                <div className="device-card-actions">
                  <button
                    className="btn btn-xs btn-primary"
                    onClick={() =>
                      selectedFiles.length ? props.onSendSelected(p) : props.onPickFor(p)
                    }
                  >
                    <Send size={13} /> Send
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => props.onMessage(p)}
                    aria-label={`Send message to ${p.name}`}
                    title={`Message ${p.name}`}
                  >
                    <MessageSquare size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Room Bridge View
// ---------------------------------------------------------------------------
function RoomView(props: {
  roomCode: string | null;
  roomPeers: Device[];
  busy: 'creating' | 'joining' | null;
  error: string | null;
  locked: boolean;
  connReady: boolean;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onLeave: () => void;
  onPickFor: (peer: Device) => void;
  onMessage: (peer: Device) => void;
  onPassphrase: (passphrase: string) => void;
  buildRoomLink: (code: string) => Promise<string>;
  pushToast: (k: Toast['kind'], m: string) => void;
  clearBusy: () => void;
}) {
  const [input, setInput] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [passInput, setPassInput] = useState('');
  const [showPass, setShowPass] = useState(false);
  const joinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (props.roomCode) {
      void props.buildRoomLink(props.roomCode).then((l) => {
        setLink(l);
        QRCode.toDataURL(l, {
          width: 220,
          margin: 1,
          color: { dark: '#0f172a', light: '#ffffff' },
        })
          .then(setQr)
          .catch(() => setQr(null));
      });
    } else {
      setQr(null);
      setLink('');
    }
  }, [props.roomCode, props.buildRoomLink]);

  useEffect(() => {
    if (props.busy === 'joining') {
      joinTimer.current = setTimeout(() => {
        props.clearBusy();
        props.pushToast('error', 'Room not found or expired.');
      }, 6000);
      return () => {
        if (joinTimer.current) clearTimeout(joinTimer.current);
      };
    }
  }, [props.busy, props]);

  const handleInput = (raw: string) => {
    const code = normalizeRoomCode(raw);
    setInput(code);
    if (code.length === ROOM_CODE_LENGTH) props.onJoin(code);
  };

  if (props.roomCode) {
    return (
      <div className="view">
        <div className="section-header-row">
          <div>
            <h1 className="view-title">
              Active Room Bridge {props.locked && <Lock size={18} aria-label="Encrypted" />}
            </h1>
            <p className="view-sub">
              Cross-network P2P & encrypted relay tunnel — share this 8-character code or QR with any device.
            </p>
          </div>
          <button className="btn btn-sm btn-danger" onClick={props.onLeave}>
            <LogOut size={15} /> Leave Room
          </button>
        </div>

        <div className="card room-active-card">
          <div className="room-code-display">
            <span className="field-label" style={{ marginTop: 0 }}>
              ROOM ACCESS CODE
            </span>
            <div
              className="code-boxes"
              aria-label={`Room code ${props.roomCode.split('').join(' ')}`}
            >
              {props.roomCode.split('').map((d, i) => (
                <span key={i} className="code-digit mono">
                  {d}
                </span>
              ))}
            </div>

            <div className="room-actions">
              <button
                className="btn btn-sm btn-primary"
                onClick={async () => {
                  const ok = await copyText(props.roomCode!);
                  props.pushToast(ok ? 'success' : 'error', ok ? 'Room code copied!' : 'Copy failed');
                }}
              >
                <Copy size={15} /> Copy Code
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={async () => {
                  const ok = await copyText(link);
                  props.pushToast(ok ? 'success' : 'error', ok ? 'Invite link copied!' : 'Copy failed');
                }}
              >
                <Link2 size={15} /> Copy Invite Link
              </button>
              {typeof navigator.share === 'function' && (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() =>
                    navigator
                      .share({ title: 'Join my MogShare Room', url: link })
                      .catch(() => undefined)
                  }
                >
                  <Share2 size={15} /> Share
                </button>
              )}
            </div>

            {showPass ? (
              <div className="pass-row">
                <input
                  className="input"
                  type="password"
                  placeholder="Shared E2E passphrase (same on all devices)"
                  value={passInput}
                  onChange={(e) => setPassInput(e.target.value)}
                />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    props.onPassphrase(passInput);
                    setShowPass(false);
                  }}
                >
                  Apply
                </button>
              </div>
            ) : (
              <button className="btn btn-xs btn-secondary" onClick={() => setShowPass(true)}>
                <Lock size={13} />{' '}
                {props.locked
                  ? 'Change Room Passphrase'
                  : 'Add Optional E2E Passphrase'}
              </button>
            )}
          </div>

          {qr && (
            <div className="qr-wrap">
              <img
                src={qr}
                alt={`QR code to join room ${props.roomCode}`}
                width={176}
                height={176}
              />
              <span className="muted small mono">Scan to Join Room</span>
            </div>
          )}
        </div>

        <h2 className="section-title">Connected Room Peers ({props.roomPeers.length})</h2>
        {props.roomPeers.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              Waiting for peers to join Room <strong>{props.roomCode}</strong>. Open another tab or device and enter the code above!
            </p>
          </div>
        ) : (
          <div className="device-grid">
            {props.roomPeers.map((p) => (
              <div key={p.id} className="card device-card">
                <button
                  className="device-main"
                  onClick={() => props.onPickFor(p)}
                  aria-label={`Send files to ${p.name}`}
                >
                  <span className="device-avatar">{platformIcon(p.platform, 22)}</span>
                  <span className="device-info">
                    <span className="device-name">{p.name}</span>
                    <span className="device-specs mono">
                      {p.model || p.os || p.platform} · Room Peer
                    </span>
                    <span className="device-hint">Tap to pick & send files</span>
                  </span>
                </button>
                <div className="device-card-actions">
                  <button className="btn btn-xs btn-primary" onClick={() => props.onPickFor(p)}>
                    <Send size={13} /> Send
                  </button>
                  <button className="icon-btn" onClick={() => props.onMessage(p)}>
                    <MessageSquare size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="view">
      <div>
        <h1 className="view-title">Cross-Network Room Bridge</h1>
        <p className="view-sub">
          Pair devices across different Wi-Fi networks, 5G mobile data, or strict corporate firewalls using an 8-character code.
        </p>
      </div>

      <div className="room-split-grid">
        <div className="card room-create-panel">
          <span className="badge badge-indigo">HOST INSTANT ROOM</span>
          <h3>Create a New Room</h3>
          <p className="muted small">
            Generates a secure 8-character room code and QR invitation link valid for up to 8 peers.
          </p>
          <button
            className="btn btn-lg btn-primary"
            onClick={props.onCreate}
            disabled={!props.connReady || props.busy === 'creating'}
          >
            {props.busy === 'creating' ? (
              <>
                <Loader2 size={18} className="spin" /> Creating Room…
              </>
            ) : (
              <>
                <Sparkles size={18} /> Create 8-Char Room
              </>
            )}
          </button>
          {!props.connReady && (
            <p className="muted small">
              Waiting for signaling server connection to create cross-network rooms…
            </p>
          )}
        </div>

        <div className="card room-join-panel">
          <span className="badge badge-cyan">JOIN EXISTING ROOM</span>
          <h3>Enter Room Code</h3>
          <div className="join-row">
            <input
              id="room-code-input"
              className="input mono code-input"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              placeholder="ABCD2345"
              maxLength={ROOM_CODE_LENGTH}
              value={input}
              onChange={(e) => handleInput(e.target.value)}
              onPaste={(e) => {
                e.preventDefault();
                handleInput(e.clipboardData.getData('text'));
              }}
              disabled={!props.connReady || props.busy === 'joining'}
            />
            <button
              className="btn btn-primary"
              disabled={
                input.length !== ROOM_CODE_LENGTH || !props.connReady || props.busy === 'joining'
              }
              onClick={() => props.onJoin(input)}
            >
              {props.busy === 'joining' ? <Loader2 size={18} className="spin" /> : 'Join'}
            </button>
          </div>
          {props.error && (
            <p className="error-text" role="alert">
              {props.error}
            </p>
          )}

          {/* Quick Alphanumeric Keypad */}
          <div className="modern-keypad">
            {['2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D'].map((char) => (
              <button
                key={char}
                type="button"
                className="keypad-btn mono"
                onClick={() => handleInput(input + char)}
                disabled={input.length >= ROOM_CODE_LENGTH || !props.connReady}
              >
                {char}
              </button>
            ))}
            <button
              type="button"
              className="keypad-btn keypad-action"
              onClick={() => handleInput('')}
              disabled={!input || !props.connReady}
            >
              CLEAR
            </button>
            <button
              type="button"
              className="keypad-btn mono"
              onClick={() => handleInput(input + 'E')}
              disabled={input.length >= ROOM_CODE_LENGTH || !props.connReady}
            >
              E
            </button>
            <button
              type="button"
              className="keypad-btn keypad-action"
              onClick={() => handleInput(input.slice(0, -1))}
              disabled={!input || !props.connReady}
            >
              ⌫
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Chat & Shared Clipboard View
// ---------------------------------------------------------------------------
function ClipboardView(props: {
  items: ClipboardItem[];
  peers: Device[];
  encrypted: boolean;
  autoCopy: boolean;
  onToggleAutoCopy: () => void;
  onBroadcast: (text: string, targetPeerId?: string) => void;
  onClear: () => void;
  pushToast: (k: Toast['kind'], m: string) => void;
}) {
  const [text, setText] = useState('');
  const [targetId, setTargetId] = useState<string>('');

  const handlePasteFromSystem = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) setText((prev) => (prev ? `${prev}\n${clip}` : clip));
      else props.pushToast('info', 'Clipboard is empty');
    } catch {
      props.pushToast('error', 'Browser blocked clipboard read — press Ctrl+V / Cmd+V in the box');
    }
  };

  const isUrl = (str: string) => /^https?:\/\/\S+$/i.test(str.trim());

  return (
    <div className="view">
      <div className="section-header-row">
        <div>
          <h1 className="view-title">Live P2P Chat & Shared Clipboard</h1>
          <p className="view-sub">
            Beam text, URLs, or code snippets to all nearby devices or directly to a specific peer.
            {props.encrypted && (
              <>
                {' '}
                <Lock size={13} aria-hidden /> E2E Encrypted.
              </>
            )}
          </p>
        </div>
        <button
          className={`btn btn-sm ${props.autoCopy ? 'btn-emerald' : 'btn-secondary'}`}
          onClick={props.onToggleAutoCopy}
        >
          <Copy size={14} />
          <span>{props.autoCopy ? 'Auto-Copy Incoming: ON' : 'Auto-Copy Incoming: OFF'}</span>
        </button>
      </div>

      <div className="card chat-composer-card">
        <div className="chat-composer-top">
          <div className="recipient-select-wrap">
            <span className="field-label" style={{ margin: 0 }}>
              RECIPIENT:
            </span>
            <select
              className="select-modern"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">All Connected Devices ({props.peers.length})</option>
              {props.peers.map((p) => (
                <option key={p.id} value={p.id}>
                  Direct: {p.name} ({p.model || p.platform})
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-xs btn-secondary" onClick={handlePasteFromSystem}>
            <ClipboardList size={13} /> Paste Clipboard
          </button>
        </div>

        <textarea
          className="input textarea mono"
          rows={3}
          placeholder="Type a message, paste a URL, or drop a code snippet… (Ctrl+Enter to send)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && text.trim()) {
              e.preventDefault();
              props.onBroadcast(text.trim(), targetId || undefined);
              setText('');
            }
          }}
        />

        <div className="chat-composer-actions">
          <span className="muted small">
            {props.peers.length > 0
              ? `Ready to beam to ${targetId ? 'selected peer' : `${props.peers.length} device(s)`}`
              : 'Tip: Enable "Simulate Peer" in the sidebar to test live chat loopback!'}
          </span>
          <button
            className="btn btn-primary"
            disabled={!text.trim()}
            onClick={() => {
              props.onBroadcast(text.trim(), targetId || undefined);
              setText('');
            }}
          >
            <Send size={15} /> {targetId ? 'Send Direct Message' : 'Broadcast to All'}
          </button>
        </div>
      </div>

      <div className="section-header-row">
        <h2 className="section-title" style={{ margin: 0 }}>
          Message & Snippet Timeline ({props.items.length})
        </h2>
        {props.items.length > 0 && (
          <button className="btn btn-xs btn-secondary" onClick={props.onClear}>
            <Trash2 size={13} /> Clear Feed
          </button>
        )}
      </div>

      {props.items.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No messages or snippets yet. Send a link or code snippet above!
          </p>
        </div>
      ) : (
        <div className="clip-list">
          {props.items.map((item) => (
            <div
              key={item.id}
              className={`card clip-item ${item.isOutgoing ? 'clip-outgoing' : 'clip-incoming'}`}
            >
              <div className="clip-meta">
                <div className="flex items-center gap-2">
                  <strong>{item.fromDevice}</strong>
                  {item.toDevice && <span className="muted small">→ {item.toDevice}</span>}
                  {item.isDirect && <span className="badge badge-cyan">DIRECT</span>}
                </div>
                <span className="muted small mono">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <pre className="clip-content mono">{item.content}</pre>
              <div className="clip-actions">
                <button
                  className="btn btn-xs btn-secondary"
                  onClick={async () => {
                    const ok = await copyText(item.content);
                    props.pushToast(ok ? 'success' : 'error', ok ? 'Copied to clipboard' : 'Copy failed');
                  }}
                >
                  <Copy size={13} /> Copy
                </button>
                {isUrl(item.content) && (
                  <a
                    href={item.content.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-xs btn-primary"
                  >
                    <ExternalLink size={13} /> Open Link
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity & Analytics View
// ---------------------------------------------------------------------------
function HistoryView(props: { entries: HistoryEntry[]; onClear: () => void }) {
  const stats = useMemo(() => {
    let totalBytes = 0;
    let completed = 0;
    let sent = 0;
    let received = 0;
    for (const e of props.entries) {
      if (e.status === 'completed') {
        totalBytes += e.size || 0;
        completed++;
      }
      if (e.direction === 'sending') sent++;
      else received++;
    }
    return { totalBytes, completed, sent, received };
  }, [props.entries]);

  return (
    <div className="view">
      <div className="section-header-row">
        <div>
          <h1 className="view-title">Transfer Activity & Analytics</h1>
          <p className="view-sub">
            Complete audit log of outbound and inbound P2P transfers stored locally on this device.
          </p>
        </div>
        {props.entries.length > 0 && (
          <button className="btn btn-sm btn-danger" onClick={props.onClear}>
            <Trash2 size={14} /> Clear History
          </button>
        )}
      </div>

      {/* Analytics KPI Strip */}
      <div className="kpi-grid">
        <div className="card kpi-card">
          <span className="field-label" style={{ marginTop: 0 }}>
            TOTAL VOLUME SHARED
          </span>
          <strong className="kpi-val mono">{formatBytes(stats.totalBytes)}</strong>
        </div>
        <div className="card kpi-card">
          <span className="field-label" style={{ marginTop: 0 }}>
            COMPLETED TRANSFERS
          </span>
          <strong className="kpi-val mono">{stats.completed}</strong>
        </div>
        <div className="card kpi-card">
          <span className="field-label" style={{ marginTop: 0 }}>
            SENT / RECEIVED
          </span>
          <strong className="kpi-val mono">
            {stats.sent} ↑ / {stats.received} ↓
          </strong>
        </div>
      </div>

      {props.entries.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No transfer history recorded yet.
          </p>
        </div>
      ) : (
        <div className="clip-list">
          {props.entries.map((e) => (
            <div key={e.id} className="card history-item">
              <div className="history-row">
                <span className="transfer-name font-bold" title={e.name}>
                  {e.name}
                </span>
                <span className={`badge badge-${e.status}`}>{e.status.toUpperCase()}</span>
              </div>
              <p className="muted small mono" style={{ margin: '4px 0 0 0' }}>
                {e.direction === 'sending' ? '↑ Sent to' : '↓ Received from'} {e.peerName} ·{' '}
                {formatBytes(e.size)}
                {e.channel ? ` · ${e.channel === 'direct' ? 'Direct P2P' : 'Encrypted Relay'}` : ''}
                {' · '}
                {new Date(e.finishedAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Transfer Bottom Sheet / Drawer
// ---------------------------------------------------------------------------
function TransferSheet(props: {
  transfers: TransferFile[];
  onCancel: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onOpen: (t: TransferFile) => void;
  onSave: (t: TransferFile) => void;
  onSaveAllZip: () => void;
  onRetry: (t: TransferFile) => void;
  onClear: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const active = props.transfers.filter(
    (t) =>
      t.status === 'transferring' ||
      t.status === 'in_progress' ||
      t.status === 'connecting' ||
      t.status === 'waiting' ||
      t.status === 'paused'
  );
  const completedReceives = props.transfers.filter(
    (t) => t.direction === 'receiving' && t.status === 'completed' && (t.blobUrl || t.fileBlob)
  );

  return (
    <div className={`sheet transfer-sheet ${collapsed ? 'collapsed' : ''}`}>
      <button
        className="sheet-handle"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <span className="flex items-center gap-2">
          <Zap size={15} />
          {active.length
            ? `${active.length} Active Transfer${active.length > 1 ? 's' : ''}`
            : `Transfers (${props.transfers.length})`}
        </span>
        <span className="mono small">{collapsed ? 'Expand ▲' : 'Minimize ▼'}</span>
      </button>
      {!collapsed && (
        <div className="sheet-body">
          {props.transfers.map((t) => {
            const isRunning =
              t.status === 'transferring' ||
              t.status === 'in_progress' ||
              t.status === 'connecting';
            const isPaused = t.status === 'paused';
            return (
              <div
                key={t.id}
                className="transfer-row"
                style={{
                  cursor:
                    t.status === 'completed' && (t.blobUrl || t.fileBlob) ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (t.status === 'completed' && (t.blobUrl || t.fileBlob)) {
                    props.onOpen(t);
                  }
                }}
              >
                <div className="transfer-top">
                  <span className="transfer-name-wrap">
                    {t.blobUrl && t.type.startsWith('image/') && (
                      <img
                        className="transfer-thumb"
                        src={t.blobUrl}
                        alt=""
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onOpen(t);
                        }}
                      />
                    )}
                    <span className="transfer-name font-bold" title={t.name}>
                      {t.name}
                    </span>
                  </span>
                  <span className="transfer-badges">
                    {t.channel && (
                      <span
                        className={`badge ${
                          t.channel === 'direct' ? 'badge-emerald' : 'badge-indigo'
                        }`}
                      >
                        {t.channel === 'direct' ? 'Direct P2P' : 'Relay'}
                      </span>
                    )}
                    <span className={`badge badge-${t.status}`}>{statusLabel(t)}</span>
                  </span>
                </div>

                <div className="transfer-meta muted mono">
                  {t.direction === 'sending' ? `↑ ${t.peerName}` : `↓ ${t.peerName}`} ·{' '}
                  {t.bytesTransferred != null && isRunning
                    ? `${formatBytes(t.bytesTransferred)} / ${formatBytes(t.size)}`
                    : formatBytes(t.size)}
                  {isRunning &&
                    t.speedBytesPerSec > 0 &&
                    ` · ${formatSpeed(t.speedBytesPerSec)} · ${formatTime(t.etaSeconds)} ETA`}
                  {t.savedToDisk && ' · streamed to disk'}
                </div>

                {(isRunning || isPaused || t.status === 'waiting') && (
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-valuenow={Math.round(t.progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.max(2, t.progress)}%` }}
                    />
                  </div>
                )}

                {t.error && <p className="error-text">{t.error}</p>}
                {EXEC_RE.test(t.name) &&
                  t.direction === 'receiving' &&
                  t.status === 'completed' && (
                    <p className="warn-text">
                      <AlertTriangle size={13} /> Executable file — verify sender before running.
                    </p>
                  )}

                <div className="transfer-actions" onClick={(e) => e.stopPropagation()}>
                  {t.status === 'completed' && (t.blobUrl || t.fileBlob) && (
                    <button
                      className="btn btn-xs btn-primary"
                      onClick={() => props.onOpen(t)}
                      title="Preview file"
                    >
                      <Eye size={13} /> Open
                    </button>
                  )}
                  {t.status === 'completed' &&
                    t.direction === 'receiving' &&
                    (t.blobUrl || t.fileBlob) && (
                      <button
                        className="btn btn-xs btn-secondary"
                        onClick={() => props.onSave(t)}
                      >
                        <Download size={13} /> Save
                      </button>
                    )}
                  {isRunning && t.direction === 'sending' && (
                    <button
                      className="btn btn-xs btn-secondary"
                      onClick={() => props.onPause(t.id)}
                    >
                      <Pause size={13} /> Pause
                    </button>
                  )}
                  {isPaused && t.direction === 'sending' && (
                    <button
                      className="btn btn-xs btn-primary"
                      onClick={() => props.onResume(t.id)}
                    >
                      <Play size={13} /> Resume
                    </button>
                  )}
                  {(isRunning || isPaused || t.status === 'waiting') && (
                    <button
                      className="btn btn-xs btn-danger"
                      onClick={() => props.onCancel(t.id)}
                    >
                      <X size={13} /> Cancel
                    </button>
                  )}
                  {(t.status === 'failed' || t.status === 'expired') &&
                    t.direction === 'sending' && (
                      <button
                        className="btn btn-xs btn-secondary"
                        onClick={() => props.onRetry(t)}
                      >
                        <RefreshCw size={13} /> Retry
                      </button>
                    )}
                </div>
              </div>
            );
          })}

          <div className="transfer-sheet-footer">
            {completedReceives.length >= 2 && (
              <button className="btn btn-xs btn-primary" onClick={props.onSaveAllZip}>
                <Archive size={13} /> Save All ({completedReceives.length}) as ZIP
              </button>
            )}
            <button className="btn btn-xs btn-secondary" onClick={props.onClear}>
              Clear Finished
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function statusLabel(t: TransferFile): string {
  switch (t.status) {
    case 'waiting':
    case 'pending':
      return 'Waiting…';
    case 'connecting':
      return 'Connecting…';
    case 'transferring':
    case 'in_progress':
      return `${Math.round(t.progress || 0)}%`;
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'declined':
      return 'Declined';
    case 'expired':
      return 'Expired';
    case 'cancelled':
      return 'Cancelled';
    default:
      return String(t.status);
  }
}

// ---------------------------------------------------------------------------
// Incoming Request Sheet
// ---------------------------------------------------------------------------
function IncomingSheet(props: {
  queue: IncomingRequest[];
  onAccept: (r: IncomingRequest, always?: boolean) => void;
  onDecline: (r: IncomingRequest) => void;
  onAcceptAll: (fromId: string) => void;
}) {
  const bySender = new Map<string, IncomingRequest[]>();
  for (const r of props.queue) {
    bySender.set(r.fromId, [...(bySender.get(r.fromId) || []), r]);
  }
  return (
    <div className="sheet incoming-sheet" role="dialog" aria-label="Incoming files">
      <div className="sheet-body">
        {Array.from(bySender.entries()).map(([fromId, reqs]) => {
          const hasHuge = reqs.some((r) => r.meta.size > BIG_FILE_WARN);
          return (
            <div key={fromId} className="incoming-group">
              <p className="incoming-title">
                <strong>{reqs[0].fromName}</strong> wants to beam{' '}
                {reqs.length > 1 ? `${reqs.length} files` : 'a file'}
                {reqs[0].sasEmoji && (
                  <span className="mono small" style={{ marginLeft: 8 }}>
                    SAS: {reqs[0].sasEmoji}
                  </span>
                )}
              </p>
              {reqs.slice(0, 3).map((r) => (
                <p key={r.transferId} className="muted mono incoming-file">
                  {r.meta.name} · {formatBytes(r.meta.size)}
                  {EXEC_RE.test(r.meta.name) && (
                    <span className="warn-text">
                      {' '}
                      <AlertTriangle size={12} /> executable
                    </span>
                  )}
                </p>
              ))}
              {reqs.length > 3 && <p className="muted">…and {reqs.length - 3} more</p>}
              {hasHuge && !supportsStreamSave() && (
                <p className="warn-text">
                  <AlertTriangle size={13} /> Large file (&gt;500 MB) — use Chrome/Edge for direct-to-disk streaming.
                </p>
              )}
              <div className="incoming-actions">
                {reqs.length > 1 ? (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => props.onAcceptAll(fromId)}
                  >
                    <Check size={14} /> Accept All ({reqs.length})
                  </button>
                ) : (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => props.onAccept(reqs[0])}
                  >
                    <Check size={14} /> Accept
                  </button>
                )}
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => props.onAccept(reqs[0], true)}
                >
                  Always Trust Device
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => reqs.forEach(props.onDecline)}
                >
                  Decline
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function Modal(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function SettingsModal(props: {
  deviceName: string;
  serverUrl: string;
  publicUrl: string;
  theme: Theme;
  autoAcceptCount: number;
  autoAcceptNearby: boolean;
  onClose: () => void;
  onSave: (
    name: string,
    serverUrl: string,
    publicUrl: string,
    theme: Theme,
    autoAcceptNearby: boolean
  ) => void;
  onClearTrusted: () => void;
}) {
  const [name, setName] = useState(props.deviceName);
  const [server, setServer] = useState(props.serverUrl);
  const [pub, setPub] = useState(props.publicUrl);
  const [th, setTh] = useState<Theme>(props.theme);
  const [autoNearby, setAutoNearby] = useState(props.autoAcceptNearby);

  return (
    <Modal title="Preferences & Configuration" onClose={props.onClose}>
      <label className="field-label" htmlFor="set-name">
        Device Display Name
      </label>
      <input
        id="set-name"
        className="input"
        value={name}
        maxLength={44}
        onChange={(e) => setName(e.target.value)}
      />

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={autoNearby}
          onChange={(e) => setAutoNearby(e.target.checked)}
        />
        <span>Auto-accept incoming transfers on same network (AirDrop mode)</span>
      </label>

      <label className="field-label">Color Theme</label>
      <div className="theme-selector-grid" role="radiogroup" aria-label="Theme">
        {(
          [
            ['twilight', 'Twilight Combo (Bright + Slight Dark)'],
            ['dark', 'Slight Dark Nebula'],
            ['light', 'Bright Pearl'],
            ['auto', 'System Auto'],
          ] as Array<[Theme, string]>
        ).map(([opt, label]) => (
          <button
            key={opt}
            role="radio"
            aria-checked={th === opt}
            className={`btn btn-sm ${th === opt ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTh(opt)}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="field-label" htmlFor="set-server">
        Custom Signaling Server URL (optional)
      </label>
      <input
        id="set-server"
        className="input"
        placeholder="https://your-signaling-server.onrender.com"
        value={server}
        onChange={(e) => setServer(e.target.value)}
      />
      <p className="muted small">
        Leave empty to automatically use the built-in local/single-origin server.
      </p>

      <label className="field-label" htmlFor="set-public">
        Public URL for QR Codes (optional)
      </label>
      <input
        id="set-public"
        className="input"
        placeholder="https://mogshare.example.com"
        value={pub}
        onChange={(e) => setPub(e.target.value)}
      />

      {props.autoAcceptCount > 0 && (
        <button className="btn btn-xs btn-secondary" onClick={props.onClearTrusted}>
          Forget {props.autoAcceptCount} trusted device{props.autoAcceptCount > 1 ? 's' : ''}
        </button>
      )}

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={() => props.onSave(name, server.trim(), pub.trim(), th, autoNearby)}
        >
          Save Preferences
        </button>
      </div>
    </Modal>
  );
}

function DiagnosticsModal(props: {
  connState: ConnState;
  serverUrl: string;
  deviceId: string;
  latencyMs: number | null;
  roomCode: string | null;
  peerCount: number;
  deviceProfile: DetectedDeviceProfile;
  onClose: () => void;
  pushToast: (k: Toast['kind'], m: string) => void;
}) {
  const [fullReport, setFullReport] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const initialReport = [
    `connection_state : ${props.connState}`,
    `signaling_server : ${props.serverUrl}`,
    `round_trip_time  : ${props.latencyMs != null ? `${props.latencyMs} ms` : 'measuring…'}`,
    `device_id        : ${props.deviceId}`,
    `detected_hardware: ${props.deviceProfile.model} (${props.deviceProfile.os} · ${props.deviceProfile.browser})`,
    `active_room      : ${props.roomCode || 'none'}`,
    `discovered_peers : ${props.peerCount}`,
    `disk_stream_fsa  : ${supportsStreamSave() ? 'supported' : 'opfs/memory fallback'}`,
    `origin           : ${window.location.href}`,
  ].join('\n');

  const handleRunFullDiagnostics = async () => {
    setRunning(true);
    try {
      const runner = new DiagnosticsRunner(props.serverUrl);
      const res = await runner.runFullDiagnostics();
      setFullReport(runner.formatReportAsText(res));
      props.pushToast('success', 'Network diagnostics completed');
    } catch {
      props.pushToast('error', 'Diagnostics failed');
    } finally {
      setRunning(false);
    }
  };

  const displayText = fullReport || initialReport;

  return (
    <Modal title="System & Network Diagnostics" onClose={props.onClose}>
      <pre className="diag mono">{displayText}</pre>
      <div className="modal-actions">
        <button
          className="btn btn-sm btn-secondary"
          disabled={running}
          onClick={handleRunFullDiagnostics}
        >
          {running ? 'Probing STUN / TURN / IP…' : 'Run Deep Network Probe'}
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={async () => {
            const ok = await copyText(displayText);
            props.pushToast(ok ? 'success' : 'error', ok ? 'Diagnostics copied' : 'Copy failed');
          }}
        >
          <Copy size={14} /> Copy Report
        </button>
      </div>
    </Modal>
  );
}

function RenameModal(props: {
  current: string;
  suggested: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(props.current);
  return (
    <Modal title="Rename This Device" onClose={props.onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        This name is broadcast to nearby devices on your Wi-Fi, hotspot, and active rooms.
      </p>
      <input
        className="input"
        value={name}
        maxLength={44}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) props.onSave(name);
        }}
      />
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={() => setName(props.suggested)}>
          Reset to Auto-Detected
        </button>
        <button className="btn btn-primary" onClick={() => props.onSave(name)}>
          Save Name
        </button>
      </div>
    </Modal>
  );
}

function MessageModal(props: {
  peer: Device;
  onClose: () => void;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  return (
    <Modal title={`Direct Message · ${props.peer.name}`} onClose={props.onClose}>
      <textarea
        className="input textarea"
        rows={3}
        autoFocus
        placeholder="Type a message, paste a link, or share a snippet…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && text.trim()) {
            e.preventDefault();
            props.onSend(text.trim());
          }
        }}
      />
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!text.trim()}
          onClick={() => props.onSend(text.trim())}
        >
          <Send size={14} /> Send Message
        </button>
      </div>
    </Modal>
  );
}
