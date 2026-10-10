import React, { useState } from 'react';
import { 
  Clipboard, 
  Send, 
  Copy, 
  Check, 
  X, 
  Clock 
} from 'lucide-react';
import { ClipboardItem } from '../types';
import { sound } from '../utils/audio';

interface ClipboardSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBroadcastClipboard: (content: string) => void;
  receivedItems: ClipboardItem[];
}

export const ClipboardSyncModal: React.FC<ClipboardSyncModalProps> = ({
  isOpen,
  onClose,
  onBroadcastClipboard,
  receivedItems,
}) => {
  const [inputText, setInputText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    sound.playPop();
    onBroadcastClipboard(inputText.trim());
    setInputText('');
  };

  // F2: Robust copy with fallback to execCommand for HTTP LAN pages
  const copyToLocal = (id: string, text: string) => {
    sound.playPop();

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }

    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const fallbackCopy = (text: string) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-pop">
      <div className="mog-card p-6 max-w-lg w-full bg-[var(--bg-card)] rounded-2xl relative shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2.5">
            <Clipboard className="w-5 h-5 text-[var(--accent-primary)]" />
            <h3 className="text-base font-bold text-[var(--text-main)] m-0">
              Universal Clipboard Sync
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              sound.playPop();
              onClose();
            }}
            className="mog-btn-icon !min-w-[32px] !min-h-[32px] !p-1 text-[var(--text-muted)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSend} className="space-y-2 mb-5">
          <label className="text-xs font-medium text-[var(--text-muted)] block">
            Broadcast text or links to all connected devices on this network:
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Paste or type text to share..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="flex-1 mog-input text-xs"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="mog-btn mog-btn-primary !min-h-[44px] !px-4 text-xs font-semibold gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </div>
        </form>

        {/* Received Items */}
        <div>
          <span className="text-xs font-semibold text-[var(--text-muted)] block mb-2">
            Synced Clipboard Feed ({receivedItems.length})
          </span>

          {receivedItems.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-[var(--border-subtle)] text-center text-xs text-[var(--text-dim)] bg-[var(--bg-app)]">
              No synced clipboard items yet. When another device shares clipboard text, it will appear here instantly.
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
              {receivedItems.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] flex items-center justify-between text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <p className="font-mono text-[var(--text-main)] truncate m-0 select-all">
                      {item.content}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5 mt-0.5 m-0">
                      <span>From {item.fromDevice}</span>
                      <span>•</span>
                      <Clock className="w-2.5 h-2.5 text-[var(--text-dim)]" />
                      <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToLocal(item.id, item.content)}
                    className="mog-btn mog-btn-secondary !min-h-[32px] !min-w-[32px] !p-1.5 text-xs shrink-0"
                    title="Copy to Clipboard"
                  >
                    {copiedId === item.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
