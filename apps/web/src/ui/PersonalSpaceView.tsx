import { useState, useMemo, useRef } from 'react';
import {
  Folder,
  HardDrive,
  Download,
  Trash2,
  Search,
  Eye,
  Share2,
  Archive,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  Box,
  Layers,
  CheckSquare,
  Square,
  Plus,
} from 'lucide-react';
import { zipSync } from 'fflate';
import { formatBytes } from '../utils/formatters';
import {
  type PersonalSpaceItem,
  type FileCategory,
  saveToPersonalSpace,
  deleteFromPersonalSpace,
  clearPersonalSpace,
  openFileWithSystemShare,
  detectFileCategory,
} from '../utils/personalSpace';
import type { Device } from '../types';

export function PersonalSpaceView(props: {
  items: PersonalSpaceItem[];
  peers: Device[];
  onOpenFile: (item: PersonalSpaceItem) => void;
  onSendToPeer: (peer: Device, blob: Blob, name: string) => void;
  pushToast: (kind: 'success' | 'error' | 'info', msg: string) => void;
  onRefresh: () => void;
}) {
  const { items, peers } = props;
  const [selectedCategory, setSelectedCategory] = useState<FileCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'largest' | 'smallest' | 'name'>('newest');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const importInputRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => {
    let totalBytes = 0;
    const catBytes: Record<FileCategory, number> = {
      images: 0,
      videos: 0,
      audio: 0,
      documents: 0,
      apps: 0,
      archives: 0,
      other: 0,
    };
    const catCounts: Record<FileCategory, number> = {
      images: 0,
      videos: 0,
      audio: 0,
      documents: 0,
      apps: 0,
      archives: 0,
      other: 0,
    };

    for (const item of items) {
      totalBytes += item.size;
      const cat = item.category || 'other';
      catBytes[cat] = (catBytes[cat] || 0) + item.size;
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }

    return { totalBytes, catBytes, catCounts };
  }, [items]);

  const filteredItems = useMemo(() => {
    let list = items;
    if (selectedCategory !== 'all') {
      list = list.filter((i) => i.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (i) => i.name.toLowerCase().includes(q) || (i.senderName || '').toLowerCase().includes(q)
      );
    }

    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return b.receivedAt - a.receivedAt;
        case 'oldest':
          return a.receivedAt - b.receivedAt;
        case 'largest':
          return b.size - a.size;
        case 'smallest':
          return a.size - b.size;
        case 'name':
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });
  }, [items, selectedCategory, searchQuery, sortBy]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredItems.map((i) => i.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleImportFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    let count = 0;
    for (const f of Array.from(fileList)) {
      await saveToPersonalSpace({
        id: `vault_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: f.name,
        size: f.size,
        type: f.type || 'application/octet-stream',
        category: detectFileCategory(f.name, f.type),
        senderName: 'This Device',
        receivedAt: Date.now(),
        blob: f,
      });
      count++;
    }
    props.onRefresh();
    props.pushToast('success', `Added ${count} file${count > 1 ? 's' : ''} to Saved Files`);
    if (importInputRef.current) importInputRef.current.value = '';
  };

  const handleDeleteItem = async (item: PersonalSpaceItem) => {
    await deleteFromPersonalSpace(item.id);
    props.onRefresh();
    props.pushToast('info', `Deleted ${item.name}`);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      await deleteFromPersonalSpace(id);
    }
    setSelectedIds(new Set());
    setIsSelectMode(false);
    props.onRefresh();
    props.pushToast('info', `Removed ${selectedIds.size} files`);
  };

  const handleDownloadSingle = (item: PersonalSpaceItem) => {
    let url = item.blobUrl;
    let created = false;
    if (!url && item.blob) {
      url = URL.createObjectURL(item.blob);
      created = true;
    }
    if (!url) {
      props.pushToast('error', 'File data is no longer in local storage');
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (created) {
      setTimeout(() => URL.revokeObjectURL(url!), 10_000);
    }
  };

  const handleExportZip = async (targetItems: PersonalSpaceItem[]) => {
    const valid = targetItems.filter((i) => i.blob || i.blobUrl);
    if (valid.length === 0) {
      props.pushToast('error', 'No downloadable files to zip');
      return;
    }
    try {
      const entries: Record<string, Uint8Array> = {};
      for (const item of valid) {
        let buf: ArrayBuffer;
        if (item.blob) {
          buf = await item.blob.arrayBuffer();
        } else if (item.blobUrl) {
          buf = await (await fetch(item.blobUrl)).arrayBuffer();
        } else {
          continue;
        }
        let name = item.name.replace(/[/\\:*?"<>|]/g, '_');
        let idx = 1;
        while (entries[name]) {
          name = `${idx++}_${item.name}`;
        }
        entries[name] = new Uint8Array(buf);
      }

      const zipped = zipSync(entries, { level: 0 });
      const copy = new Uint8Array(zipped.length);
      copy.set(zipped);
      const blob = new Blob([copy.buffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MogShare-Files-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      props.pushToast('success', `Exported ${valid.length} files as ZIP`);
    } catch {
      props.pushToast('error', 'Failed to create ZIP archive');
    }
  };

  const categories: Array<{
    key: FileCategory | 'all';
    label: string;
    icon: React.ReactNode;
  }> = [
    { key: 'all', label: 'All Files', icon: <Layers size={14} /> },
    { key: 'images', label: 'Photos', icon: <ImageIcon size={14} /> },
    { key: 'videos', label: 'Videos', icon: <Film size={14} /> },
    { key: 'audio', label: 'Audio', icon: <Music size={14} /> },
    { key: 'documents', label: 'Docs', icon: <FileText size={14} /> },
    { key: 'apps', label: 'Apps', icon: <Box size={14} /> },
    { key: 'archives', label: 'Archives', icon: <Archive size={14} /> },
  ];

  const getCategoryIcon = (cat: FileCategory) => {
    switch (cat) {
      case 'images':
        return <ImageIcon size={28} />;
      case 'videos':
        return <Film size={28} />;
      case 'audio':
        return <Music size={28} />;
      case 'documents':
        return <FileText size={28} />;
      case 'apps':
        return <Box size={28} />;
      case 'archives':
        return <Archive size={28} />;
      default:
        return <Folder size={28} />;
    }
  };

  return (
    <div className="personal-space-view">
      <div className="section-header-row">
        <div>
          <h1 className="view-title">Saved Files</h1>
          <p className="view-sub">
            Received files are stored locally on your device so you can preview, download, or share them anytime.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => importInputRef.current?.click()}
            title="Add files from your device"
          >
            <Plus size={15} /> Add Files
          </button>
          {items.length > 0 && (
            <>
              <button
                className={`btn btn-sm ${isSelectMode ? 'btn-indigo' : 'btn-secondary'}`}
                onClick={() => {
                  setIsSelectMode(!isSelectMode);
                  setSelectedIds(new Set());
                }}
              >
                <CheckSquare size={14} /> {isSelectMode ? 'Done' : 'Select'}
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => void handleExportZip(items)}
                title="Download all saved files as ZIP"
              >
                <Archive size={14} /> Download All as ZIP
              </button>
            </>
          )}
        </div>
      </div>

      <input
        ref={importInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => void handleImportFiles(e.target.files)}
      />

      <div className="card storage-banner">
        <div className="storage-top">
          <div className="storage-stat">
            <span className="field-label" style={{ marginTop: 0 }}>
              Saved on This Device
            </span>
            <span className="storage-number mono">{formatBytes(stats.totalBytes)}</span>
          </div>
          <div className="storage-count-pill mono">
            {items.length} {items.length === 1 ? 'file' : 'files'}
          </div>
        </div>

        <div className="category-pill-row">
          {categories.map((cat) => {
            const count = cat.key === 'all' ? items.length : stats.catCounts[cat.key] || 0;
            const active = selectedCategory === cat.key;
            return (
              <button
                key={cat.key}
                className={`cat-chip ${active ? 'cat-chip-active' : ''}`}
                onClick={() => setSelectedCategory(cat.key)}
              >
                {cat.icon}
                <span>{cat.label}</span>
                <span className="cat-chip-count mono">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {items.length > 0 && (
        <div className="vault-toolbar">
          <div className="search-box">
            <Search size={16} className="search-icon muted" />
            <input
              type="text"
              className="input search-input"
              placeholder="Search saved files…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="sort-box">
            <select
              className="select-modern"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              aria-label="Sort files"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="largest">Largest Size</option>
              <option value="smallest">Smallest Size</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>
        </div>
      )}

      {isSelectMode && (
        <div className="card bulk-action-bar">
          <span className="font-bold small">
            {selectedIds.size} of {filteredItems.length} selected
          </span>
          <div className="bulk-actions">
            <button className="btn btn-xs btn-secondary" onClick={selectAll}>
              Select All
            </button>
            <button className="btn btn-xs btn-secondary" onClick={clearSelection}>
              Clear
            </button>
            <button
              className="btn btn-xs btn-primary"
              disabled={selectedIds.size === 0}
              onClick={() =>
                void handleExportZip(items.filter((i) => selectedIds.has(i.id)))
              }
            >
              <Archive size={13} /> ZIP Selected
            </button>
            <button
              className="btn btn-xs btn-danger"
              disabled={selectedIds.size === 0}
              onClick={() => void handleBulkDelete()}
            >
              <Trash2 size={13} /> Delete Selected
            </button>
          </div>
        </div>
      )}

      {filteredItems.length === 0 ? (
        <div className="card empty-vault">
          <div className="empty-vault-icon">
            <HardDrive size={28} />
          </div>
          <h3 className="font-bold" style={{ margin: 0 }}>
            {items.length === 0 ? 'No Saved Files Yet' : 'No Matching Files'}
          </h3>
          <p className="muted small center" style={{ maxWidth: 400, margin: 0 }}>
            {items.length === 0
              ? 'Files you receive from other devices are automatically saved here for easy viewing and downloading.'
              : 'Try clearing your search or selecting All Files above.'}
          </p>
        </div>
      ) : (
        <div className="vault-grid">
          {filteredItems.map((item) => {
            const isSelected = selectedIds.has(item.id);
            return (
              <div
                key={item.id}
                className={`card vault-file-card ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  if (isSelectMode) toggleSelect(item.id);
                  else props.onOpenFile(item);
                }}
              >
                {isSelectMode && (
                  <button
                    className="select-checkbox-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(item.id);
                    }}
                    aria-label={isSelected ? 'Deselect file' : 'Select file'}
                  >
                    {isSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                  </button>
                )}

                <div className={`vault-file-thumb ${item.category}-bg`}>
                  {item.category === 'images' && item.blobUrl ? (
                    <img src={item.blobUrl} alt={item.name} className="vault-thumb-img" />
                  ) : (
                    <div className="vault-thumb-icon">{getCategoryIcon(item.category)}</div>
                  )}
                  <span className="badge vault-cat-badge">{item.category.toUpperCase()}</span>
                </div>

                <div className="vault-file-info">
                  <h4 className="vault-file-name" title={item.name}>
                    {item.name}
                  </h4>
                  <div className="vault-file-meta muted mono">
                    <span>{formatBytes(item.size)}</span>
                    <span>·</span>
                    <span>{new Date(item.receivedAt).toLocaleDateString()}</span>
                  </div>
                  <div className="vault-file-sender">From: {item.senderName || 'Device'}</div>
                </div>

                <div className="vault-file-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-xs btn-primary flex-1"
                    onClick={() => props.onOpenFile(item)}
                  >
                    <Eye size={13} /> Open
                  </button>
                  <button
                    className="btn btn-xs btn-secondary"
                    onClick={() => handleDownloadSingle(item)}
                    title="Save to device"
                  >
                    <Download size={13} />
                  </button>
                  {item.blob && peers.length > 0 && (
                    <button
                      className="btn btn-xs btn-secondary"
                      onClick={() => props.onSendToPeer(peers[0], item.blob!, item.name)}
                      title={`Send to ${peers[0].name}`}
                    >
                      <Share2 size={13} />
                    </button>
                  )}
                  {item.blob && typeof navigator !== 'undefined' && 'canShare' in navigator && (
                    <button
                      className="btn btn-xs btn-secondary"
                      onClick={() => void openFileWithSystemShare(item.blob!, item.name, item.type)}
                      title="System Share"
                    >
                      <Share2 size={13} />
                    </button>
                  )}
                  <button
                    className="btn btn-xs btn-danger"
                    onClick={() => void handleDeleteItem(item)}
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {items.length > 0 && (
        <div className="vault-footer">
          <button
            className="btn btn-sm btn-danger"
            onClick={async () => {
              await clearPersonalSpace();
              props.onRefresh();
              props.pushToast('info', 'Saved files cleared');
            }}
          >
            <Trash2 size={14} /> Clear All Saved Files
          </button>
        </div>
      )}
    </div>
  );
}
