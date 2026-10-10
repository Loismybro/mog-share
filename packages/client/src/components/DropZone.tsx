import React, { useRef, useState, useEffect } from 'react';
import { 
  UploadCloud, 
  File as FileIcon, 
  FileText, 
  Image as ImageIcon, 
  Film, 
  Archive, 
  X, 
  Send,
  AlertTriangle,
  FolderPlus
} from 'lucide-react';
import { formatBytes } from '../utils/formatters';
import { isExecutableFile } from '../utils/security';
import { sound } from '../utils/audio';
import { Device } from '../types';

interface DropZoneProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  targetDevice: Device | null;
  onSend: () => void;
  isSending?: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({
  files,
  onFilesChange,
  targetDevice,
  onSend,
  isSending = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // F3: Listen for Ctrl/Cmd+V clipboard paste of files or screenshots
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData || !e.clipboardData.files || e.clipboardData.files.length === 0) return;
      const pastedFiles = Array.from(e.clipboardData.files);
      sound.playPop();
      onFilesChange([...files, ...pastedFiles]);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [files, onFilesChange]);

  // F4: Generate thumbnails for image files
  useEffect(() => {
    const newThumbs: Record<string, string> = {};
    for (const file of files) {
      if (file.type.startsWith('image/') && file.size < 20 * 1024 * 1024) {
        newThumbs[file.name] = URL.createObjectURL(file);
      }
    }
    setThumbnails(newThumbs);

    return () => {
      Object.values(newThumbs).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  // F3: Folder & file drop recursive reader
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const droppedFiles: File[] = [];
      const queue: any[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (typeof item.webkitGetAsEntry === 'function') {
          const entry = item.webkitGetAsEntry();
          if (entry) queue.push(entry);
        } else {
          const file = item.getAsFile();
          if (file) droppedFiles.push(file);
        }
      }

      while (queue.length > 0) {
        const entry = queue.shift();
        if (entry.isFile) {
          await new Promise<void>((resolve) => {
            entry.file((file: File) => {
              droppedFiles.push(file);
              resolve();
            });
          });
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const entries = await new Promise<any[]>((resolve) => {
            reader.readEntries((results: any[]) => resolve(results));
          });
          queue.push(...entries);
        }
      }

      if (droppedFiles.length > 0) {
        sound.playPop();
        onFilesChange([...files, ...droppedFiles]);
        return;
      }
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      sound.playPop();
      onFilesChange([...files, ...Array.from(e.dataTransfer.files)]);
    }
  };

  const removeFile = (index: number) => {
    sound.playPop();
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-emerald-400" />;
    if (file.type.startsWith('video/')) return <Film className="w-4 h-4 text-purple-400" />;
    if (file.type.includes('pdf') || file.type.includes('text')) return <FileText className="w-4 h-4 text-blue-400" />;
    if (file.name.endsWith('.zip') || file.name.endsWith('.tar') || file.name.endsWith('.gz')) {
      return <Archive className="w-4 h-4 text-amber-400" />;
    }
    return <FileIcon className="w-4 h-4 text-slate-400" />;
  };

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  const hasExecutable = files.some((f) => isExecutableFile(f.name));
  const hasLargeFileOnMobile =
    typeof navigator !== 'undefined' &&
    /iphone|ipad|android/i.test(navigator.userAgent) &&
    files.some((f) => f.size > 500 * 1024 * 1024);

  return (
    <div className="w-full max-w-xl mx-auto px-4 mb-6">
      <input
        type="file"
        id="mog-file-input"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            sound.playPop();
            onFilesChange([...files, ...Array.from(e.target.files)]);
            e.target.value = '';
          }
        }}
        multiple
        className="sr-only"
        tabIndex={-1}
      />

      <input
        type="file"
        id="mog-folder-input"
        ref={folderInputRef}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            sound.playPop();
            onFilesChange([...files, ...Array.from(e.target.files)]);
            e.target.value = '';
          }
        }}
        {...({ webkitdirectory: '', directory: '' } as any)}
        multiple
        className="sr-only"
        tabIndex={-1}
      />

      {/* Main drop surface */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`mog-card p-5 border-dashed transition-all relative overflow-hidden ${
          isDragOver
            ? 'border-[var(--accent-primary)] bg-[var(--bg-elevated)] scale-[1.01]'
            : 'hover:border-[var(--border-active)]'
        }`}
      >
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <label
              htmlFor="mog-file-input"
              className="cursor-pointer group flex flex-col items-center justify-center w-full"
            >
              <div className="w-12 h-12 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center mb-3 group-hover:scale-105 transition-transform text-[var(--accent-primary)]">
                <UploadCloud className="w-6 h-6 stroke-[2]" />
              </div>

              <h3 className="text-sm font-semibold text-[var(--text-main)] mb-1">
                Choose files or drag & drop here
              </h3>
              <p className="text-xs text-[var(--text-muted)] max-w-xs mb-4">
                Fast direct transfer. Paste screenshots with <kbd className="px-1 py-0.5 rounded bg-[var(--bg-app)] border border-[var(--border-subtle)] font-mono text-[10px]">Ctrl+V</kbd>.
              </p>

              <div className="flex items-center gap-2">
                <span className="mog-btn mog-btn-primary !min-h-[38px] !text-xs font-semibold select-none pointer-events-none">
                  Select Files
                </span>

                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    folderInputRef.current?.click();
                  }}
                  className="mog-btn mog-btn-secondary !min-h-[38px] !text-xs font-semibold gap-1.5"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>Folder</span>
                </button>
              </div>
            </label>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)] mb-3">
              <span className="text-xs font-semibold text-[var(--text-main)]">
                Selected Files ({files.length} • {formatBytes(totalBytes)})
              </span>

              <div className="flex items-center gap-2 text-xs">
                <label
                  htmlFor="mog-file-input"
                  className="text-[var(--accent-primary)] hover:underline cursor-pointer font-medium"
                >
                  + Add More
                </label>
                <span className="text-[var(--text-dim)]">•</span>
                <button
                  type="button"
                  onClick={() => onFilesChange([])}
                  className="text-red-400 hover:underline cursor-pointer font-medium"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* F11: Executable warning banner */}
            {hasExecutable && (
              <div className="mb-3 p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Executable file detected (.exe/.bat/.sh/.apk). Verify before opening on target device.</span>
              </div>
            )}

            {/* Mobile large file warning (Phase 3 T6) */}
            {hasLargeFileOnMobile && (
              <div className="mb-3 p-2.5 rounded-lg bg-blue-950/40 border border-blue-500/40 text-blue-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-blue-400 shrink-0" />
                <span>Files above 500 MB on mobile browsers stream in chunks; keep this tab open during transfer.</span>
              </div>
            )}

            {/* Queued file items with previews (F4) */}
            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
              {files.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    {thumbnails[file.name] ? (
                      <img
                        src={thumbnails[file.name]}
                        alt={file.name}
                        className="w-8 h-8 rounded object-cover border border-[var(--border-subtle)] shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-[var(--bg-card-subtle)] flex items-center justify-center shrink-0">
                        {getFileIcon(file)}
                      </div>
                    )}
                    <span className="truncate max-w-[200px] sm:max-w-[260px] font-medium text-[var(--text-main)]">
                      {file.name}
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)] shrink-0 font-mono">
                      {formatBytes(file.size)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="p-1 rounded hover:bg-[var(--bg-card-subtle)] text-[var(--text-dim)] hover:text-red-400 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sticky Bottom Bar when files are chosen (Phase 5) */}
      {files.length > 0 && (
        <div className="fixed bottom-16 sm:bottom-6 left-4 right-4 max-w-xl mx-auto z-40 animate-pop">
          <div className="p-3 mog-card rounded-2xl bg-[var(--bg-card)]/95 backdrop-blur-md shadow-2xl flex items-center justify-between gap-3 border border-[var(--accent-primary)]/40">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[var(--text-main)] truncate m-0">
                {files.length} {files.length === 1 ? 'file' : 'files'} ({formatBytes(totalBytes)})
              </p>
              <p className="text-[11px] text-[var(--text-muted)] truncate m-0">
                {targetDevice ? (
                  <>
                    Send to <strong className="text-[var(--accent-primary)]">{targetDevice.name}</strong>
                  </>
                ) : (
                  'Select a recipient device above'
                )}
              </p>
            </div>

            <button
              type="button"
              onClick={onSend}
              disabled={!targetDevice || isSending}
              className="mog-btn mog-btn-primary !min-h-[40px] !py-1 !px-4 text-xs font-semibold gap-1.5 shrink-0"
            >
              <Send className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{isSending ? 'Sending...' : 'Send Now'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
