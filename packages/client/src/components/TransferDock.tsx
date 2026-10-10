import React, { useState } from 'react';
import { 
  ArrowUp, 
  ArrowDown, 
  CheckCircle, 
  Download, 
  ChevronUp, 
  ChevronDown,
  RotateCcw,
  Archive,
  FileIcon,
  X
} from 'lucide-react';
import { TransferFile } from '../types';
import { formatBytes, formatSpeed, formatTime } from '../utils/formatters';
import { sound } from '../utils/audio';
import * as fflate from 'fflate';

interface TransferDockProps {
  transfers: TransferFile[];
  onCancelTransfer: (id: string) => void;
  onRetryTransfer?: (id: string) => void;
  onClearCompleted: () => void;
  onSaveFile: (transfer: TransferFile) => void;
}

export const TransferDock: React.FC<TransferDockProps> = ({
  transfers,
  onCancelTransfer,
  onRetryTransfer,
  onClearCompleted,
  onSaveFile,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  if (transfers.length === 0) return null;

  const activeTransfers = transfers.filter(
    (t) => t.status === 'transferring' || t.status === 'connecting' || t.status === 'waiting'
  );
  const primaryActive = activeTransfers[0];
  const completedTransfers = transfers.filter((t) => t.status === 'completed' && t.blobUrl);

  // F3: Download All as ZIP using fflate
  const handleDownloadAllZip = async () => {
    if (completedTransfers.length === 0 || isZipping) return;
    setIsZipping(true);
    sound.playPop();

    try {
      const zipEntries: Record<string, Uint8Array> = {};

      for (const item of completedTransfers) {
        if (item.blobUrl) {
          const res = await fetch(item.blobUrl);
          const buf = await res.arrayBuffer();
          zipEntries[item.name] = new Uint8Array(buf);
        }
      }

      fflate.zip(zipEntries, (err, out) => {
        setIsZipping(false);
        if (err || !out) return;

        const blob = new Blob([out as unknown as BlobPart], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mog_share_bundle_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1000);
      });
    } catch (e) {
      setIsZipping(false);
      console.error('ZIP generation error:', e);
    }
  };

  const getStatusLabel = (t: TransferFile) => {
    switch (t.status) {
      case 'transferring':
        return `${t.progress}%`;
      case 'connecting':
        return 'Connecting...';
      case 'waiting':
        return 'Waiting...';
      case 'completed':
        return 'Completed';
      case 'failed':
        return t.errorReason || 'Failed';
      case 'declined':
        return 'Declined';
      case 'expired':
        return 'Expired (no response)';
      case 'cancelled':
        return 'Cancelled';
      default:
        return t.status;
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 max-w-2xl mx-auto px-4 pb-2 sm:pb-4 animate-pop">
      <div className="mog-card rounded-2xl bg-[var(--bg-card)]/95 backdrop-blur-md shadow-2xl border border-[var(--border-subtle)] overflow-hidden">
        {/* Header Bar */}
        <div className="p-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {primaryActive ? (
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-primary)] text-[var(--accent-primary-text)] flex items-center justify-center shrink-0">
                {primaryActive.direction === 'sending' ? (
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                ) : (
                  <ArrowDown className="w-4 h-4 stroke-[2.5]" />
                )}
              </div>
            ) : (
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <CheckCircle className="w-4 h-4 stroke-[2.5]" />
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--text-main)] truncate">
                  {primaryActive ? (
                    <>
                      {primaryActive.direction === 'sending' ? 'Sending to ' : 'Receiving from '}
                      <span className="text-[var(--accent-primary)]">{primaryActive.peerName}</span>
                    </>
                  ) : (
                    <span>All Transfers Finished ({completedTransfers.length})</span>
                  )}
                </span>

                {primaryActive && (
                  <span className="text-[11px] font-mono font-bold text-[var(--text-muted)]">
                    {primaryActive.progress}%
                  </span>
                )}
              </div>

              {primaryActive && (
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] mt-0.5">
                  <span className="font-mono">{formatSpeed(primaryActive.speedBytesPerSec)}</span>
                  <span>•</span>
                  <span>ETA {formatTime(primaryActive.etaSeconds)}</span>
                  <span>•</span>
                  <span className={`mog-badge ${primaryActive.relayed ? 'mog-badge-relayed' : 'mog-badge-direct'} !text-[10px]`}>
                    {primaryActive.relayed ? 'Relayed' : 'Direct'}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {completedTransfers.length > 1 && (
              <button
                type="button"
                onClick={handleDownloadAllZip}
                disabled={isZipping}
                title="Download all received files as a single ZIP (F3)"
                className="mog-btn mog-btn-secondary !min-h-[32px] !py-1 !px-2.5 !text-xs font-semibold gap-1.5"
              >
                <Archive className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isZipping ? 'Zipping...' : 'Download ZIP'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                sound.playPop();
                setIsExpanded(!isExpanded);
              }}
              className="mog-btn-icon !min-w-[32px] !min-h-[32px] !p-1.5"
              title="Toggle transfer sheet"
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Linear progress bar for primary active transfer */}
        {primaryActive && (
          <div className="w-full h-1.5 bg-[var(--bg-app)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent-primary)] transition-all duration-150"
              style={{ width: `${primaryActive.progress}%` }}
            />
          </div>
        )}

        {/* Expanded Sheet: List of all files in session */}
        {isExpanded && (
          <div className="p-3.5 pt-2 border-t border-[var(--border-subtle)] max-h-60 overflow-y-auto space-y-2">
            <div className="flex items-center justify-between text-xs pb-1">
              <span className="font-medium text-[var(--text-muted)]">Transfer Activity</span>
              {completedTransfers.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    sound.playPop();
                    onClearCompleted();
                  }}
                  className="text-xs text-[var(--accent-primary)] hover:underline font-medium"
                >
                  Clear Completed
                </button>
              )}
            </div>

            {transfers.map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-xl bg-[var(--bg-card-subtle)] border border-[var(--border-subtle)] flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt={item.name}
                      className="w-8 h-8 rounded object-cover border border-[var(--border-subtle)] shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded bg-[var(--bg-elevated)] flex items-center justify-center shrink-0 text-[var(--text-muted)]">
                      <FileIcon className="w-4 h-4" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[var(--text-main)] truncate m-0">
                      {item.name}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] mt-0.5">
                      <span>{formatBytes(item.size)}</span>
                      <span>•</span>
                      <span>{item.direction === 'sending' ? 'To ' : 'From '}{item.peerName}</span>
                      <span>•</span>
                      <span className={item.status === 'completed' ? 'text-emerald-400 font-medium' : item.status === 'failed' ? 'text-red-400 font-medium' : ''}>
                        {getStatusLabel(item)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Per-row Actions: Save, Cancel, Retry */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {item.status === 'completed' && item.blobUrl && (
                    <button
                      type="button"
                      onClick={() => onSaveFile(item)}
                      title="Save File to Disk (T8)"
                      className="mog-btn mog-btn-primary !min-h-[32px] !py-1 !px-2.5 !text-xs font-semibold gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Save</span>
                    </button>
                  )}

                  {(item.status === 'transferring' || item.status === 'connecting' || item.status === 'waiting') && (
                    <button
                      type="button"
                      onClick={() => {
                        sound.playPop();
                        onCancelTransfer(item.id);
                      }}
                      title="Cancel Transfer (T4)"
                      className="p-1.5 text-[var(--text-dim)] hover:text-red-400 rounded-lg hover:bg-[var(--bg-app)]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}

                  {(item.status === 'failed' || item.status === 'expired' || item.status === 'cancelled') && onRetryTransfer && (
                    <button
                      type="button"
                      onClick={() => {
                        sound.playPop();
                        onRetryTransfer(item.id);
                      }}
                      title="Retry Transfer (T9)"
                      className="p-1.5 text-[var(--text-dim)] hover:text-[var(--accent-primary)] rounded-lg hover:bg-[var(--bg-app)]"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
