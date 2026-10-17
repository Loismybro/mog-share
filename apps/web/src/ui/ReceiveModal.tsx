import React from 'react';
import {
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  Check,
  X,
  ShieldCheck,
  Sparkles,
  Laptop,
  Smartphone,
} from 'lucide-react';
import type { IncomingRequest } from '../types';

interface ReceiveModalProps {
  request: IncomingRequest | null;
  onAccept: () => void;
  onDecline: () => void;
}

export const ReceiveModal: React.FC<ReceiveModalProps> = ({
  request,
  onAccept,
  onDecline,
}) => {
  if (!request) return null;

  const formatSize = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (type: string, name: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-sky-400" />;
    if (type.startsWith('video/')) return <Film className="w-4 h-4 text-indigo-400" />;
    if (type.startsWith('audio/')) return <Music className="w-4 h-4 text-emerald-400" />;
    if (
      name.endsWith('.zip') ||
      name.endsWith('.rar') ||
      name.endsWith('.7z') ||
      name.endsWith('.tar.gz')
    ) {
      return <Archive className="w-4 h-4 text-amber-400" />;
    }
    return <FileText className="w-4 h-4 text-slate-300" />;
  };

  const senderName = request.fromName || request.from?.name || 'Nearby Peer';
  const senderPlatform = String(request.fromPlatform || request.from?.platform || 'web');
  const filesList =
    request.files && request.files.length > 0
      ? request.files
      : request.meta
      ? [request.meta]
      : [];
  const totalBytes =
    request.totalSize ?? filesList.reduce((acc, f) => acc + (f.size || 0), 0);

  const isMobile =
    senderPlatform.toLowerCase() === 'android' || senderPlatform.toLowerCase() === 'ios';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="relative w-full max-w-md rounded-2xl mog-glass border border-white/15 p-6 shadow-2xl overflow-hidden">
        {/* Ambient top glow */}
        <div
          className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-36 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, rgba(56,189,248,0.28) 0%, rgba(99,102,241,0.08) 60%, transparent 100%)',
          }}
        />

        {/* Header */}
        <div className="relative flex items-center gap-3.5 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-400/20 to-indigo-500/20 border border-sky-400/35 flex items-center justify-center text-sky-300 shrink-0">
            {isMobile ? <Smartphone className="w-6 h-6" /> : <Laptop className="w-6 h-6" />}
          </div>
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-sky-400 font-semibold">
              <Sparkles className="w-3 h-3" />
              <span>Incoming P2P Beam</span>
            </div>
            <h3 className="text-lg font-bold text-white truncate">{senderName}</h3>
            <p className="text-xs text-slate-400">
              {request.fromModel || senderPlatform} • {filesList.length}{' '}
              {filesList.length === 1 ? 'file' : 'files'} ({formatSize(totalBytes)})
            </p>
          </div>
        </div>

        {/* File list */}
        <div className="max-h-52 overflow-y-auto space-y-2 mb-5 pr-1">
          {filesList.map((file, idx) => (
            <div
              key={`${file.name}-${idx}`}
              className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white/[0.04] border border-white/10"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                  {getFileIcon(file.type || '', file.name)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-100 truncate">
                    {file.name}
                  </p>
                  <p className="text-[11px] font-mono text-slate-400">
                    {formatSize(file.size)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Security footer badge */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 mb-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>SHA-256 block-verified encrypted stream</span>
          </div>
          {request.sasEmoji && (
            <span className="font-mono text-xs" title={`SAS: ${request.sasNumeric || ''}`}>
              {request.sasEmoji}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onDecline}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl mog-btn-secondary text-xs font-bold text-slate-300 hover:text-rose-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
            <span>Decline</span>
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl mog-btn-primary text-xs font-bold cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Accept & Save</span>
          </button>
        </div>
      </div>
    </div>
  );
};
