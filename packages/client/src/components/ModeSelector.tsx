import React from 'react';
import { Wifi, Globe, ShieldAlert, Zap } from 'lucide-react';
import { ShareMode } from '../types';
import { sound } from '../utils/audio';

interface ModeSelectorProps {
  currentMode: ShareMode;
  onModeChange: (mode: ShareMode) => void;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  currentMode,
  onModeChange,
}) => {
  return (
    <div className="w-full max-w-xl mx-auto px-4 mb-6">
      <div className="neo-box p-1.5 flex gap-2 bg-black border-3 border-black shadow-[5px_5px_0px_#000]">
        
        {/* Local Share Tab */}
        <button
          onClick={() => {
            if (currentMode !== 'local') {
              sound.playPop();
              onModeChange('local');
            }
          }}
          className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2.5 font-black uppercase text-xs tracking-wider transition-all duration-150 cursor-pointer border-2 border-black ${
            currentMode === 'local'
              ? 'bg-[#FFC900] text-black shadow-[3px_3px_0px_#000] -translate-y-0.5'
              : 'bg-zinc-900 text-slate-400 hover:text-white hover:bg-zinc-800'
          }`}
        >
          <Wifi className="w-4 h-4 stroke-[3]" />
          <span>Local Share</span>
          <span className="neo-badge bg-black text-[#FFC900] text-[10px] py-0 px-1 border-0">
            LAN
          </span>
        </button>

        {/* Online Share Tab */}
        <button
          onClick={() => {
            if (currentMode !== 'online') {
              sound.playPop();
              onModeChange('online');
            }
          }}
          className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2.5 font-black uppercase text-xs tracking-wider transition-all duration-150 cursor-pointer border-2 border-black ${
            currentMode === 'online'
              ? 'bg-[#FF90E8] text-black shadow-[3px_3px_0px_#000] -translate-y-0.5'
              : 'bg-zinc-900 text-slate-400 hover:text-white hover:bg-zinc-800'
          }`}
        >
          <Globe className="w-4 h-4 stroke-[3]" />
          <span>Online Share</span>
          <span className="neo-badge bg-black text-[#FF90E8] text-[10px] py-0 px-1 border-0">
            P2P
          </span>
        </button>
      </div>

      {/* Mode Subtext Info */}
      <div className="mt-3 flex items-center justify-center gap-3 text-xs font-bold text-black">
        {currentMode === 'local' ? (
          <div className="neo-badge bg-[#00F59B] text-black flex items-center gap-1.5 shadow-[2px_2px_0px_#000]">
            <Zap className="w-3.5 h-3.5 fill-black" />
            <span>Direct Line-rate Wi-Fi (Up to 120 MB/s) • 100% Offline</span>
          </div>
        ) : (
          <div className="neo-badge bg-[#90B8F8] text-black flex items-center gap-1.5 shadow-[2px_2px_0px_#000]">
            <ShieldAlert className="w-3.5 h-3.5 fill-black" />
            <span>Cross-Network P2P • 6-Digit Code / QR Camera Scan</span>
          </div>
        )}
      </div>
    </div>
  );
};
