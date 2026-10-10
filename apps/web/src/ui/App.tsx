import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { zipSync } from 'fflate';
import {
  Archive, Check, ClipboardList, Copy, Download, History as HistoryIcon,
  Laptop, Link2, Loader2, Lock, LogOut, MessageSquare, MonitorSmartphone,
  RefreshCw, Send, Settings as SettingsIcon, Share2, Smartphone, Trash2,
  Users, Wifi, X, AlertTriangle, HardDrive, Eye, Image as ImageIcon,
  Music, Film, FileText, Box, Folder, Radio, Layers, ArrowUpRight, ArrowDownLeft,
} from 'lucide-react';
import { NetworkService, normalizeRoomCode, safeGet, safeSet, supportsStreamSave } from '../services/network';
import { ROOM_CODE_LENGTH } from '@shareapp/shared';
import { addHistory, clearHistory, getHistory, type HistoryEntry } from '../utils/history';
import type {
  ClipboardItem, ConnState, Device, IncomingRequest, Platform, TransferFile,
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
import { PersonalSpaceView } from './PersonalSpaceView';
import { FilePreviewModal, type PreviewableFile } from './FilePreviewModal';
import { RadarScanner } from './RadarScanner';
import { ConnectPcModal } from './ConnectPcModal';
import { ReceiveModal } from './ReceiveModal';

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------
function generateDeviceName(plat?: Platform): string {
  const p = plat || detectPlatform();
  const hex = Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
  const tag = hex.slice(0, 2);
  switch (p) {
    case 'ios': return `iPhone (${tag})`;
    case 'android': return `Android (${tag})`;
    case 'macos': return `MacBook (${tag})`;
    case 'windows': return `Windows PC (${tag})`;
    case 'linux': return `Linux PC (${tag})`;
    default: return `Device (${tag})`;
  }
}

function detectPlatform(): Platform {
  try {
    const ua = navigator.userAgent;
    if (/iPhone|iPod/.test(ua)) return 'ios';
    // D9: iPadOS reports a Macintosh UA — detect via touch points
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    if (/Macintosh/.test(ua)) return 'macos';
    if (/Windows/.test(ua)) return 'windows';
    if (/Linux/.test(ua)) return 'linux';
  } catch { /* SSR / odd environments */ }
  return 'web';
}

function platformIcon(platform: Platform) {
  if (platform === 'ios' || platform === 'android') return <Smartphone size={20} aria-hidden />;
  if (platform === 'web') return <MonitorSmartphone size={20} aria-hidden />;
  return <Laptop size={20} aria-hidden />;
}

// F2: clipboard copy with execCommand fallback for plain-http LAN pages
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
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

// F11: filename sanitization + executable warning
function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').slice(0, 180) || 'download';
}
const EXEC_RE = /\.(exe|apk|bat|cmd|sh|msi|scr|ps1|jar)$/i;
const BIG_FILE_WARN = 500 * 1024 * 1024; // T6

// F3: recursively collect files from folder drag & drop
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
    const getEntry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry;
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
      // readEntries returns batches; loop until empty
      for (;;) {
        const batch = await new Promise<FsEntry[]>((res) => reader.readEntries((e) => res(e), () => res([])));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  }
  for (const e of entries) await walk(e);
  return files;
}

