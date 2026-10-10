import React, { useState } from 'react';
import { 
  Settings as SettingsIcon, 
  X, 
  Laptop, 
  Smartphone, 
  Monitor, 
  Terminal, 
  Check, 
  ShieldCheck
} from 'lucide-react';
import { Platform } from '../types';
import { sound } from '../utils/audio';
import { safeGetStorage, safeSetStorage } from '../services/network';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  deviceName: string;
  onSaveDeviceName: (name: string) => void;
  platform: Platform;
  onSavePlatform: (platform: Platform) => void;
  autoAccept: boolean;
  onToggleAutoAccept: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  deviceName,
  onSaveDeviceName,
  platform,
  onSavePlatform,
  autoAccept,
  onToggleAutoAccept,
}) => {
  const [nameInput, setNameInput] = useState(deviceName);
  const [serverInput, setServerInput] = useState(() => safeGetStorage('mog_custom_ws_url') || '');
  const [publicUrlInput, setPublicUrlInput] = useState(() => safeGetStorage('mog_public_url') || '');
  const [showTabs, setShowTabs] = useState(() => safeGetStorage('mog_show_tabs') === 'true');
  const [turnUrlInput, setTurnUrlInput] = useState(() => safeGetStorage('mog_turn_url') || '');

  if (!isOpen) return null;

  const handleSave = () => {
    sound.playPop();
    if (nameInput.trim()) {
      onSaveDeviceName(nameInput.trim());
    }

    // Save custom ws url
    if (serverInput.trim()) {
      safeSetStorage('mog_custom_ws_url', serverInput.trim());
    } else {
      try { localStorage.removeItem('mog_custom_ws_url'); } catch {}
    }

    // Save public url (R6)
    if (publicUrlInput.trim()) {
      safeSetStorage('mog_public_url', publicUrlInput.trim());
    } else {
      try { localStorage.removeItem('mog_public_url'); } catch {}
    }

    // Save show other tabs toggle (D8)
    safeSetStorage('mog_show_tabs', showTabs ? 'true' : 'false');

    // Save TURN settings (T1)
    if (turnUrlInput.trim()) {
      safeSetStorage('mog_turn_url', turnUrlInput.trim());
    } else {
      try { localStorage.removeItem('mog_turn_url'); } catch {}
    }

    onClose();
  };

  const platforms: { id: Platform; label: string; icon: React.ReactNode }[] = [
    { id: 'macos', label: 'Mac', icon: <Laptop className="w-4 h-4" /> },
    { id: 'ios', label: 'iPhone / iPad', icon: <Smartphone className="w-4 h-4" /> },
    { id: 'windows', label: 'Windows', icon: <Monitor className="w-4 h-4" /> },
    { id: 'android', label: 'Android', icon: <Smartphone className="w-4 h-4" /> },
    { id: 'linux', label: 'Linux', icon: <Terminal className="w-4 h-4" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-pop">
      <div className="mog-card p-6 max-w-lg w-full bg-[var(--bg-card)] rounded-2xl relative shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2.5">
            <SettingsIcon className="w-5 h-5 text-[var(--accent-primary)]" />
            <h3 className="text-base font-bold text-[var(--text-main)] m-0">
              Preferences & Configuration
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

        <div className="space-y-4">
          {/* Device Name */}
          <div>
            <label className="text-xs font-semibold text-[var(--text-main)] block mb-1">
              Device Name
            </label>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="w-full mog-input text-xs"
              placeholder="e.g. Swift Falcon"
            />
          </div>

          {/* Platform Selector */}
          <div>
            <label className="text-xs font-semibold text-[var(--text-main)] block mb-2">
              Device Type
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {platforms.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    sound.playPop();
                    onSavePlatform(p.id);
                  }}
                  className={`p-2 rounded-xl border flex items-center gap-2 text-xs font-medium cursor-pointer transition-all ${
                    platform === p.id
                      ? 'border-[var(--accent-primary)] bg-[var(--bg-card-subtle)] text-[var(--accent-primary)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-app)] text-[var(--text-muted)] hover:border-[var(--border-active)]'
                  }`}
                >
                  {p.icon}
                  <span>{p.label}</span>
                  {platform === p.id && <Check className="w-3.5 h-3.5 ml-auto stroke-[2.5]" />}
                </button>
              ))}
            </div>
          </div>

          {/* D8: Show other tabs toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]">
            <div className="pr-3">
              <span className="text-xs font-semibold text-[var(--text-main)] block">
                Show Other Tabs (Testing)
              </span>
              <span className="text-[11px] text-[var(--text-muted)] block mt-0.5">
                Enable local browser tabs in Nearby Devices for testing on a single machine.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                sound.playPop();
                setShowTabs(!showTabs);
              }}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                showTabs ? 'bg-[var(--accent-primary)]' : 'bg-zinc-700'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-[var(--bg-card)] absolute top-1 transition-transform ${
                  showTabs ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>

          {/* Auto-Accept Toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]">
            <div className="pr-3">
              <span className="text-xs font-semibold text-[var(--text-main)] block">
                Global Auto-Accept Files
              </span>
              <span className="text-[11px] text-[var(--text-muted)] block mt-0.5">
                Automatically accept all incoming file requests without confirmation.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                sound.playPop();
                onToggleAutoAccept();
              }}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                autoAccept ? 'bg-emerald-500' : 'bg-zinc-700'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                  autoAccept ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>

          {/* R6: Public URL for QR codes */}
          <div>
            <label className="text-xs font-semibold text-[var(--text-main)] block mb-1">
              Public Deployment URL (Optional for QR Links)
            </label>
            <input
              type="text"
              value={publicUrlInput}
              onChange={(e) => setPublicUrlInput(e.target.value)}
              className="w-full mog-input text-xs font-mono"
              placeholder="e.g. https://mog-share.vercel.app or http://192.168.1.100:5173"
            />
            <span className="text-[11px] text-[var(--text-muted)] block mt-1">
              Used when generating room QR codes so other mobile phones open the right address.
            </span>
          </div>

          {/* Custom Signaling Server (D2) */}
          <div>
            <label className="text-xs font-semibold text-[var(--text-main)] block mb-1">
              Custom WebSocket Server URL (Optional)
            </label>
            <input
              type="text"
              value={serverInput}
              onChange={(e) => setServerInput(e.target.value)}
              className="w-full mog-input text-xs font-mono"
              placeholder="e.g. wss://mog-share-server.onrender.com/ws"
            />
            <span className="text-[11px] text-[var(--text-muted)] block mt-1">
              Leave blank to auto-connect to the same origin server.
            </span>
          </div>

          {/* Custom TURN Server (T1) */}
          <div>
            <label className="text-xs font-semibold text-[var(--text-main)] block mb-1">
              Custom TURN Server URL (Optional)
            </label>
            <input
              type="text"
              value={turnUrlInput}
              onChange={(e) => setTurnUrlInput(e.target.value)}
              className="w-full mog-input text-xs font-mono"
              placeholder="e.g. turn:turn.your-domain.com:3478"
            />
            <span className="text-[11px] text-[var(--text-muted)] block mt-1">
              Used for WebRTC relay across strict symmetric NATs.
            </span>
          </div>

          {/* Privacy Note */}
          <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] flex items-start gap-2.5 text-xs text-[var(--text-muted)]">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="m-0 text-[11px] leading-relaxed">
              Transfers establish true peer-to-peer WebRTC DataChannels whenever possible. Files never store on any intermediate server.
            </p>
          </div>

          {/* Actions */}
          <div className="pt-2 flex justify-end gap-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => {
                sound.playPop();
                onClose();
              }}
              className="mog-btn mog-btn-secondary !min-h-[38px] !text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="mog-btn mog-btn-primary !min-h-[38px] !text-xs font-semibold"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
