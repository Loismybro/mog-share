import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { zipSync } from 'fflate';
import {
  Archive, Check, ClipboardList, Copy, Download, History as HistoryIcon,
  Laptop, Link2, Loader2, Lock, LogOut, MessageSquare, MonitorSmartphone,
  RefreshCw, Send, Settings as SettingsIcon, Share2, Smartphone, Trash2,
  Users, Wifi, X, AlertTriangle,
} from 'lucide-react';
import { NetworkService, normalizeRoomCode, safeGet, safeSet, supportsStreamSave } from './services/network';
import { addHistory, clearHistory, getHistory, type HistoryEntry } from './utils/history';
import type {
  ClipboardItem, ConnState, Device, IncomingRequest, Platform, TransferFile,
} from './types';
import { formatBytes, formatSpeed, formatTime } from './utils/formatters';

// ---------------------------------------------------------------------------
// Identity helpers (D9)
// ---------------------------------------------------------------------------
const ADJECTIVES = ['Swift', 'Calm', 'Brave', 'Quiet', 'Lucky', 'Bright', 'Gentle', 'Bold', 'Clever', 'Happy', 'Steady', 'Nimble'];
const ANIMALS = ['Falcon', 'Otter', 'Lynx', 'Panda', 'Heron', 'Fox', 'Dolphin', 'Badger', 'Raven', 'Koala', 'Tiger', 'Owl'];