// F5: pick up files shared via the Android share sheet (service worker stash)
async function readSharedFiles(): Promise<File[]> {
  try {
    const cache = await caches.open('mog-shared-files');
    const keys = await cache.keys();
    const files: File[] = [];
    for (const req of keys) {
      const res = await cache.match(req);
      if (!res) continue;
      let name = 'shared-file';
      try { name = decodeURIComponent(res.headers.get('x-file-name') || '') || 'shared-file'; } catch { /* keep default */ }
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

interface Toast { id: number; kind: 'info' | 'success' | 'error'; message: string }

type Tab = 'nearby' | 'vault' | 'room' | 'clipboard' | 'history';
type Theme = 'auto' | 'dark' | 'light';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const platform = useMemo(detectPlatform, []);
  // Identity (guarded storage)
  const [deviceName, setDeviceName] = useState<string>(() => safeGet('mog_device_name') || generateDeviceName(platform));

  const [connState, setConnState] = useState<ConnState>('connecting');
  const [connDetail, setConnDetail] = useState<string | undefined>();
  const [peers, setPeers] = useState<Device[]>([]);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomPeers, setRoomPeers] = useState<Device[]>([]);
  const [roomBusy, setRoomBusy] = useState<'creating' | 'joining' | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomLocked, setRoomLocked] = useState(false); // F8 indicator

  const [transfers, setTransfers] = useState<Map<string, TransferFile>>(new Map());
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]); // T3: a queue
  const [clipboardItems, setClipboardItems] = useState<ClipboardItem[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [vaultItems, setVaultItems] = useState<PersonalSpaceItem[]>([]);
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);
  const [showConnectPc, setShowConnectPc] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);

  const [tab, setTab] = useState<Tab>('nearby');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [targetPeer, setTargetPeer] = useState<Device | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [messagePeer, setMessagePeer] = useState<Device | null>(null);

  const [serverUrl, setServerUrl] = useState<string>(() => safeGet('mog_server_url') || '');
  const [publicUrl, setPublicUrl] = useState<string>(() => safeGet('mog_public_url') || '');
  const [theme, setTheme] = useState<Theme>(() => (safeGet('mog_theme') as Theme) || 'auto');
  const [autoAccept, setAutoAccept] = useState<string[]>(() => {
    try { return JSON.parse(safeGet('mog_auto_accept') || '[]'); } catch { return []; }
  });
  const [autoAcceptNearby, setAutoAcceptNearby] = useState<boolean>(() => {
    return safeGet('mog_auto_accept_nearby') !== 'false';
  });

  const netRef = useRef<NetworkService | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastId = useRef(0);
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null);
  const autoAcceptRef = useRef(autoAccept);
  const autoAcceptNearbyRef = useRef(autoAcceptNearby);
  const historyRecorded = useRef(new Set<string>());
  const saveTransferRef = useRef<(t: TransferFile) => void>(() => {});
  autoAcceptRef.current = autoAccept;
  autoAcceptNearbyRef.current = autoAcceptNearby;

  const pushToast = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
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
    return subscribePersonalSpace(() => { void loadVault(); });
  }, [loadVault]);

  // Theme (manual toggle + prefers-color-scheme default)
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    safeSet('mog_theme', theme);
  }, [theme]);

  // -------------------------------------------------------------------------
  // Network bootstrap
  // -------------------------------------------------------------------------
  useEffect(() => {
    const net = new NetworkService(deviceName, platform, {
      onStateChange: (s, d) => { setConnState(s); setConnDetail(d); },
      onPeersChanged: setPeers,
      onRoomCreated: (code) => { setRoomCode(code); setRoomBusy(null); setRoomError(null); setTab('room'); },
      onRoomJoined: (code) => { setRoomCode(code); setRoomBusy(null); setRoomError(null); setTab('room'); },
      onRoomLeft: () => { setRoomCode(null); setRoomPeers([]); setRoomBusy(null); setRoomLocked(false); },
      onRoomPeers: setRoomPeers,
      onRoomError: (msg) => { setRoomBusy(null); setRoomError(msg); setRoomCode(null); setRoomPeers([]); },
      onIncomingRequest: (req) => {
        // Auto-accept if autoAcceptNearby is active OR device is trusted
        if (autoAcceptNearbyRef.current || autoAcceptRef.current.includes(req.fromId)) {
          netRef.current?.respondToRequest(req, true);
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
        if (t.status === 'completed' && t.direction === 'receiving' && t.blobUrl && autoAcceptNearbyRef.current && !historyRecorded.current.has(t.id + '_autosaved')) {
          historyRecorded.current.add(t.id + '_autosaved');
          saveTransferRef.current(t);
        }
        // Save completed receive into Personal Space (Vault)
        if (t.status === 'completed' && t.direction === 'receiving' && !historyRecorded.current.has(t.id + '_vault')) {
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
          pushToast('success', `Received ${t.name}! Saved to Personal Space — tap Open to view.`);
        }
        // F7: persist terminal states to IndexedDB history
        const terminal = ['completed', 'failed', 'declined', 'expired', 'cancelled'];
        if (terminal.includes(t.status) && !historyRecorded.current.has(t.id)) {
          historyRecorded.current.add(t.id);
          if (t.status === 'completed') haptics.play('complete');
          else if (t.status === 'failed') haptics.play('error');
          void addHistory({
            id: t.id, name: t.name, size: t.size, direction: t.direction,
            peerName: t.peerName, status: t.status, channel: t.channel,
            finishedAt: Date.now(),
          });
        }
      },
      onClipboardReceived: (fromDevice, content, timestamp) => {
        setClipboardItems((items) => [
          { id: `${timestamp}-${Math.random().toString(36).slice(2, 6)}`, content, fromDevice, timestamp },
          ...items,
        ].slice(0, 50));
        pushToast('info', `Text received from ${fromDevice}`);
      },
      onError: (msg) => pushToast('error', msg),
    }, serverUrl || null);
    netRef.current = net;

    // R2: hash joins are queued by the service until the connection is ready
    const code = normalizeRoomCode(window.location.hash);
    if (code.length === ROOM_CODE_LENGTH) {
      setRoomBusy('joining');
      net.joinRoom(code);
    }

    // F5: pick up files shared from the Android share sheet
    if (window.location.hash.includes('shared')) {
      void readSharedFiles().then((files) => {
        if (files.length) {
          setSelectedFiles((prev) => [...prev, ...files]);
          pushToast('info', `${files.length} shared file${files.length > 1 ? 's' : ''} ready to send`);
        }
      });
    }

    return () => { net.destroy(); netRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load history when opening the tab
  useEffect(() => {
    if (tab === 'history') void getHistory().then(setHistory);
  }, [tab, transfers]);

  // D7: troubleshooting checklist when empty for > 6 s
  useEffect(() => {
    if (peers.length > 0) { setShowChecklist(false); return; }
    const t = setTimeout(() => setShowChecklist(true), 6000);
    return () => clearTimeout(t);
  }, [peers.length, connState]);

  // T10: wake lock + beforeunload while transfers are active
  const hasActive = useMemo(
    () => Array.from(transfers.values()).some((t) => t.status === 'transferring' || t.status === 'connecting'),
    [transfers]
  );
  useEffect(() => {
    if (hasActive) {
      try {
        (navigator as unknown as { wakeLock?: { request(type: string): Promise<{ release(): Promise<void> }> } })
          .wakeLock?.request('screen').then((l) => { wakeLockRef.current = l; }).catch(() => undefined);
      } catch { /* unsupported */ }
      const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
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
    } catch { /* best effort */ }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const saveName = (name: string) => {
    const clean = name.trim().slice(0, 40) || generateDeviceName(platform);
    setDeviceName(clean);
    safeSet('mog_device_name', clean);
    netRef.current?.updateProfile(clean, platform);
  };

  const pickFilesFor = (peer: Device) => {
    setTargetPeer(peer);
    fileInputRef.current?.click();
  };

  const startSend = (peer: Device, files: (File | Blob)[], customName?: string) => {
    if (!files.length) return;
    // T5: no global lock — the service runs at most 2 concurrent sends
    for (const f of files) {
      if (f instanceof File) {
        netRef.current?.sendFile(peer, f);
      } else {
        const fileObj = new File([f], customName || 'shared_file', { type: f.type });
        netRef.current?.sendFile(peer, fileObj);
      }
    }
    pushToast('info', `Asked ${peer.name} to accept ${files.length} file${files.length > 1 ? 's' : ''}`);
    setSelectedFiles([]);
    setTargetPeer(null);
  };

  const onFilesChosen = (files: FileList | null) => {
    if (!files?.length) return;
    const arr = Array.from(files);
    if (targetPeer) startSend(targetPeer, arr);
    else setSelectedFiles((prev) => [...prev, ...arr]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // F3: paste screenshots / files into the queue
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) {
        setSelectedFiles((prev) => [...prev, ...files]);
        pushToast('info', `${files.length} file${files.length > 1 ? 's' : ''} added from clipboard`);
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
    netRef.current?.respondToRequest(req, true);
    setIncoming((q) => q.filter((r) => r.transferId !== req.transferId));
  };
  const declineRequest = (req: IncomingRequest) => {
    netRef.current?.respondToRequest(req, false);
    setIncoming((q) => q.filter((r) => r.transferId !== req.transferId));
  };
  const acceptAllFrom = (fromId: string) => {
    const batch = incoming.filter((r) => r.fromId === fromId);
    for (const r of batch) netRef.current?.respondToRequest(r, true);
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

  // F3: download all completed receives as one ZIP
  const saveAllAsZip = async (list: TransferFile[]) => {
    const done = list.filter((t) => t.direction === 'receiving' && t.status === 'completed' && (t.blobUrl || t.fileBlob));
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
        if (t.status === 'transferring' || t.status === 'connecting' || t.status === 'waiting') next.set(id, t);
        else if (t.blobUrl) URL.revokeObjectURL(t.blobUrl); // T8: no leaked blob URLs
      }
      return next;
    });
  };

  const retryTransfer = (t: TransferFile) => {
    if (t.direction !== 'sending') return;
    pushToast('info', 'Pick the file again to retry this send.');
    const peer = peers.find((p) => p.id === t.peerId) || roomPeers.find((p) => p.id === t.peerId);
    if (peer) pickFilesFor(peer);
  };

  // R6: build share link with new URL(); prefer Public URL from settings
  const buildRoomLink = useCallback(async (code: string): Promise<string> => {
    let base = publicUrl.trim();
    if (!base) {
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        try {
          const res = await fetch('/api/info');
          const info = await res.json();
          const lan = info?.lanAddresses?.[0];
          if (lan) base = `${window.location.protocol}//${lan}:${window.location.port || '80'}`;
        } catch { /* fall back below */ }
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
  }, [publicUrl]);

  const allPeers = roomCode ? roomPeers : peers;
  const transferList = useMemo(
    () => Array.from(transfers.values()).sort((a, b) => b.createdAt - a.createdAt),
    [transfers]
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="app-shell">
      {/* Slim top bar */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden><Share2 size={20} /></span>
          <span className="brand-name">MogShare</span>
        </div>
        <div className="topbar-actions">
          <button
            className="btn btn-brutal btn-xs btn-pale-cyan"
            onClick={() => setShowConnectPc(true)}
            title="Connect to PC via Browser (WebShare)"
          >
            <Laptop size={14} /> Connect PC
          </button>
          <button
            className="conn-pill"
            onClick={() => setShowDiagnostics(true)}
            aria-label={`Connection: ${connState}. Open diagnostics`}
          >
            <span className={`conn-dot conn-${connState}`} aria-hidden />
            <span className="conn-label">
              {connState === 'ready' ? 'Connected'
                : connState === 'reconnecting' ? 'Reconnecting…'
                : connState === 'connecting' ? (connDetail || 'Connecting…')
                : 'Offline'}
            </span>
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings">
            <SettingsIcon size={20} />
          </button>
        </div>
      </header>

      <main className="main-area">
        {tab === 'nearby' && (
          <NearbyView
            peers={peers}
            connState={connState}
            showChecklist={showChecklist}
            selectedFiles={selectedFiles}
            onPickFor={pickFilesFor}
            onDropFiles={(peer, files) => startSend(peer, files)}
            onSendSelected={(peer) => startSend(peer, selectedFiles)}
            onClearSelected={() => setSelectedFiles([])}
            onRemoveSelected={(idx) => setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))}
            onAddFiles={() => { setTargetPeer(null); fileInputRef.current?.click(); }}
            onAddChosenFiles={(files) => {
              if (targetPeer) startSend(targetPeer, files);
              else setSelectedFiles((prev) => [...prev, ...files]);
            }}
            onGoRoom={() => setTab('room')}
            onMessage={(peer) => setMessagePeer(peer)}
            deviceName={deviceName}
            onRename={() => setRenaming(true)}
            autoAcceptNearby={autoAcceptNearby}
            onToggleAutoAccept={() => {
              const next = !autoAcceptNearby;
              setAutoAcceptNearby(next);
              safeSet('mog_auto_accept_nearby', next ? 'true' : 'false');
            }}
            onOpenReceiveMode={() => setShowReceiveModal(true)}
          />
        )}
        {tab === 'vault' && (
          <PersonalSpaceView
            items={vaultItems}
            peers={allPeers}
            onOpenFile={(item) => setPreviewFile(item)}
            onSendToPeer={(peer, blob, name) => startSend(peer, [blob], name)}
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
            onCreate={() => { setRoomError(null); setRoomBusy('creating'); netRef.current?.createRoom(); }}
            onJoin={(code) => { setRoomError(null); setRoomBusy('joining'); netRef.current?.joinRoom(code); }}
            onLeave={() => netRef.current?.leaveRoom()}
            onPickFor={pickFilesFor}
            onPassphrase={(p) => {
              void netRef.current?.setRoomPassphrase(p || null);
              setRoomLocked(Boolean(p));
              pushToast('info', p ? 'Relay traffic in this room is now encrypted' : 'Room passphrase cleared');
            }}
            buildRoomLink={buildRoomLink}
            pushToast={pushToast}
            clearBusy={() => setRoomBusy(null)}
          />
        )}
        {tab === 'clipboard' && (
          <ClipboardView
            items={clipboardItems}
            canSend={connState === 'ready' && (allPeers.length > 0)}
            encrypted={roomLocked}
            onBroadcast={(text) => { netRef.current?.broadcastClipboard(text); pushToast('success', 'Text sent to nearby devices'); }}
            pushToast={pushToast}
          />
        )}
        {tab === 'history' && (
          <HistoryView
            entries={history}
            onClear={() => { void clearHistory().then(() => setHistory([])); }}
          />
        )}
      </main>

      {/* Bottom tab bar */}
      <nav className="tabbar" aria-label="Main">
        {([
          ['nearby', 'Nearby', <Wifi size={20} key="i" aria-hidden />],
          ['vault', 'Space', <HardDrive size={20} key="i" aria-hidden />],
          ['room', 'Room', <Users size={20} key="i" aria-hidden />],
          ['clipboard', 'Clipboard', <ClipboardList size={20} key="i" aria-hidden />],
          ['history', 'History', <HistoryIcon size={20} key="i" aria-hidden />],
        ] as Array<[Tab, string, React.ReactNode]>).map(([key, label, icon]) => (
          <button
            key={key}
            className={`tabbar-btn ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
          >
            {icon}
            <span>{label}</span>
            {key === 'room' && roomCode && <span className="tab-badge" aria-hidden />}
            {key === 'vault' && vaultItems.length > 0 && <span className="tab-count-badge">{vaultItems.length}</span>}
          </button>
        ))}
      </nav>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => onFilesChosen(e.target.files)}
      />

      {/* Transfer bottom sheet */}
      {transferList.length > 0 && (
        <TransferSheet
          transfers={transferList}
          onCancel={(id) => netRef.current?.cancelTransfer(id)}
          onOpen={handleOpenTransfer}
          onSave={saveTransfer}
          onSaveAllZip={() => void saveAllAsZip(transferList)}
          onRetry={retryTransfer}
          onClear={clearFinished}
        />
      )}

      {/* Incoming request sheet (queue, grouped by sender — T3) */}
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
            setServerUrl(server); safeSet('mog_server_url', server);
            setPublicUrl(pub); safeSet('mog_public_url', pub);
            setTheme(th);
            setAutoAcceptNearby(autoNearby); safeSet('mog_auto_accept_nearby', autoNearby ? 'true' : 'false');
            netRef.current?.setCustomServerUrl(server || null);
            setShowSettings(false);
          }}
          onClearTrusted={() => { setAutoAccept([]); safeSet('mog_auto_accept', '[]'); }}
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
          onClose={() => setShowDiagnostics(false)}
          pushToast={pushToast}
        />
      )}
      {renaming && (
        <RenameModal
          current={deviceName}
          platform={platform}
          onClose={() => setRenaming(false)}
          onSave={(n) => { saveName(n); setRenaming(false); }}
        />
      )}
      {messagePeer && (
        <MessageModal
          peer={messagePeer}
          onClose={() => setMessagePeer(null)}
          onSend={(text) => {
            netRef.current?.sendDirectMessage(messagePeer.id, text);
            pushToast('success', `Message sent to ${messagePeer.name}`);
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
            pushToast('info', 'File removed from Personal Space');
          }}
          onSendToPeer={(peer, blob, name) => startSend(peer, [blob], name)}
          pushToast={pushToast}
        />
      )}

      {/* Toasts */}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nearby view
// ---------------------------------------------------------------------------
function NearbyView(props: {
  peers: Device[];
  connState: ConnState;
  showChecklist: boolean;
  selectedFiles: File[];
  onPickFor: (peer: Device) => void;
  onDropFiles: (peer: Device, files: File[]) => void;
  onSendSelected: (peer: Device) => void;
  onClearSelected: () => void;
  onRemoveSelected: (index: number) => void;
  onAddFiles: () => void;
  onAddChosenFiles: (files: File[]) => void;
  onGoRoom: () => void;
  onMessage: (peer: Device) => void;
  deviceName: string;
  onRename: () => void;
  autoAcceptNearby: boolean;
  onToggleAutoAccept: () => void;
  onOpenReceiveMode: () => void;
}) {
  const { peers, selectedFiles } = props;
  const [viewMode, setViewMode] = useState<'radar' | 'list'>('radar');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const totalSize = selectedFiles.reduce((s, f) => s + f.size, 0);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const apkInputRef = useRef<HTMLInputElement>(null);

  // F4: thumbnails for selected images
  const previews = useMemo(() => selectedFiles.map((f) => (
    f.type.startsWith('image/') ? URL.createObjectURL(f) : null
  )), [selectedFiles]);
  useEffect(() => () => { previews.forEach((u) => { if (u) URL.revokeObjectURL(u); }); }, [previews]);

  return (
    <div className="view">
      <h1 className="view-title">Nearby Devices</h1>
      <p className="view-sub">Auto-discover Android & PC devices on Wi-Fi or mobile hotspot. Tap to share instantly.</p>

      {/* Xender-Style Giant Send & Receive Action Hero Block */}
      <div className="xender-hero-actions">
        <button
          className="xender-hero-btn xender-send-btn"
          onClick={props.onAddFiles}
          title="Pick files to send via Radar"
        >
          <div className="xender-hero-icon-wrap">
            <ArrowUpRight size={28} />
          </div>
          <div className="xender-hero-text">
            <span className="xender-hero-title">SEND</span>
            <span className="xender-hero-subtitle">Pick Photos, Music, APKs & Share</span>
          </div>
        </button>

        <button
          className="xender-hero-btn xender-receive-btn"
          onClick={props.onOpenReceiveMode}
          title="Ready to receive files from nearby devices"
        >
          <div className="xender-hero-icon-wrap">
            <ArrowDownLeft size={28} />
          </div>
          <div className="xender-hero-text">
            <span className="xender-hero-title">RECEIVE</span>
            <span className="xender-hero-subtitle">Wait for Incoming Files / QR Beacon</span>
          </div>
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', margin: '2px 0 8px 0' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            className={`btn btn-brutal btn-xs ${viewMode === 'radar' ? 'btn-pale-mint' : 'btn-ghost-brutal'}`}
            onClick={() => setViewMode('radar')}
          >
            <Radio size={13} /> Radar Discovery
          </button>
          <button
            className={`btn btn-brutal btn-xs ${viewMode === 'list' ? 'btn-pale-butter' : 'btn-ghost-brutal'}`}
            onClick={() => setViewMode('list')}
          >
            <Users size={13} /> Devices ({peers.length})
          </button>
        </div>

        <button
          className="btn btn-brutal btn-xs"
          onClick={props.onToggleAutoAccept}
          style={{ fontSize: '12px' }}
        >
          {props.autoAcceptNearby ? '⚡ Auto-accept: ON (AirDrop mode)' : 'Auto-accept: OFF'}
        </button>
      </div>

      {/* Radar Scanner View */}
      {viewMode === 'radar' && (
        <RadarScanner
          deviceName={props.deviceName}
          peers={peers}
          isScanning={props.connState === 'ready'}
          onSelectPeer={(p) => (selectedFiles.length ? props.onSendSelected(p) : props.onPickFor(p))}
        />
      )}

      {/* Device Cards Grid View */}
      {(viewMode === 'list' || peers.length === 0) && (
        peers.length === 0 ? (
          <div className="empty-state">
            <div className="pulse-ring" aria-hidden><Wifi size={28} /></div>
            <p className="empty-title font-bold">
              {props.connState === 'ready' ? 'Scanning network for nearby devices…' : 'Connecting to network…'}
            </p>
            {props.showChecklist && (
              <div className="checklist card brutal-card">
                <p className="checklist-title font-bold">Can't see a device?</p>
                <ul>
                  <li>Both devices connected to same Wi‑Fi or mobile hotspot (2.4GHz / 5GHz)?</li>
                  <li>VPN switched off on both devices?</li>
                  <li>If AP isolation or guest Wi‑Fi is active, connect with a Room Code.</li>
                </ul>
                <button className="btn btn-brutal btn-primary-brutal" onClick={props.onGoRoom}>
                  Connect with a code instead
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="device-grid">
            {peers.map((p) => (
              <div
                key={p.id}
                className={`device-card card brutal-card ${dragOver === p.id ? 'drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(p.id); }}
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
                  onClick={() => (selectedFiles.length ? props.onSendSelected(p) : props.onPickFor(p))}
                  aria-label={selectedFiles.length ? `Send ${selectedFiles.length} files to ${p.name}` : `Send files to ${p.name}`}
                >
                  <span className="device-avatar" aria-hidden>{platformIcon(p.platform)}</span>
                  <span className="device-info">
                    <span className="device-name">{p.name}</span>
                    <span className="device-hint">
                      {selectedFiles.length ? `Tap to send ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}` : 'Tap to pick files · or drop here'}
                    </span>
                  </span>
                </button>
                <button className="icon-btn brutal-btn-icon subtle" onClick={() => props.onMessage(p)} aria-label={`Send a message to ${p.name}`}>
                  <MessageSquare size={18} />
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {/* Xender-Style Categorized Send Bar */}
      <div className="send-category-hub card brutal-card pale-paper-bg">
        <div className="send-category-title font-bold">SELECT FILES TO SHARE (XENDER STYLE)</div>
        <div className="send-cat-grid">
          <button className="send-cat-btn send-cat-photos" onClick={() => photoInputRef.current?.click()} title="Pick Photos">
            <ImageIcon size={20} />
            <span>Photos</span>
          </button>
          <button className="send-cat-btn send-cat-music" onClick={() => musicInputRef.current?.click()} title="Pick Music">
            <Music size={20} />
            <span>Music</span>
          </button>
          <button className="send-cat-btn send-cat-video" onClick={() => videoInputRef.current?.click()} title="Pick Videos">
            <Film size={20} />
            <span>Videos</span>
          </button>
          <button className="send-cat-btn send-cat-docs" onClick={() => docInputRef.current?.click()} title="Pick Documents">
            <FileText size={20} />
            <span>Docs</span>
          </button>
          <button className="send-cat-btn send-cat-apps" onClick={() => apkInputRef.current?.click()} title="Pick APKs">
            <Box size={20} />
            <span>APKs</span>
          </button>
          <button className="send-cat-btn send-cat-all" onClick={props.onAddFiles} title="Browse All Files">
            <Folder size={20} />
            <span>All Files</span>
          </button>
        </div>
      </div>

      {/* Hidden file inputs for categories */}
      <input ref={photoInputRef} type="file" multiple accept="image/*" hidden onChange={(e) => { if (e.target.files) { props.onAddChosenFiles(Array.from(e.target.files)); e.target.value = ''; } }} />
      <input ref={musicInputRef} type="file" multiple accept="audio/*" hidden onChange={(e) => { if (e.target.files) { props.onAddChosenFiles(Array.from(e.target.files)); e.target.value = ''; } }} />
      <input ref={videoInputRef} type="file" multiple accept="video/*" hidden onChange={(e) => { if (e.target.files) { props.onAddChosenFiles(Array.from(e.target.files)); e.target.value = ''; } }} />
      <input ref={docInputRef} type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.md" hidden onChange={(e) => { if (e.target.files) { props.onAddChosenFiles(Array.from(e.target.files)); e.target.value = ''; } }} />
      <input ref={apkInputRef} type="file" multiple accept=".apk,.xapk,.zip,.bin,.tar,.gz" hidden onChange={(e) => { if (e.target.files) { props.onAddChosenFiles(Array.from(e.target.files)); e.target.value = ''; } }} />

      {/* Sticky send bar with previews */}
      {selectedFiles.length > 0 && (
        <div className="send-bar card brutal-card">
          <div className="send-bar-row">
            <div className="send-bar-info">
              <strong>{selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} staged</strong>
              <span className="muted mono">{formatBytes(totalSize)}</span>
            </div>
            <span className="muted font-bold small">{peers.length ? 'Tap a peer in radar or list to send!' : 'Scanning for nearby peers…'}</span>
            <button className="icon-btn subtle" onClick={props.onClearSelected} aria-label="Clear selected files">
              <X size={18} />
            </button>
          </div>
          <div className="thumb-row">
            {selectedFiles.slice(0, 12).map((f, i) => (
              <button key={`${f.name}-${i}`} className="thumb" title={`${f.name} — tap to remove`} onClick={() => props.onRemoveSelected(i)}>
                {previews[i]
                  ? <img src={previews[i]!} alt={f.name} />
                  : <span className="thumb-ext mono font-bold">{(f.name.split('.').pop() || 'file').slice(0, 4)}</span>}
              </button>
            ))}
            {selectedFiles.length > 12 && <span className="muted small font-bold">+{selectedFiles.length - 12}</span>}
          </div>
        </div>
      )}

      <button className="identity-pill" onClick={props.onRename}>
        You appear as <strong>{props.deviceName}</strong> · tap to rename
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Room view
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
        QRCode.toDataURL(l, { width: 240, margin: 1 }).then(setQr).catch(() => setQr(null));
      });
    } else {
      setQr(null); setLink('');
    }
  }, [props.roomCode, props.buildRoomLink, props]);

  // R7: 6 s join timeout
  useEffect(() => {
    if (props.busy === 'joining') {
      joinTimer.current = setTimeout(() => {
        props.clearBusy();
        props.pushToast('error', 'Room not found or expired.');
      }, 6000);
      return () => { if (joinTimer.current) clearTimeout(joinTimer.current); };
    }
  }, [props.busy, props]);

  const handleInput = (raw: string) => {
    const code = normalizeRoomCode(raw);
    setInput(code);
    if (code.length === ROOM_CODE_LENGTH) props.onJoin(code); // auto-submit
  };

  if (props.roomCode) {
    return (
      <div className="view">
        <h1 className="view-title">Room {props.locked && <Lock size={18} aria-label="Encrypted" />}</h1>
        <p className="view-sub">Anyone with this code can join from any network.</p>
        <div className="card room-card brutal-card">
          <div className="code-boxes" aria-label={`Room code ${props.roomCode.split('').join(' ')}`}>
            {props.roomCode.split('').map((d, i) => (
              <span key={i} className="code-digit mono">{d}</span>
            ))}
          </div>
          <div className="room-actions">
            <button className="btn btn-brutal btn-ghost-brutal" onClick={async () => {
              const ok = await copyText(link);
              props.pushToast(ok ? 'success' : 'error', ok ? 'Link copied' : 'Copy failed — long-press the link to copy');
            }}><Link2 size={16} /> Copy link</button>
            {typeof navigator.share === 'function' && (
              <button className="btn btn-brutal btn-ghost-brutal" onClick={() => navigator.share({ title: 'Join my Mog Share room', url: link }).catch(() => undefined)}>
                <Share2 size={16} /> Share
              </button>
            )}
            <button className="btn btn-brutal btn-danger-brutal" onClick={props.onLeave}><LogOut size={16} /> Leave</button>
          </div>
          {qr && (
            <div className="qr-wrap">
              <img src={qr} alt={`QR code to join room ${props.roomCode}`} width={180} height={180} />
              <p className="muted">Scan with the other device's camera</p>
            </div>
          )}

          {/* F8: optional passphrase → AES-GCM for relay chunks + clipboard */}
          {showPass ? (
            <div className="pass-row">
              <input
                className="input"
                type="password"
                placeholder="Shared passphrase (same on all devices)"
                value={passInput}
                onChange={(e) => setPassInput(e.target.value)}
              />
              <button className="btn btn-brutal btn-primary-brutal" onClick={() => { props.onPassphrase(passInput); setShowPass(false); }}>
                Set
              </button>
            </div>
          ) : (
            <button className="btn btn-brutal btn-ghost-brutal btn-sm" onClick={() => setShowPass(true)}>
              <Lock size={14} /> {props.locked ? 'Change passphrase' : 'Add a passphrase (encrypts relayed data)'}
            </button>
          )}
          {props.locked && (
            <p className="muted small center">Relayed file data and clipboard text are AES‑GCM encrypted. Direct P2P transfers never touch the server.</p>
          )}
        </div>

        <h2 className="section-title">In this room</h2>
        {props.roomPeers.length === 0 ? (
          <p className="muted">No one else yet. Share the code or QR.</p>
        ) : (
          <div className="device-grid">
            {props.roomPeers.map((p) => (
              <div key={p.id} className="device-card card brutal-card">
                <button className="device-main" onClick={() => props.onPickFor(p)} aria-label={`Send files to ${p.name}`}>
                  <span className="device-avatar" aria-hidden>{platformIcon(p.platform)}</span>
                  <span className="device-info">
                    <span className="device-name">{p.name}</span>
                    <span className="device-hint">{p.status === 'online' ? 'Online · tap to send files' : 'Reconnecting…'}</span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="view">
      <h1 className="view-title">Connect with a code</h1>
      <p className="view-sub">Works across different networks — no same‑Wi‑Fi needed.</p>

      <div className="card room-card brutal-card">
        <button className="btn btn-brutal btn-primary-brutal btn-lg" onClick={props.onCreate} disabled={!props.connReady || props.busy === 'creating'}>
          {props.busy === 'creating' ? (<><Loader2 size={18} className="spin" /> Creating…</>) : 'Create a room'}
        </button>
        {!props.connReady && <p className="muted center">Connecting to server…</p>}

        <div className="divider"><span>or join one</span></div>

        <label className="field-label" htmlFor="room-code-input">8‑character code</label>
        <div className="join-row">
          <input
            id="room-code-input"
            className="input mono code-input"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            placeholder="23456789"
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
            className="btn btn-brutal btn-primary-brutal"
            disabled={input.length !== ROOM_CODE_LENGTH || !props.connReady || props.busy === 'joining'}
            onClick={() => props.onJoin(input)}
          >
            {props.busy === 'joining' ? <Loader2 size={18} className="spin" /> : 'Join'}
          </button>
        </div>
        {props.error && <p className="error-text" role="alert">{props.error}</p>}

        {/* Brutalist Quick Keypad */}
        <div className="brutal-keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              className="keypad-btn"
              onClick={() => handleInput(input + digit)}
              disabled={input.length >= ROOM_CODE_LENGTH || !props.connReady}
            >
              {digit}
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
            className="keypad-btn"
            onClick={() => handleInput(input + '0')}
            disabled={input.length >= ROOM_CODE_LENGTH || !props.connReady}
          >
            0
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
  );
}

// ---------------------------------------------------------------------------
// Clipboard view
// ---------------------------------------------------------------------------
function ClipboardView(props: {
  items: ClipboardItem[];
  canSend: boolean;
  encrypted: boolean;
  onBroadcast: (text: string) => void;
  pushToast: (k: Toast['kind'], m: string) => void;
}) {
  const [text, setText] = useState('');
  return (
    <div className="view">
      <h1 className="view-title">Shared clipboard</h1>
      <p className="view-sub">
        Send text or links to every connected device.
        {props.encrypted && <> <Lock size={13} aria-hidden /> Encrypted with the room passphrase.</>}
      </p>

      <div className="card brutal-card">
        <textarea
          className="input textarea"
          rows={3}
          placeholder="Paste or type text to share…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="btn btn-brutal btn-primary-brutal"
          disabled={!text.trim() || !props.canSend}
          onClick={() => { props.onBroadcast(text.trim()); setText(''); }}
        >
          <Send size={16} /> Send to all
        </button>
        {!props.canSend && <p className="muted">Needs at least one connected device.</p>}
      </div>

      <h2 className="section-title">Received</h2>
      {props.items.length === 0 ? (
        <p className="muted">Nothing received yet.</p>
      ) : (
        <div className="clip-list">
          {props.items.map((item) => (
            <div key={item.id} className="card clip-item brutal-card">
              <div className="clip-meta">
                <strong>{item.fromDevice}</strong>
                <span className="muted">{new Date(item.timestamp).toLocaleTimeString()}</span>
              </div>
              <p className="clip-content">{item.content}</p>
              <button className="btn btn-brutal btn-ghost-brutal" onClick={async () => {
                const ok = await copyText(item.content);
                props.pushToast(ok ? 'success' : 'error', ok ? 'Copied' : 'Copy failed');
              }}><Copy size={14} /> Copy</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History view (F7)
// ---------------------------------------------------------------------------
function HistoryView(props: { entries: HistoryEntry[]; onClear: () => void }) {
  return (
    <div className="view">
      <div className="history-head">
        <div>
          <h1 className="view-title">History</h1>
          <p className="view-sub">Past transfers, stored only on this device.</p>
        </div>
        {props.entries.length > 0 && (
          <button className="btn btn-brutal btn-ghost-brutal btn-sm" onClick={props.onClear}>
            <Trash2 size={14} /> Clear
          </button>
        )}
      </div>
      {props.entries.length === 0 ? (
        <p className="muted">No transfers yet.</p>
      ) : (
        <div className="clip-list">
          {props.entries.map((e) => (
            <div key={e.id} className="card history-item brutal-card">
              <div className="history-row">
                <span className="transfer-name font-bold" title={e.name}>{e.name}</span>
                <span className={`badge badge-${e.status}`}>{e.status}</span>
              </div>
              <p className="muted small mono">
                {e.direction === 'sending' ? '→' : '←'} {e.peerName} · {formatBytes(e.size)}
                {e.channel ? ` · ${e.channel === 'direct' ? 'Direct' : 'Relayed'}` : ''}
                {' · '}{new Date(e.finishedAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transfer bottom sheet
// ---------------------------------------------------------------------------
function TransferSheet(props: {
  transfers: TransferFile[];
  onCancel: (id: string) => void;
  onOpen: (t: TransferFile) => void;
  onSave: (t: TransferFile) => void;
  onSaveAllZip: () => void;
  onRetry: (t: TransferFile) => void;
  onClear: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const active = props.transfers.filter((t) => t.status === 'transferring' || t.status === 'connecting' || t.status === 'waiting');
  const completedReceives = props.transfers.filter((t) => t.direction === 'receiving' && t.status === 'completed' && t.blobUrl);

  return (
    <div className={`sheet transfer-sheet ${collapsed ? 'collapsed' : ''}`}>
      <button className="sheet-handle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
        <span>{active.length ? `${active.length} active transfer${active.length > 1 ? 's' : ''}` : 'Transfers'}</span>
        <span className="muted">{collapsed ? 'Show' : 'Hide'}</span>
      </button>
      {!collapsed && (
        <div className="sheet-body">
          {props.transfers.map((t) => (
            <div
              key={t.id}
              className="transfer-row"
              style={{ cursor: t.status === 'completed' && (t.blobUrl || t.fileBlob) ? 'pointer' : 'default' }}
              onClick={() => {
                if (t.status === 'completed' && (t.blobUrl || t.fileBlob)) {
                  props.onOpen(t);
                }
              }}
            >
              <div className="transfer-top">
                <span className="transfer-name-wrap">
                  {/* F4: thumbnail for received images */}
                  {t.blobUrl && t.type.startsWith('image/') && (
                    <img
                      className="transfer-thumb"
                      src={t.blobUrl}
                      alt=""
                      onClick={(e) => { e.stopPropagation(); props.onOpen(t); }}
                      title="Click to preview image"
                    />
                  )}
                  <span className="transfer-name font-bold" title={t.name}>{t.name}</span>
                </span>
                <span className="transfer-badges">
                  {t.channel && (
                    <span className={`badge ${t.channel === 'direct' ? 'badge-success' : 'badge-neutral'}`}>
                      {t.channel === 'direct' ? 'Direct P2P' : 'Relayed'}
                    </span>
                  )}
                  <span className={`badge badge-${t.status}`}>{statusLabel(t)}</span>
                </span>
              </div>
              <div className="transfer-meta muted mono">
                {t.direction === 'sending' ? `→ ${t.peerName}` : `← ${t.peerName}`} · {formatBytes(t.size)}
                {t.status === 'transferring' && ` · ${formatSpeed(t.speedBytesPerSec)} · ${formatTime(t.etaSeconds)} left`}
                {t.savedToDisk && ' · streamed to disk'}
              </div>
              {(t.status === 'transferring' || t.status === 'connecting') && (
                <div className="progress-track" role="progressbar" aria-valuenow={Math.round(t.progress)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="progress-fill" style={{ width: `${t.progress}%` }} />
                </div>
              )}
              {t.error && <p className="error-text">{t.error}</p>}
              {EXEC_RE.test(t.name) && t.direction === 'receiving' && t.status === 'completed' && (
                <p className="warn-text"><AlertTriangle size={13} /> Executable file — only open it if you trust the sender.</p>
              )}
              <div className="transfer-actions" onClick={(e) => e.stopPropagation()}>
                {t.status === 'completed' && (t.blobUrl || t.fileBlob) && (
                  <button
                    className="btn btn-brutal btn-primary-brutal btn-sm"
                    onClick={() => props.onOpen(t)}
                    title="Open and inspect file"
                  >
                    <Eye size={14} /> Open
                  </button>
                )}
                {t.status === 'completed' && t.direction === 'receiving' && (t.blobUrl || t.fileBlob) && (
                  <button className="btn btn-brutal btn-ghost-brutal btn-sm" onClick={() => props.onSave(t)}><Download size={14} /> Save</button>
                )}
                {t.status === 'completed' && t.savedToDisk && (
                  <span className="muted small">Saved to disk</span>
                )}
                {(t.status === 'transferring' || t.status === 'connecting' || t.status === 'waiting') && (
                  <button className="btn btn-brutal btn-danger-brutal btn-sm" onClick={() => props.onCancel(t.id)}><X size={14} /> Cancel</button>
                )}
                {(t.status === 'failed' || t.status === 'expired') && t.direction === 'sending' && (
                  <button className="btn btn-brutal btn-ghost-brutal btn-sm" onClick={() => props.onRetry(t)}><RefreshCw size={14} /> Retry</button>
                )}
              </div>
            </div>
          ))}
          <div className="transfer-actions">
            {completedReceives.length >= 2 && (
              <button className="btn btn-brutal btn-ghost-brutal btn-sm" onClick={props.onSaveAllZip}>
                <Archive size={14} /> Save all {completedReceives.length} as ZIP
              </button>
            )}
            <button className="btn btn-brutal btn-ghost-brutal btn-sm" onClick={props.onClear}>Clear finished</button>
          </div>
        </div>
      )}
    </div>
  );
}

function statusLabel(t: TransferFile): string {
  switch (t.status) {
    case 'waiting': return 'Waiting for approval…';
    case 'connecting': return 'Connecting P2P…';
    case 'transferring': return `${Math.round(t.progress)}%`;
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'declined': return 'Declined';
    case 'expired': return 'No answer';
    case 'cancelled': return 'Cancelled';
  }
}

// ---------------------------------------------------------------------------
// Incoming request sheet
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
                <strong>{reqs[0].fromName}</strong> wants to send {reqs.length > 1 ? `${reqs.length} files` : 'a file'}
              </p>
              {reqs.slice(0, 3).map((r) => (
                <p key={r.transferId} className="muted mono incoming-file">
                  {r.meta.name} · {formatBytes(r.meta.size)}
                  {EXEC_RE.test(r.meta.name) && <span className="warn-text"> <AlertTriangle size={12} /> executable</span>}
                </p>
              ))}
              {reqs.length > 3 && <p className="muted">…and {reqs.length - 3} more</p>}
              {hasHuge && !supportsStreamSave() && (
                <p className="warn-text">
                  <AlertTriangle size={13} /> Files over 500 MB are held in memory in this browser and may fail. Desktop Chrome/Edge can stream them to disk.
                </p>
              )}
              <div className="incoming-actions">
                {reqs.length > 1 ? (
                  <button className="btn btn-brutal btn-primary-brutal btn-sm" onClick={() => props.onAcceptAll(fromId)}>
                    <Check size={14} /> Accept all {reqs.length}
                  </button>
                ) : (
                  <button className="btn btn-brutal btn-primary-brutal btn-sm" onClick={() => props.onAccept(reqs[0])}>
                    <Check size={14} /> Accept
                  </button>
                )}
                <button className="btn btn-brutal btn-ghost-brutal btn-sm" onClick={() => props.onAccept(reqs[0], true)}>
                  Always accept from this device
                </button>
                <button className="btn btn-brutal btn-danger-brutal btn-sm" onClick={() => reqs.forEach(props.onDecline)}>
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
      <div className="modal card brutal-card" role="dialog" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="font-extrabold">{props.title}</h2>
          <button className="icon-btn brutal-btn-icon" onClick={props.onClose} aria-label="Close"><X size={18} /></button>
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
  onSave: (name: string, serverUrl: string, publicUrl: string, theme: Theme, autoAcceptNearby: boolean) => void;
  onClearTrusted: () => void;
}) {
  const [name, setName] = useState(props.deviceName);
  const [server, setServer] = useState(props.serverUrl);
  const [pub, setPub] = useState(props.publicUrl);
  const [th, setTh] = useState<Theme>(props.theme);
  const [autoNearby, setAutoNearby] = useState(props.autoAcceptNearby);
  return (
    <Modal title="Settings" onClose={props.onClose}>
      <label className="field-label" htmlFor="set-name">Device name</label>
      <input id="set-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />

      <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '14px', marginBottom: '4px' }}>
        <input
          type="checkbox"
          checked={autoNearby}
          onChange={(e) => setAutoNearby(e.target.checked)}
        />
        <span style={{ fontWeight: 500 }}>Auto-accept nearby transfers</span>
      </label>
      <p className="muted small" style={{ marginTop: 0, marginBottom: '14px' }}>
        Instantly accept incoming files without confirmation when on the same network (AirDrop / QuickShare style).
      </p>

      <label className="field-label">Theme</label>
      <div className="seg-row" role="radiogroup" aria-label="Theme">
        {(['auto', 'dark', 'light'] as Theme[]).map((opt) => (
          <button
            key={opt}
            role="radio"
            aria-checked={th === opt}
            className={`btn btn-brutal btn-sm ${th === opt ? 'btn-primary-brutal' : 'btn-ghost-brutal'}`}
            onClick={() => setTh(opt)}
          >
            {opt === 'auto' ? 'System' : opt === 'dark' ? 'Dark' : 'Light'}
          </button>
        ))}
      </div>

      <label className="field-label" htmlFor="set-server">Server URL (optional)</label>
      <input id="set-server" className="input" placeholder="wss://your-server.onrender.com" value={server} onChange={(e) => setServer(e.target.value)} />
      <p className="muted small">Leave empty to use this page's own server. Free hosts may take up to a minute to wake.</p>

      <label className="field-label" htmlFor="set-public">Public URL for QR links (optional)</label>
      <input id="set-public" className="input" placeholder="https://mogshare.example.com" value={pub} onChange={(e) => setPub(e.target.value)} />

      {props.autoAcceptCount > 0 && (
        <button className="btn btn-brutal btn-ghost-brutal btn-sm" onClick={props.onClearTrusted}>
          Forget {props.autoAcceptCount} trusted device{props.autoAcceptCount > 1 ? 's' : ''}
        </button>
      )}

      <div className="modal-actions">
        <button className="btn btn-brutal btn-primary-brutal" onClick={() => props.onSave(name, server.trim(), pub.trim(), th, autoNearby)}>Save</button>
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
  onClose: () => void;
  pushToast: (k: Toast['kind'], m: string) => void;
}) {
  const [fullReport, setFullReport] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const initialReport = [
    `state: ${props.connState}`,
    `server: ${props.serverUrl}`,
    `latency: ${props.latencyMs != null ? `${props.latencyMs} ms` : 'measuring…'}`,
    `device: ${props.deviceId}`,
    `room: ${props.roomCode || 'none'}`,
    `nearby peers: ${props.peerCount}`,
    `stream-save: ${supportsStreamSave() ? 'supported' : 'unsupported'}`,
    `page: ${window.location.href}`,
    `ua: ${navigator.userAgent}`,
  ].join('\n');

  const handleRunFullDiagnostics = async () => {
    setRunning(true);
    try {
      const runner = new DiagnosticsRunner(props.serverUrl);
      const res = await runner.runFullDiagnostics();
      setFullReport(runner.formatReportAsText(res));
      props.pushToast('success', 'Diagnostics completed');
    } catch {
      props.pushToast('error', 'Diagnostics failed');
    } finally {
      setRunning(false);
    }
  };

  const displayText = fullReport || initialReport;

  return (
    <Modal title="Diagnostics" onClose={props.onClose}>
      <pre className="diag mono">{displayText}</pre>
      <div className="modal-actions">
        <button
          className="btn btn-brutal btn-ghost-brutal"
          disabled={running}
          onClick={handleRunFullDiagnostics}
        >
          {running ? 'Running tests…' : 'Run 10s Deep Diagnostics'}
        </button>
        <button className="btn btn-brutal btn-primary-brutal" onClick={async () => {
          const ok = await copyText(displayText);
          props.pushToast(ok ? 'success' : 'error', ok ? 'Diagnostics copied' : 'Copy failed');
        }}><Copy size={14} /> Copy diagnostics</button>
      </div>
    </Modal>
  );
}

function RenameModal(props: { current: string; platform: Platform; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(props.current);
  return (
    <Modal title="Rename this device" onClose={props.onClose}>
      <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
      <div className="modal-actions">
        <button className="btn btn-brutal btn-ghost-brutal" onClick={() => setName(generateDeviceName(props.platform))}>Reset</button>
        <button className="btn btn-brutal btn-primary-brutal" onClick={() => props.onSave(name)}>Save</button>
      </div>
    </Modal>
  );
}

function MessageModal(props: { peer: Device; onClose: () => void; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <Modal title={`Message ${props.peer.name}`} onClose={props.onClose}>
      <textarea className="input textarea" rows={3} autoFocus placeholder="Type a message or paste a link…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="modal-actions">
        <button className="btn btn-brutal btn-primary-brutal" disabled={!text.trim()} onClick={() => props.onSend(text.trim())}>
          <Send size={14} /> Send
        </button>
      </div>
    </Modal>
  );
}
