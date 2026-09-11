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

  if (!isOpen) return null;

  const handleSave = () => {
    sound.playPop();
    if (nameInput.trim()) {
      onSaveDeviceName(nameInput.trim());
    }
    onClose();
  };

  const platforms: { id: Platform; label: string; icon: React.ReactNode; color: string }[] = [
    { id: 'macos', label: 'Mac', icon: <Laptop className="w-4 h-4" />, color: 'bg-[#90B8F8]' },
    { id: 'ios', label: 'iPhone / iPad', icon: <Smartphone className="w-4 h-4" />, color: 'bg-[#FF90E8]' },
    { id: 'windows', label: 'Windows', icon: <Monitor className="w-4 h-4" />, color: 'bg-[#FFC900]' },
    { id: 'android', label: 'Android', icon: <Smartphone className="w-4 h-4" />, color: 'bg-[#00F59B]' },
    { id: 'linux', label: 'Linux', icon: <Terminal className="w-4 h-4" />, color: 'bg-[#D3B5FF]' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="neo-box p-6 max-w-md w-full bg-white border-3 border-black shadow-[8px_8px_0px_#000] relative">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b-2 border-black mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#FFC900] border-2 border-black flex items-center justify-center">
              <SettingsIcon className="w-5 h-5 text-black stroke-[2.5]" />
            </div>
            <h3 className="text-base font-black uppercase text-black m-0">
              Hardware Profile & Settings
            </h3>
          </div>
          <button
            onClick={() => {
              sound.playPop();
              onClose();
            }}
            className="p-1 rounded-lg hover:bg-slate-100 text-black cursor-pointer"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Device Name */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1 uppercase">
              Device Broadcast Name
            </label>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border-3 border-black text-sm font-bold shadow-[2px_2px_0px_#000] focus:outline-none focus:ring-2 focus:ring-[#FFC900]"
              placeholder="e.g. MacBook Pro M3"
            />
          </div>

          {/* Platform Selector */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-2 uppercase">
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
                      : 'bg-white text-slate-700 hover:bg-slate-50'
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
            <div className="flex items-center justify-between p-3.5 rounded-xl border-2 border-black bg-slate-50 shadow-[2px_2px_0px_#000]">
              <div className="pr-3">
                <span className="text-xs font-black uppercase text-black block">
                  Auto-Accept Transfers
                </span>
                <span className="text-[11px] font-medium text-slate-600 block mt-0.5">
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
                  autoAccept ? 'bg-[#00F59B]' : 'bg-slate-300'
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

          {/* Privacy Footnote */}
          <div className="p-3 rounded-xl border-2 border-black bg-[#FF90E8]/20 flex items-start gap-2.5 text-xs text-black shadow-[2px_2px_0px_#000]">
            <Shield className="w-4 h-4 shrink-0 mt-0.5 stroke-[2.5]" />
            <p className="m-0 text-[11px] leading-relaxed font-bold">
              MOG-SHARE is 100% peer-to-peer. Zero files ever touch any cloud server. LAN mode never leaves your local Wi-Fi router.
            </p>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              onClick={() => {
                sound.playPop();
                onClose();
              }}
              className="neo-btn bg-slate-100 hover:bg-slate-200 px-4 py-2.5 text-xs font-bold uppercase"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="neo-btn neo-btn-yellow px-5 py-2.5 text-xs font-black uppercase"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
