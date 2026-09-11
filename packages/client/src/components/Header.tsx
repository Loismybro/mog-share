import React from 'react';
import { 
  Zap, 
  Volume2, 
  VolumeX, 
  ClipboardCopy, 
  Settings, 
  Wifi, 
  Globe 
} from 'lucide-react';
import { sound } from '../utils/audio';
import { ShareMode } from '../types';

interface HeaderProps {
  mode: ShareMode;
  connectedPeersCount: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onOpenClipboard: () => void;
  onOpenSettings: () => void;
  deviceName: string;
}

export const Header: React.FC<HeaderProps> = ({
  mode,
  connectedPeersCount,
  soundEnabled,
  onToggleSound,
  onOpenClipboard,
  onOpenSettings,
  deviceName,
}) => {
  return (
    <header className="w-full max-w-5xl mx-auto pt-6 px-4 mb-6 relative z-10 animate-pop">
      <div className="neo-box p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#131722] border-3 border-[#2a324b] shadow-[6px_6px_0px_#000]">
        
        {/* Brand Logo & Subtitle */}
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 bg-[#FFC900] border-3 border-black shadow-[3px_3px_0px_#000] rounded-xl flex items-center justify-center -rotate-2 shrink-0">
            <Zap className="w-7 h-7 text-black fill-black" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl font-black tracking-tight uppercase text-white font-mono">
                MOG-SHARE
              </span>
              {/* Shifted P2P Badge slightly above as requested */}
              <span className="neo-badge bg-[#FFC900] text-black text-[10px] font-mono font-black tracking-wider uppercase px-1.5 py-0.5 rounded-md relative -top-2.5 -rotate-3 shadow-[2px_2px_0px_#000]">
                P2P
              </span>
            </div>
            <div className="text-xs font-medium text-slate-400 m-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              <span className="font-bold text-slate-200 truncate max-w-[160px] sm:max-w-none">
                {deviceName}
              </span>
              <span className="text-slate-600">•</span>
              <span className="flex items-center gap-1 font-mono">
                {mode === 'local' ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-[#00F59B] inline stroke-[2.5]" />
                    <span className="text-[#00F59B] font-bold uppercase">LAN (120 MB/s)</span>
                  </>
                ) : (
                  <>
                    <Globe className="w-3.5 h-3.5 text-[#60A5FA] inline stroke-[2.5]" />
                    <span className="text-[#60A5FA] font-bold uppercase">P2P Online</span>
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2.5 flex-wrap justify-center sm:justify-end">
          {/* Active Nodes Sticker */}
          <div className="neo-badge bg-[#1e2436] border-[#2a324b] text-[#00F59B] flex items-center gap-1.5 py-1.5 px-3 shadow-[3px_3px_0px_#000]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00F59B] animate-pulse inline-block" />
            <span className="font-mono">{connectedPeersCount} {connectedPeersCount === 1 ? 'Peer' : 'Peers'} Ready</span>
          </div>

          {/* Universal Clipboard */}
          <button
            onClick={() => {
              sound.playPop();
              onOpenClipboard();
            }}
            title="Universal Clipboard"
            className="neo-btn p-2.5 bg-[#1e2436] hover:bg-[#2a324b] border-2 border-black text-slate-200 hover:text-white"
          >
            <ClipboardCopy className="w-4 h-4 stroke-[2.5]" />
          </button>

          {/* Sound Toggle */}
          <button
            onClick={() => {
              sound.playPop();
              onToggleSound();
            }}
            title={soundEnabled ? 'Mute Sounds' : 'Unmute Sounds'}
            className="neo-btn p-2.5 bg-[#1e2436] hover:bg-[#2a324b] border-2 border-black text-slate-200 hover:text-white"
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4 stroke-[2.5] text-[#FFC900]" />
            ) : (
              <VolumeX className="w-4 h-4 stroke-[2.5] text-slate-500" />
            )}
          </button>

          {/* Settings */}
          <button
            onClick={() => {
              sound.playPop();
              onOpenSettings();
            }}
            title="Hardware Preferences"
            className="neo-btn p-2.5 bg-[#1e2436] hover:bg-[#2a324b] border-2 border-black text-slate-200 hover:text-white"
          >
            <Settings className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>
      </div>
    </header>
  );
};
