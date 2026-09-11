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
    <header className="w-full max-w-5xl mx-auto pt-6 px-4 mb-6">
      <div className="neo-box p-4 flex flex-col sm:flex-row items-center justify-between gap-4 bg-white">
        
        {/* Brand Logo & Subtitle */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-[#FF90E8] border-3 border-black shadow-[3px_3px_0px_#000] rounded-xl flex items-center justify-center -rotate-2">
            <Zap className="w-7 h-7 text-black fill-black" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-black tracking-tight uppercase text-black">
                MOG-SHARE
              </span>
              <span className="neo-badge bg-[#FFC900] text-black">
                P2P
              </span>
            </div>
            <p className="text-xs font-medium text-slate-700 m-0 flex items-center gap-2">
              <span className="font-bold">{deviceName}</span>
              <span>•</span>
              <span className="flex items-center gap-1 font-mono">
                {mode === 'local' ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-[#23A094] inline stroke-[2.5]" />
                    <span className="text-[#23A094] font-bold uppercase">LAN Mesh (120 MB/s)</span>
                  </>
                ) : (
                  <>
                    <Globe className="w-3.5 h-3.5 text-[#3b82f6] inline stroke-[2.5]" />
                    <span className="text-[#3b82f6] font-bold uppercase">P2P WAN Online</span>
                  </>
                )}
              </span>
            </p>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2.5">
          {/* Active Nodes Sticker */}
          <div className="neo-badge bg-[#00F59B] text-black flex items-center gap-1.5 py-1 px-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-black animate-ping inline-block" />
            <span>{connectedPeersCount} {connectedPeersCount === 1 ? 'Peer' : 'Peers'} Ready</span>
          </div>

          {/* Universal Clipboard */}
          <button
            onClick={() => {
              sound.playPop();
              onOpenClipboard();
            }}
            title="Universal Clipboard"
            className="neo-btn p-2.5 bg-[#D3B5FF] hover:bg-[#c6a3fc]"
          >
            <ClipboardCopy className="w-4 h-4 text-black stroke-[2.5]" />
          </button>

          {/* Sound Toggle */}
          <button
            onClick={() => {
              sound.playPop();
              onToggleSound();
            }}
            title={soundEnabled ? 'Mute Sounds' : 'Unmute Sounds'}
            className="neo-btn p-2.5 bg-[#FFFDF8] hover:bg-slate-100"
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4 text-black stroke-[2.5]" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-400 stroke-[2.5]" />
            )}
          </button>

          {/* Settings */}
          <button
            onClick={() => {
              sound.playPop();
              onOpenSettings();
            }}
            title="Settings & Hardware Profile"
            className="neo-btn p-2.5 bg-[#FFC900] hover:bg-[#eab300]"
          >
            <Settings className="w-4 h-4 text-black stroke-[2.5]" />
          </button>
        </div>
      </div>
    </header>
  );
};
