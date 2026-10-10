import React, { useState } from 'react';
import { 
  Activity, 
  Copy, 
  Check, 
  X
} from 'lucide-react';
import { DiagnosticsData } from '../types';
import { sound } from '../utils/audio';

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: DiagnosticsData;
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({
  isOpen,
  onClose,
  data,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    sound.playPop();
    const text = JSON.stringify(data, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-pop">
      <div className="mog-card p-6 max-w-lg w-full bg-[var(--bg-card)] rounded-2xl relative shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-[var(--accent-primary)]" />
            <h3 className="text-base font-bold text-[var(--text-main)] m-0">
              System Diagnostics
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mog-btn-icon !min-w-[32px] !min-h-[32px] !p-1 text-[var(--text-muted)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Diagnostic Items */}
        <div className="space-y-2.5 text-xs mb-6">
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <span className="text-[var(--text-muted)]">Connection State:</span>
            <span className="font-semibold text-[var(--text-main)] capitalize">
              {data.connectionState}
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <span className="text-[var(--text-muted)]">Active Protocol:</span>
            <span className="font-semibold text-[var(--text-main)] uppercase">
              {data.activeMode} (WebSockets + WebRTC)
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <span className="text-[var(--text-muted)]">Server Endpoint:</span>
            <span className="font-mono text-[11px] text-[var(--accent-primary)] truncate max-w-[220px]">
              {data.serverUrl || 'None (Connecting)'}
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <span className="text-[var(--text-muted)]">Network Key (Group Hash):</span>
            <span className="font-mono text-[11px] text-[var(--text-main)]">
              {data.networkKey || 'Pending'}
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <span className="text-[var(--text-muted)]">Device ID:</span>
            <span className="font-mono text-[11px] text-[var(--text-main)] truncate max-w-[200px]">
              {data.deviceId}
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <span className="text-[var(--text-muted)]">WebRTC DataChannel Support:</span>
            <span className={`font-semibold ${data.rtcSupported ? 'text-emerald-400' : 'text-amber-400'}`}>
              {data.rtcSupported ? 'Available (Direct P2P Ready)' : 'Relay Fallback Only'}
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <span className="text-[var(--text-muted)]">ICE Candidate Types:</span>
            <span className="font-mono text-[11px] text-[var(--text-main)]">
              {data.iceCandidateTypes.length > 0 ? data.iceCandidateTypes.join(', ') : 'Gathering on transfer'}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={handleCopy}
            className="mog-btn mog-btn-secondary !min-h-[38px] !text-xs font-semibold gap-1.5"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Copied to Clipboard</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Diagnostics</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="mog-btn mog-btn-primary !min-h-[38px] !text-xs font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
