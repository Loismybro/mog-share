import React, { useRef } from 'react';
import {
  FolderHeart,
  Plus,
  Trash2,
  Download,
  Send,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  HardDrive,
} from 'lucide-react';
import type { PersonalSpaceItem } from '../utils/personalSpace';

interface PersonalSpaceViewProps {
  items: PersonalSpaceItem[];
  onAddFiles: (files: FileList) => void;
  onRemoveItem: (id: string) => void;
  onClearAll: () => void;
  onStageItemForShare?: (item: PersonalSpaceItem) => void;
}

export const PersonalSpaceView: React.FC<PersonalSpaceViewProps> = ({
  items,
  onAddFiles,
  onRemoveItem,
  onClearAll,
  onStageItemForShare,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatSize = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-sky-400" />;
    if (type.startsWith('video/')) return <Film className="w-4 h-4 text-indigo-400" />;
    if (type.startsWith('audio/')) return <Music className="w-4 h-4 text-emerald-400" />;
    return <FileText className="w-4 h-4 text-slate-300" />;
  };

  const handleDownload = (item: PersonalSpaceItem) => {
    const url = item.blobUrl || (item.blob ? URL.createObjectURL(item.blob) : undefined);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-4">
      <div className="mog-glass rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400">
            <FolderHeart className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Personal Vault</h2>
            <p className="text-xs text-slate-400">
              Pin frequently shared or received files in IndexedDB for 1-click beaming
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onAddFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
          {items.length > 0 && (
            <button
              onClick={onClearAll}
              className="px-3 py-2 rounded-xl mog-btn-secondary text-xs font-semibold text-slate-300 hover:text-rose-300 flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Vault</span>
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-2 rounded-xl mog-btn-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Files to Vault</span>
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mog-glass rounded-2xl p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-3 text-slate-400">
            <HardDrive className="w-6 h-6" />
          </div>
          <p className="text-sm font-semibold text-slate-200 mb-1">
            Your Personal Vault is empty
          </p>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Store documents, archives, or media here to stage and beam them to any peer at any time.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="mog-glass-card rounded-xl p-3.5 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  {getIcon(item.type)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-100 truncate">{item.name}</p>
                  <p className="text-[11px] font-mono text-slate-400">
                    {formatSize(item.size)} • {new Date(item.receivedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {(item.blobUrl || item.blob) && (
                  <button
                    onClick={() => handleDownload(item)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title="Download"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                )}
                {onStageItemForShare && (item.blob || item.blobUrl) && (
                  <button
                    onClick={() => onStageItemForShare(item)}
                    className="p-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/30 text-sky-300 transition-colors cursor-pointer"
                    title="Stage for Sharing"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => onRemoveItem(item.id)}
                  className="p-2 rounded-lg bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition-colors cursor-pointer"
                  title="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
