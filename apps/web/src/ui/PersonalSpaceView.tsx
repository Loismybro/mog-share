import { useState, useMemo } from 'react';
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
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { zipSync } from 'fflate';
import { formatBytes } from '../utils/formatters';
import {
  type PersonalSpaceItem,
  type FileCategory,
  deleteFromPersonalSpace,
  clearPersonalSpace,
  openFileWithSystemShare,
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

  // Category stats calculation
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

  // Filtering and Sorting
  const filteredItems = useMemo(() => {
    let list = items;
    if (selectedCategory !== 'all') {
      list = list.filter((i) => i.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((i) => i.name.toLowerCase().includes(q) || (i.senderName || '').toLowerCase().includes(q));
    }

    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'newest': return b.receivedAt - a.receivedAt;
        case 'oldest': return a.receivedAt - b.receivedAt;
        case 'largest': return b.size - a.size;
        case 'smallest': return a.size - b.size;
        case 'name': return a.name.localeCompare(b.name);
        default: return 0;
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

  const handleDeleteItem = async (item: PersonalSpaceItem) => {
    await deleteFromPersonalSpace(item.id);
    props.onRefresh();
    props.pushToast('info', `Removed ${item.name} from Personal Space`);
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} file(s) from Personal Space?`)) return;
    for (const id of selectedIds) {
      await deleteFromPersonalSpace(id);
    }
    clearSelection();
    props.onRefresh();
    props.pushToast('info', 'Deleted selected files');
  };

  const handleDownloadItem = (item: PersonalSpaceItem) => {
    let url = item.blobUrl;
    let cleanup = false;
    if (!url && item.blob) {
      url = URL.createObjectURL(item.blob);
      cleanup = true;
    }
    if (!url) {
      props.pushToast('error', 'File data unavailable to save');
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (cleanup) {
      setTimeout(() => URL.revokeObjectURL(url!), 10_000);
    }
    props.pushToast('success', `Saved ${item.name}`);
  };

  const handleDownloadSelectedZip = async () => {
    const selectedFiles = items.filter((i) => selectedIds.has(i.id) && (i.blob || i.blobUrl));
    if (selectedFiles.length === 0) return;

    try {
      props.pushToast('info', `Compressing ${selectedFiles.length} files…`);
      const entries: Record<string, Uint8Array> = {};
      for (const item of selectedFiles) {
        let buf: ArrayBuffer;
        if (item.blob) {
          buf = await item.blob.arrayBuffer();
        } else if (item.blobUrl) {
          buf = await (await fetch(item.blobUrl)).arrayBuffer();
        } else {
          continue;
        }
        let name = item.name;
        let n = 1;
        while (entries[name]) {
          name = `${n++}_${item.name}`;
        }
        entries[name] = new Uint8Array(buf);
      }

      const zipped = zipSync(entries, { level: 0 });
      const copy = new Uint8Array(zipped.length);
      copy.set(zipped);
      const zipBlob = new Blob([copy.buffer], { type: 'application/zip' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mog-space-export-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      props.pushToast('success', `Exported ${selectedFiles.length} files as ZIP`);
    } catch (err) {
      console.error(err);
      props.pushToast('error', 'Could not create ZIP archive');
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Wipe all files from your Personal Space? This cannot be undone.')) return;
    await clearPersonalSpace();
    props.onRefresh();
    props.pushToast('info', 'Personal Space cleared');
  };

  const renderCategoryIcon = (cat: FileCategory, size = 18) => {
    switch (cat) {
      case 'images': return <ImageIcon size={size} />;
      case 'videos': return <Film size={size} />;
      case 'audio': return <Music size={size} />;
      case 'documents': return <FileText size={size} />;
      case 'apps': return <Box size={size} />;
      case 'archives': return <Archive size={size} />;
      default: return <Folder size={size} />;
    }
  };

  return (
    <div className="view personal-space-view">
      {/* View Header */}
      <div className="space-header">
        <div>
          <div className="badge badge-brutal badge-pale-lavender mb-1">
            <HardDrive size={13} /> PERSONAL VAULT
          </div>
          <h1 className="view-title">Personal Space</h1>
          <p className="view-sub">
            All files received on this device. Inspect, listen, watch, share, or export anytime.
          </p>
        </div>
      </div>

      {/* Storage Meter & Category Breakdown Banner */}
      <div className="card brutal-card storage-banner pale-lavender-bg">
        <div className="storage-top">
          <div className="storage-stat">
            <span className="mono small font-bold text-uppercase tracking-wider">SPACE USED</span>
            <div className="storage-number font-extrabold">{formatBytes(stats.totalBytes)}</div>
          </div>
          <div className="storage-count-pill mono small font-bold">
            {items.length} {items.length === 1 ? 'FILE' : 'FILES'} STORED
          </div>
        </div>

        {/* Category breakdown chips */}
        <div className="category-pill-row">
          <button
            className={`cat-chip ${selectedCategory === 'all' ? 'cat-chip-active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            <Layers size={13} /> All ({items.length})
          </button>
          {stats.catCounts.images > 0 && (
            <button
              className={`cat-chip cat-chip-butter ${selectedCategory === 'images' ? 'cat-chip-active' : ''}`}
              onClick={() => setSelectedCategory('images')}
            >
              <ImageIcon size={13} /> Photos ({stats.catCounts.images})
            </button>
          )}
          {stats.catCounts.audio > 0 && (
            <button
              className={`cat-chip cat-chip-lavender ${selectedCategory === 'audio' ? 'cat-chip-active' : ''}`}
              onClick={() => setSelectedCategory('audio')}
            >
              <Music size={13} /> Music ({stats.catCounts.audio})
            </button>
          )}
          {stats.catCounts.videos > 0 && (
            <button
              className={`cat-chip cat-chip-peach ${selectedCategory === 'videos' ? 'cat-chip-active' : ''}`}
              onClick={() => setSelectedCategory('videos')}
            >
              <Film size={13} /> Videos ({stats.catCounts.videos})
            </button>
          )}
          {stats.catCounts.documents > 0 && (
            <button
              className={`cat-chip cat-chip-mint ${selectedCategory === 'documents' ? 'cat-chip-active' : ''}`}
              onClick={() => setSelectedCategory('documents')}
            >
              <FileText size={13} /> Docs ({stats.catCounts.documents})
            </button>
          )}
          {stats.catCounts.apps > 0 && (
            <button
              className={`cat-chip cat-chip-cyan ${selectedCategory === 'apps' ? 'cat-chip-active' : ''}`}
              onClick={() => setSelectedCategory('apps')}
            >
              <Box size={13} /> Apps ({stats.catCounts.apps})
            </button>
          )}
          {stats.catCounts.archives > 0 && (
            <button
              className={`cat-chip cat-chip-rose ${selectedCategory === 'archives' ? 'cat-chip-active' : ''}`}
              onClick={() => setSelectedCategory('archives')}
            >
              <Archive size={13} /> Archives ({stats.catCounts.archives})
            </button>
          )}
        </div>
      </div>

      {/* Filter / Search & Action Controls Toolbar */}
      <div className="vault-toolbar">
        <div className="search-box">
          <Search size={16} className="search-icon muted" />
          <input
            type="text"
            className="input search-input"
            placeholder="Search received files…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="sort-box">
          <select
            className="select-brutal mono small"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="largest">Largest size</option>
            <option value="smallest">Smallest size</option>
            <option value="name">Name (A-Z)</option>
          </select>

          <button
            className={`btn btn-brutal btn-sm ${isSelectMode ? 'btn-pale-butter' : 'btn-ghost-brutal'}`}
            onClick={() => {
              setIsSelectMode(!isSelectMode);
              if (isSelectMode) clearSelection();
            }}
          >
            {isSelectMode ? 'Cancel' : 'Select'}
          </button>
        </div>
      </div>

      {/* Bulk action bar if selection active */}
      {isSelectMode && (
        <div className="card brutal-card bulk-action-bar pale-butter-bg">
          <div className="bulk-info mono font-bold small">
            {selectedIds.size} of {filteredItems.length} selected
          </div>
          <div className="bulk-actions">
            <button className="btn btn-brutal btn-xs" onClick={selectAll}>Select All</button>
            <button className="btn btn-brutal btn-xs" onClick={clearSelection}>Deselect</button>
            <button
              className="btn btn-brutal btn-primary-brutal btn-xs"
              disabled={selectedIds.size === 0}
              onClick={handleDownloadSelectedZip}
            >
              <Download size={13} /> Export ZIP ({selectedIds.size})
            </button>
            <button
              className="btn btn-brutal btn-danger-brutal btn-xs"
              disabled={selectedIds.size === 0}
              onClick={handleDeleteSelected}
            >
              <Trash2 size={13} /> Delete ({selectedIds.size})
            </button>
          </div>
        </div>
      )}

      {/* File List / Grid */}
      {filteredItems.length === 0 ? (
        <div className="card brutal-card empty-vault pale-paper-bg">
          <div className="empty-vault-icon">
            <Folder size={42} />
          </div>
          <h3 className="font-extrabold text-lg">No files in Personal Space</h3>
          <p className="muted small center max-w-sm">
            {searchQuery || selectedCategory !== 'all'
              ? 'No files matched your filter criteria.'
              : 'Files received from Android or PC devices will be safely kept in this Personal Space so you can open, play, and share them anytime!'}
          </p>
        </div>
      ) : (
        <div className="vault-grid">
          {filteredItems.map((item) => {
            const isSelected = selectedIds.has(item.id);
            const isImage = item.category === 'images' && item.blobUrl;

            return (
              <div
                key={item.id}
                className={`card brutal-card vault-file-card ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  if (isSelectMode) toggleSelect(item.id);
                  else props.onOpenFile(item);
                }}
              >
                {/* Selection checkbox */}
                {isSelectMode && (
                  <button
                    className="select-checkbox-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(item.id);
                    }}
                  >
                    {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                )}

                {/* File Thumbnail / Visual Header */}
                <div className={`vault-file-thumb ${item.category}-bg`}>
                  {isImage ? (
                    <img src={item.blobUrl} alt={item.name} className="vault-thumb-img" />
                  ) : (
                    <div className="vault-thumb-icon">
                      {renderCategoryIcon(item.category, 32)}
                    </div>
                  )}
                  <span className="vault-cat-badge badge-brutal">
                    {item.category.toUpperCase()}
                  </span>
                </div>

                {/* File Details */}
                <div className="vault-file-info">
                  <h4 className="vault-file-name font-bold" title={item.name}>
                    {item.name}
                  </h4>
                  <div className="vault-file-meta mono small muted">
                    <span>{formatBytes(item.size)}</span>
                    <span>•</span>
                    <span>{new Date(item.receivedAt).toLocaleDateString()}</span>
                  </div>
                  {item.senderName && (
                    <div className="vault-file-sender small font-medium">
                      From: <strong>{item.senderName}</strong>
                      {item.channel && (
                        <span className="badge badge-brutal badge-xs ml-2" style={{ padding: '1px 6px', fontSize: '10px' }}>
                          {item.channel === 'direct' ? '⚡ Direct' : '☁ Relay'}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Direct Action Buttons on Card */}
                {!isSelectMode && (
                  <div className="vault-file-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn btn-brutal btn-primary-brutal btn-sm flex-1"
                      onClick={() => props.onOpenFile(item)}
                      title="Open and preview file in app"
                    >
                      <Eye size={14} /> Open
                    </button>
                    <button
                      className="btn btn-brutal btn-ghost-brutal btn-sm"
                      onClick={() => handleDownloadItem(item)}
                      title="Download to device"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      className="btn btn-brutal btn-ghost-brutal btn-sm"
                      onClick={async () => {
                        let shared = false;
                        if (item.blob) {
                          shared = await openFileWithSystemShare(item.blob, item.name, item.type);
                        }
                        if (!shared) {
                          const url = item.blobUrl || (item.blob ? URL.createObjectURL(item.blob) : null);
                          if (url) {
                            const win = window.open(url, '_blank');
                            if (!win) {
                              handleDownloadItem(item);
                            }
                          }
                        }
                      }}
                      title="Share / Open with system"
                    >
                      <Share2 size={14} />
                    </button>
                    <button
                      className="btn btn-brutal btn-danger-brutal btn-sm"
                      onClick={() => handleDeleteItem(item)}
                      title="Delete from space"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer Wipe option */}
      {items.length > 0 && (
        <div className="vault-footer">
          <button className="btn btn-brutal btn-danger-brutal btn-sm" onClick={handleClearAll}>
            <Trash2 size={14} /> Wipe All Personal Space Files
          </button>
        </div>
      )}
    </div>
  );
}
