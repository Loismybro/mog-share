import React, { useState } from 'react';
import { 
  Send, 
  X, 
  MessageSquare
} from 'lucide-react';
import { Device } from '../types';
import { sound } from '../utils/audio';

interface DirectMessageModalProps {
  targetDevice: Device | null;
  onClose: () => void;
  onSendMessage: (targetPeerId: string, text: string) => void;
}

export const DirectMessageModal: React.FC<DirectMessageModalProps> = ({
  targetDevice,
  onClose,
  onSendMessage,
}) => {
  const [text, setText] = useState('');

  if (!targetDevice) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    sound.playPop();
    onSendMessage(targetDevice.id, text.trim());
    setText('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-pop">
      <div className="mog-card p-6 max-w-md w-full bg-[var(--bg-card)] rounded-2xl relative shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[var(--accent-primary)]" />
            <div>
              <h3 className="text-base font-bold text-[var(--text-main)] m-0">
                Send Text or Link
              </h3>
              <p className="text-xs text-[var(--text-muted)] m-0">
                Direct to <strong className="text-[var(--accent-primary)]">{targetDevice.name}</strong>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mog-btn-icon !min-w-[32px] !min-h-[32px] !p-1 text-[var(--text-muted)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type message, note, URL, or code snippet to send..."
              className="w-full mog-input !min-h-[100px] resize-none"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="mog-btn mog-btn-secondary !min-h-[38px] !text-xs font-semibold"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={!text.trim()}
              className="mog-btn mog-btn-primary !min-h-[38px] !text-xs font-semibold gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send Message</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
