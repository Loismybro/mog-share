import React from 'react';
import { 
  Download, 
  X, 
  ShieldCheck, 
  FileIcon,
  CheckCheck
} from 'lucide-react';
import { Device, FileMeta } from '../types';
import { formatBytes } from '../utils/formatters';
import { isExecutableFile } from '../utils/security';
import { sound } from '../utils/audio';

export interface QueuedIncomingItem {
  transferId: string;
  fromPeer: Device;
  fileMeta: FileMeta;
  receivedAt: number;
}

interface IncomingTransferSheetProps {
  incomingQueue: QueuedIncomingItem[];
  onAccept: (transferId: string) => void;
  onDecline: (transferId: string) => void;
  onAcceptAllFromPeer: (peerId: string) => void;
  onAlwaysAcceptFromPeer: (peerId: string) => void;
}

export const IncomingTransferSheet: React.FC<IncomingTransferSheetProps> = ({
  incomingQueue,
  onAccept,
  onDecline,
  onAcceptAllFromPeer,
  onAlwaysAcceptFromPeer,
}) => {
  if (incomingQueue.length === 0) return null;

  // Group queued items by sender
  const groupedBySender = incomingQueue.reduce<Record<string, QueuedIncomingItem[]>>((acc, item) => {
    const pid = item.fromPeer.id;
    if (!acc[pid]) acc[pid] = [];
    acc[pid].push(item);
    return acc;
  }, {});

  return (
    <div className="fixed top-16 sm:top-20 right-4 left-4 sm:left-auto sm:w-96 z-50 animate-pop space-y-3 pointer-events-auto">
      {Object.entries(groupedBySender).map(([peerId, items]) => {
        const sender = items[0].fromPeer;
        const totalSize = items.reduce((acc, i) => acc + i.fileMeta.size, 0);
        const containsExecutable = items.some((i) => isExecutableFile(i.fileMeta.name));

        return (
          <div
            key={peerId}
            className="mog-card p-4 bg-[var(--bg-card)]/95 backdrop-blur-md border border-[var(--accent-primary)]/50 shadow-2xl rounded-2xl"
          >
            {/* Header: Sender info */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border-subtle)]">
              <div>
                <p className="text-xs font-bold text-[var(--text-main)] m-0">
                  Incoming files from <span className="text-[var(--accent-primary)]">{sender.name}</span>
                </p>
                <p className="text-[11px] text-[var(--text-muted)] m-0 mt-0.5">
                  {items.length} {items.length === 1 ? 'file' : 'files'} • {formatBytes(totalSize)}
                </p>
              </div>

              {/* Accept All (T3) */}
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    sound.playPop();
                    onAcceptAllFromPeer(peerId);
                  }}
                  className="mog-btn mog-btn-primary !min-h-[28px] !py-0.5 !px-2 !text-[11px] font-semibold gap-1"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Accept All</span>
                </button>
              )}
            </div>

            {/* Executable warning banner (F11) */}
            {containsExecutable && (
              <div className="mb-2 p-2 rounded-lg bg-amber-950/40 border border-amber-500/40 text-amber-200 text-[11px]">
                Warning: Executable file in queue. Review contents before accepting.
              </div>
            )}

            {/* List of items from this sender */}
            <div className="max-h-40 overflow-y-auto space-y-2 pr-1 mb-3">
              {items.map((item) => (
                <div
                  key={item.transferId}
                  className="p-2 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FileIcon className="w-4 h-4 text-[var(--accent-primary)] shrink-0" />
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--text-main)] truncate m-0">
                        {item.fileMeta.name}
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)] font-mono m-0">
                        {formatBytes(item.fileMeta.size)}
                      </p>
                    </div>
                  </div>

                  {/* Individual actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        sound.playPop();
                        onAccept(item.transferId);
                      }}
                      title="Accept this file"
                      className="p-1.5 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        sound.playPop();
                        onDecline(item.transferId);
                      }}
                      title="Decline this file"
                      className="p-1.5 rounded-md hover:bg-[var(--bg-card-subtle)] text-[var(--text-dim)] hover:text-red-400"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer action: Always accept from this device (F6) */}
            <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  sound.playPop();
                  onAlwaysAcceptFromPeer(peerId);
                }}
                className="text-[11px] text-[var(--text-muted)] hover:text-emerald-400 flex items-center gap-1 transition-colors"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Always accept from this device</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  sound.playPop();
                  items.forEach((i) => onDecline(i.transferId));
                }}
                className="text-[11px] text-red-400 hover:underline"
              >
                Decline All
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
