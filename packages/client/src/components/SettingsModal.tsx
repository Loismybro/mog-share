import React, { useState } from 'react';
import { 
  Settings as SettingsIcon, 
  X, 
  Laptop, 
  Smartphone, 
  Monitor, 
  Terminal, 
  Check, 
  Shield 
} from 'lucide-react';
import { Platform } from '../types';
import { sound } from '../utils/audio';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  deviceName: string;
  onSaveDeviceName: (name: string) => void;
  platform: Platform;
  onSavePlatform: (platform: Platform) => void;
  autoAccept: boolean;
  onToggleAutoAccept: () => void;
  wsStatus?: 'connected' | 'connecting' | 'disconnected';
  networkMode?: 'server' | 'mesh' | 'offline';
  lanHash?: string;
  publicIp?: string;
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
  wsStatus = 'connected',
  networkMode = 'mesh',
  lanHash,
  publicIp,
}) => {
  const [nameInput, setNameInput] = useState(deviceName);
  const [serverInput, setServerInput] = useState(() => localStorage.getItem('mog_custom_ws_url') || '');

  if (!isOpen) return null;

  const handleSave = () => {
    sound.playPop();
    if (nameInput.trim()) {
      onSaveDeviceName(nameInput.trim());
    }
    const currentCustom = localStorage.getItem('mog_custom_ws_url') || '';
    if (serverInput.trim() !== currentCustom) {
      if (serverInput.trim()) {
        localStorage.setItem('mog_custom_ws_url', serverInput.trim());
      } else {
        localStorage.removeItem('mog_custom_ws_url');
      }
      window.location.reload();
      return;
    }
    onClose();
  };

  const platforms: { id: Platform; label: string; icon: React.ReactNode; color: string }[] = [
    { id: 'macos', label: 'Mac', icon: <Laptop className="w-4 h-4" />, color: 'bg-[#60A5FA]' },
    { id: 'ios', label: 'iPhone / iPad', icon: <Smartphone className="w-4 h-4" />, color: 'bg-[#FF90E8]' },
    { id: 'windows', label: 'Windows', icon: <Monitor className="w-4 h-4" />, color: 'bg-[#FFC900]' },
    { id: 'android', label: 'Android', icon: <Smartphone className="w-4 h-4" />, color: 'bg-[#00F59B]' },
    { id: 'linux', label: 'Linux', icon: <Terminal className="w-4 h-4" />, color: 'bg-[#D3B5FF]' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-pop">
      <div className="neo-box p-6 max-w-md w-full bg-[#131722] border-3 border-[#2a324b] shadow-[8px_8px_0px_#000] relative text-white">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b-2 border-[#2a324b] mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#FFC900] border-2 border-black flex items-center justify-center">
              <SettingsIcon className="w-5 h-5 text-black stroke-[2.5]" />
            </div>
            <h3 className="text-base font-black uppercase text-white m-0 font-mono">
              Hardware Profile & Settings
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

        <div className="space-y-4">
          {/* Device Name */}
          <div>
            <label className="text-xs font-bold text-slate-400 block mb-1 uppercase font-mono">
              Device Broadcast Name
            </label>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border-3 border-[#2a324b] bg-[#0e111a] text-white text-sm font-bold shadow-[2px_2px_0px_#000] focus:outline-none focus:border-[#FFC900]"
              placeholder="e.g. MacBook Pro M3"
            />
          </div>

          {/* Platform Selector */}
          <div>
            <label className="text-xs font-bold text-slate-400 block mb-2 uppercase font-mono">
              Operating System / Device Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {platforms.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    sound.playPop();
                    onSavePlatform(p.id);
                  }}
                  className={`p-2.5 rounded-xl border-2 border-black flex items-center gap-2 text-xs font-bold cursor-pointer transition-all shadow-[2px_2px_0px_#000] ${
                    platform === p.id
                      ? `${p.color} text-black -translate-y-0.5 shadow-[4px_4px_0px_#000]`
                      : 'bg-[#1a1f2e] text-slate-300 hover:bg-[#22293d] border-[#2a324b]'
                  }`}
                >
                  {p.icon}
                  <span>{p.label}</span>
                  {platform === p.id && <Check className="w-4 h-4 ml-auto stroke-[3]" />}
                </button>
              ))}
            </div>
          </div>

          {/* Auto-Accept */}
          <div className="pt-2">
            <div className="flex items-center justify-between p-3.5 rounded-xl border-2 border-[#2a324b] bg-[#1a1f2e] shadow-[2px_2px_0px_#000]">
              <div className="pr-3">
                <span className="text-xs font-black uppercase text-white block font-mono">
                  Auto-Accept Transfers
                </span>
                <span className="text-[11px] font-medium text-slate-400 block mt-0.5">
                  Automatically save incoming files from peers
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  sound.playPop();
                  onToggleAutoAccept();
                }}
                className={`w-12 h-7 rounded-full border-2 border-black transition-colors relative cursor-pointer ${
                  autoAccept ? 'bg-[#00F59B]' : 'bg-zinc-700'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white border border-black absolute top-0.5 transition-transform ${
                    autoAccept ? 'left-5' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Active Network Diagnostics */}
          <div className="p-3 rounded-xl border-2 border-[#2a324b] bg-[#161a28] shadow-[2px_2px_0px_#000]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-black uppercase text-slate-300 font-mono">
                Network Protocol
              </span>
              <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                wsStatus === 'connected'
                  ? 'bg-emerald-950/80 border-emerald-500/60 text-[#00F59B]'
                  : wsStatus === 'connecting'
                  ? 'bg-amber-950/80 border-amber-500/60 text-amber-300'
                  : 'bg-rose-950/80 border-rose-500/60 text-rose-300'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  wsStatus === 'connected' ? 'bg-[#00F59B]' : wsStatus === 'connecting' ? 'bg-amber-400' : 'bg-rose-500'
                }`} />
                {wsStatus === 'connected'
                  ? networkMode === 'server' ? 'Custom Server' : 'Cloud Mesh Active'
                  : wsStatus === 'connecting' ? 'Connecting...' : 'Offline'}
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 space-y-0.5">
              <p className="m-0 flex items-center justify-between">
                <span>Relay Engine:</span>
                <span className="text-slate-200 font-bold">
                  {serverInput ? 'Custom WebSocket' : 'Zero-Config Mesh (WSS Relay)'}
                </span>
              </p>
              {lanHash && (
                <p className="m-0 flex items-center justify-between">
                  <span>LAN Subnet Node:</span>
                  <span className="text-[#FFC900] font-bold">{lanHash}</span>
                </p>
              )}
              {publicIp && (
                <p className="m-0 flex items-center justify-between">
                  <span>Public IP Mask:</span>
                  <span className="text-slate-300 font-bold">{publicIp.slice(0, 7)}***</span>
                </p>
              )}
            </div>
          </div>

          {/* Custom Signaling Relay (Optional) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-400 uppercase font-mono">
                Signaling Relay Server (Optional)
              </label>
              {serverInput && (
                <button
                  type="button"
                  onClick={() => setServerInput('')}
                  className="text-[10px] font-mono text-[#60A5FA] hover:underline cursor-pointer"
                >
                  Reset to Auto Mesh
                </button>
              )}
            </div>
            <input
              type="text"
              value={serverInput}
              onChange={(e) => setServerInput(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border-3 border-[#2a324b] bg-[#0e111a] text-white text-xs font-mono shadow-[2px_2px_0px_#000] focus:outline-none focus:border-[#FFC900]"
              placeholder="e.g. wss://relay.your-domain.com/ws (leave blank for Auto Mesh)"
            />
            <span className="text-[10px] text-slate-500 block mt-1 font-mono">
              Leave blank to automatically use the high-speed Cloud Mesh (100% free, works on GitHub Pages).
            </span>
          </div>

          {/* Privacy Footnote */}
          <div className="p-3 rounded-xl border-2 border-[#2a324b] bg-[#161a28] flex items-start gap-2.5 text-xs text-slate-300 shadow-[2px_2px_0px_#000]">
            <Shield className="w-4 h-4 shrink-0 mt-0.5 stroke-[2.5] text-[#00F59B]" />
            <p className="m-0 text-[11px] leading-relaxed font-medium">
              MOG-SHARE is 100% peer-to-peer. Zero files ever touch any cloud server. LAN mode never leaves your local Wi-Fi router.
            </p>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              onClick={() => {
                sound.playPop();
                onClose();
              }}
              className="neo-btn neo-btn-dark px-4 py-2.5 text-xs font-bold uppercase"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="neo-btn neo-btn-yellow px-5 py-2.5 text-xs font-black uppercase text-black"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
