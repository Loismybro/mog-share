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

  const copyToLocal = (id: string, text: string) => {
    sound.playPop();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-pop">
      <div className="neo-box p-6 max-w-lg w-full bg-[#131722] border-3 border-[#2a324b] shadow-[8px_8px_0px_#000] relative text-white">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b-2 border-[#2a324b] mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#FFC900] border-2 border-black flex items-center justify-center">
              <Clipboard className="w-5 h-5 text-black stroke-[2.5]" />
            </div>
            <h3 className="text-base font-black uppercase text-white m-0 font-mono">
              Universal Clipboard Sync
            </h3>
          </div>
          <button
            onClick={() => {
              sound.playPop();
              onClose();
            }}
            className="p-1 rounded-lg hover:bg-[#1e2436] text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSend} className="space-y-2 mb-5">
          <label className="text-xs font-bold text-slate-400 block uppercase font-mono">
            Broadcast text, tokens, or links to all connected devices:
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Paste or type text to broadcast..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="flex-1 px-4 py-2.5 rounded-xl border-3 border-[#2a324b] bg-[#0e111a] text-white text-xs font-mono font-bold shadow-[2px_2px_0px_#000] focus:outline-none focus:border-[#FFC900]"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="neo-btn neo-btn-yellow px-4 py-2.5 text-xs font-black uppercase disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5 stroke-[3]" />
              <span>Broadcast</span>
            </button>
          </div>
        </form>

        {/* Received Items */}
        <div>
          <span className="text-xs font-black uppercase text-slate-300 block mb-2 font-mono">
            Synced Clipboard Feed ({receivedItems.length})
          </span>

          {receivedItems.length === 0 ? (
            <div className="p-4 rounded-xl border-2 border-dashed border-[#2a324b] text-center text-xs text-slate-500 font-medium italic bg-[#0e111a]">
              No synced clipboard items yet. Any device sharing clipboard will appear here instantly.
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
              {receivedItems.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-xl bg-[#1a1f2e] border-2 border-[#2a324b] flex items-center justify-between text-xs shadow-[2px_2px_0px_#000]"
                >
                  <div className="min-w-0 pr-2">
                    <p className="font-mono font-bold text-slate-200 truncate m-0 select-all">
                      {item.content}
                    </p>
                    <p className="text-[10px] text-slate-400 font-medium flex items-center gap-1.5 mt-0.5 m-0">
                      <span>From {item.fromDevice}</span>
                      <span>•</span>
                      <Clock className="w-2.5 h-2.5" />
                      <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => copyToLocal(item.id, item.content)}
                    className="neo-btn neo-btn-mint p-2 text-black shrink-0"
                    title="Copy to Clipboard"
                  >
                    {copiedId === item.id ? (
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 stroke-[3]" />
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