function generateFriendlyName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${a} ${b}`;
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

type Tab = 'nearby' | 'room' | 'clipboard' | 'history';
type Theme = 'auto' | 'dark' | 'light';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  // Identity (guarded storage — D9)
  const [deviceName, setDeviceName] = useState<string>(() => safeGet('mog_device_name') || generateFriendlyName());
  const platform = useMemo(detectPlatform, []);

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

  const netRef = useRef<NetworkService | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastId = useRef(0);
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null);
  const autoAcceptRef = useRef(autoAccept);
  const historyRecorded = useRef(new Set<string>());
  autoAcceptRef.current = autoAccept;

  const pushToast = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

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
        // F6: trusted devices auto-accept
        if (autoAcceptRef.current.includes(req.fromId)) {
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
        // F7: persist terminal states to IndexedDB history
        const terminal = ['completed', 'failed', 'declined', 'expired', 'cancelled'];
        if (terminal.includes(t.status) && !historyRecorded.current.has(t.id)) {
          historyRecorded.current.add(t.id);
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
    if (code.length === 6) {
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
      if ('vibrate' in navigator) navigator.vibrate?.(80);
    } catch { /* best effort */ }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const saveName = (name: string) => {
    const clean = name.trim().slice(0, 40) || generateFriendlyName();
    setDeviceName(clean);
    safeSet('mog_device_name', clean);
    netRef.current?.updateProfile(clean, platform);
  };

  const pickFilesFor = (peer: Device) => {
    setTargetPeer(peer);
    fileInputRef.current?.click();
  };

  const startSend = (peer: Device, files: File[]) => {
    if (!files.length) return;
    // T5: no global lock — the service runs at most 2 concurrent sends
    for (const f of files) netRef.current?.sendFile(peer, f);
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

  const saveTransfer = (t: TransferFile) => {
    if (!t.blobUrl) return;
    const a = document.createElement('a');
    a.href = t.blobUrl;
    a.download = sanitizeFileName(t.name);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // F3: download all completed receives as one ZIP
  const saveAllAsZip = async (list: TransferFile[]) => {
    const done = list.filter((t) => t.direction === 'receiving' && t.status === 'completed' && t.blobUrl);
    if (done.length < 2) return;
    try {
      const entries: Record<string, Uint8Array> = {};
      for (const t of done) {
        const buf = await (await fetch(t.blobUrl!)).arrayBuffer();
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
          <span className="brand-mark" aria-hidden>⚡</span>
          <span className="brand-name">Mog Share</span>
        </div>
        <div className="topbar-actions">
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
            onGoRoom={() => setTab('room')}
            onMessage={(peer) => setMessagePeer(peer)}
            deviceName={deviceName}
            onRename={() => setRenaming(true)}
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
          onClose={() => setShowSettings(false)}
          onSave={(name, server, pub, th) => {
            saveName(name);
            setServerUrl(server); safeSet('mog_server_url', server);
            setPublicUrl(pub); safeSet('mog_public_url', pub);
            setTheme(th);
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
  onGoRoom: () => void;
  onMessage: (peer: Device) => void;
  deviceName: string;
  onRename: () => void;
}) {
  const { peers, selectedFiles } = props;
  const [dragOver, setDragOver] = useState<string | null>(null);
  const totalSize = selectedFiles.reduce((s, f) => s + f.size, 0);

  // F4: thumbnails for selected images
  const previews = useMemo(() => selectedFiles.map((f) => (
    f.type.startsWith('image/') ? URL.createObjectURL(f) : null
  )), [selectedFiles]);
  useEffect(() => () => { previews.forEach((u) => { if (u) URL.revokeObjectURL(u); }); }, [previews]);

  return (
    <div className="view">
      <h1 className="view-title">Nearby devices</h1>
      <p className="view-sub">Devices on the same network appear automatically. Drop files or whole folders onto a device.</p>

      {peers.length === 0 ? (
        <div className="empty-state">
          <div className="pulse-ring" aria-hidden><Wifi size={28} /></div>
          <p className="empty-title">
            {props.connState === 'ready' ? 'Looking for devices…' : 'Connecting…'}
          </p>
          {props.showChecklist && (
            <div className="checklist card">
              <p className="checklist-title">Can't see a device?</p>
              <ul>
                <li>Both devices on the same Wi‑Fi?</li>
                <li>VPN switched off on both?</li>
                <li>Guest Wi‑Fi or AP isolation can block discovery.</li>
              </ul>
              <button className="btn btn-primary" onClick={props.onGoRoom}>
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
              className={`device-card card ${dragOver === p.id ? 'drag-over' : ''}`}
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
              <button className="icon-btn subtle" onClick={() => props.onMessage(p)} aria-label={`Send a message to ${p.name}`}>
                <MessageSquare size={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row-gap">
        <button className="btn btn-ghost" onClick={props.onAddFiles}>Choose files first</button>
      </div>

      {/* Sticky send bar with previews */}
      {selectedFiles.length > 0 && (
        <div className="send-bar card">
          <div className="send-bar-row">
            <div className="send-bar-info">
              <strong>{selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''}</strong>
              <span className="muted mono">{formatBytes(totalSize)}</span>
            </div>
            <span className="muted">{peers.length ? 'Tap a device to send' : 'Waiting for a device…'}</span>
            <button className="icon-btn subtle" onClick={props.onClearSelected} aria-label="Clear selected files">
              <X size={18} />
            </button>
          </div>
          <div className="thumb-row">
            {selectedFiles.slice(0, 12).map((f, i) => (
              <button key={`${f.name}-${i}`} className="thumb" title={`${f.name} — tap to remove`} onClick={() => props.onRemoveSelected(i)}>
                {previews[i]
                  ? <img src={previews[i]!} alt={f.name} />
                  : <span className="thumb-ext mono">{(f.name.split('.').pop() || 'file').slice(0, 4)}</span>}
              </button>
            ))}
            {selectedFiles.length > 12 && <span className="muted small">+{selectedFiles.length - 12}</span>}
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
    if (code.length === 6) props.onJoin(code); // R7: auto-submit
  };

  if (props.roomCode) {
    return (
      <div className="view">
        <h1 className="view-title">Room {props.locked && <Lock size={18} aria-label="Encrypted" />}</h1>
        <p className="view-sub">Anyone with this code can join from any network.</p>
        <div className="card room-card">
          <div className="code-boxes" aria-label={`Room code ${props.roomCode.split('').join(' ')}`}>
            {props.roomCode.split('').map((d, i) => (
              <span key={i} className="code-digit mono">{d}</span>
            ))}
          </div>
          <div className="room-actions">
            <button className="btn btn-ghost" onClick={async () => {
              const ok = await copyText(link);
              props.pushToast(ok ? 'success' : 'error', ok ? 'Link copied' : 'Copy failed — long-press the link to copy');
            }}><Link2 size={16} /> Copy link</button>
            {typeof navigator.share === 'function' && (
              <button className="btn btn-ghost" onClick={() => navigator.share({ title: 'Join my Mog Share room', url: link }).catch(() => undefined)}>
                <Share2 size={16} /> Share
              </button>
            )}
            <button className="btn btn-danger-ghost" onClick={props.onLeave}><LogOut size={16} /> Leave</button>
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
              <button className="btn btn-primary" onClick={() => { props.onPassphrase(passInput); setShowPass(false); }}>
                Set
              </button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowPass(true)}>
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
              <div key={p.id} className="device-card card">
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

      <div className="card room-card">
        <button className="btn btn-primary btn-lg" onClick={props.onCreate} disabled={!props.connReady || props.busy === 'creating'}>
          {props.busy === 'creating' ? (<><Loader2 size={18} className="spin" /> Creating…</>) : 'Create a room'}
        </button>
        {!props.connReady && <p className="muted center">Connecting to server…</p>}

        <div className="divider"><span>or join one</span></div>

        <label className="field-label" htmlFor="room-code-input">6‑digit code</label>
        <div className="join-row">
          <input
            id="room-code-input"
            className="input mono code-input"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
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
            disabled={input.length !== 6 || !props.connReady || props.busy === 'joining'}
            onClick={() => props.onJoin(input)}
          >
            {props.busy === 'joining' ? <Loader2 size={18} className="spin" /> : 'Join'}
          </button>
        </div>
        {props.error && <p className="error-text" role="alert">{props.error}</p>}
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

      <div className="card">
        <textarea
          className="input textarea"
          rows={3}
          placeholder="Paste or type text to share…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="btn btn-primary"
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
            <div key={item.id} className="card clip-item">
              <div className="clip-meta">
                <strong>{item.fromDevice}</strong>
                <span className="muted">{new Date(item.timestamp).toLocaleTimeString()}</span>
              </div>
              <p className="clip-content">{item.content}</p>
              <button className="btn btn-ghost" onClick={async () => {
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
          <button className="btn btn-ghost btn-sm" onClick={props.onClear}>
            <Trash2 size={14} /> Clear
          </button>
        )}
      </div>
      {props.entries.length === 0 ? (
        <p className="muted">No transfers yet.</p>
      ) : (
        <div className="clip-list">
          {props.entries.map((e) => (
            <div key={e.id} className="card history-item">
              <div className="history-row">
                <span className="transfer-name" title={e.name}>{e.name}</span>
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
            <div key={t.id} className="transfer-row">
              <div className="transfer-top">
                <span className="transfer-name-wrap">
                  {/* F4: thumbnail for received images */}
                  {t.blobUrl && t.type.startsWith('image/') && (
                    <img className="transfer-thumb" src={t.blobUrl} alt="" aria-hidden />
                  )}
                  <span className="transfer-name" title={t.name}>{t.name}</span>
                </span>
                <span className="transfer-badges">
                  {t.channel && (
                    <span className={`badge ${t.channel === 'direct' ? 'badge-success' : 'badge-neutral'}`}>
                      {t.channel === 'direct' ? 'Direct' : 'Relayed (slower)'}
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
              <div className="transfer-actions">
                {t.status === 'completed' && t.direction === 'receiving' && t.blobUrl && (
                  <button className="btn btn-primary btn-sm" onClick={() => props.onSave(t)}><Download size={14} /> Save</button>
                )}
                {t.status === 'completed' && t.savedToDisk && (
                  <span className="muted small">Already saved via file picker</span>
                )}
                {(t.status === 'transferring' || t.status === 'connecting' || t.status === 'waiting') && (
                  <button className="btn btn-danger-ghost btn-sm" onClick={() => props.onCancel(t.id)}><X size={14} /> Cancel</button>
                )}
                {(t.status === 'failed' || t.status === 'expired') && t.direction === 'sending' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => props.onRetry(t)}><RefreshCw size={14} /> Retry</button>
                )}
              </div>
            </div>
          ))}
          <div className="transfer-actions">
            {completedReceives.length >= 2 && (
              <button className="btn btn-ghost btn-sm" onClick={props.onSaveAllZip}>
                <Archive size={14} /> Save all {completedReceives.length} as ZIP
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={props.onClear}>Clear finished</button>
          </div>
        </div>
      )}
    </div>
  );
}

function statusLabel(t: TransferFile): string {
  switch (t.status) {
    case 'waiting': return 'Waiting';
    case 'connecting': return 'Connecting';
    case 'transferring': return `${Math.round(t.progress)}%`;
    case 'completed': return 'Done';
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
                  <button className="btn btn-primary btn-sm" onClick={() => props.onAcceptAll(fromId)}>
                    <Check size={14} /> Accept all {reqs.length}
                  </button>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => props.onAccept(reqs[0])}>
                    <Check size={14} /> Accept
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => props.onAccept(reqs[0], true)}>
                  Always accept from this device
                </button>
                <button className="btn btn-danger-ghost btn-sm" onClick={() => reqs.forEach(props.onDecline)}>
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
      <div className="modal card" role="dialog" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="icon-btn subtle" onClick={props.onClose} aria-label="Close"><X size={18} /></button>
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
  onClose: () => void;
  onSave: (name: string, serverUrl: string, publicUrl: string, theme: Theme) => void;
  onClearTrusted: () => void;
}) {
  const [name, setName] = useState(props.deviceName);
  const [server, setServer] = useState(props.serverUrl);
  const [pub, setPub] = useState(props.publicUrl);
  const [th, setTh] = useState<Theme>(props.theme);
  return (
    <Modal title="Settings" onClose={props.onClose}>
      <label className="field-label" htmlFor="set-name">Device name</label>
      <input id="set-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />

      <label className="field-label">Theme</label>
      <div className="seg-row" role="radiogroup" aria-label="Theme">
        {(['auto', 'dark', 'light'] as Theme[]).map((opt) => (
          <button
            key={opt}
            role="radio"
            aria-checked={th === opt}
            className={`btn btn-sm ${th === opt ? 'btn-primary' : 'btn-ghost'}`}
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
        <button className="btn btn-ghost btn-sm" onClick={props.onClearTrusted}>
          Forget {props.autoAcceptCount} trusted device{props.autoAcceptCount > 1 ? 's' : ''}
        </button>
      )}

      <div className="modal-actions">
        <button className="btn btn-primary" onClick={() => props.onSave(name, server.trim(), pub.trim(), th)}>Save</button>
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
  const report = [
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
  return (
    <Modal title="Diagnostics" onClose={props.onClose}>
      <pre className="diag mono">{report}</pre>
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={async () => {
          const ok = await copyText(report);
          props.pushToast(ok ? 'success' : 'error', ok ? 'Diagnostics copied' : 'Copy failed');
        }}><Copy size={14} /> Copy diagnostics</button>
      </div>
    </Modal>
  );
}

function RenameModal(props: { current: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(props.current);
  return (
    <Modal title="Rename this device" onClose={props.onClose}>
      <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => setName(generateFriendlyName())}>Randomize</button>
        <button className="btn btn-primary" onClick={() => props.onSave(name)}>Save</button>
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
        <button className="btn btn-primary" disabled={!text.trim()} onClick={() => props.onSend(text.trim())}>
          <Send size={14} /> Send
        </button>
      </div>
    </Modal>
  );
}
