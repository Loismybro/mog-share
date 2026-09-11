import React from 'react';
import { 
  Volume2, 
  VolumeX, 
  ClipboardCopy, 
  Settings, 
  Wifi, 
  Globe,
  BookOpen
} from 'lucide-react';
import { MogLogo } from './MogLogo';
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
  activeTab: 'transfer' | 'instructions';
  onTabChange: (tab: 'transfer' | 'instructions') => void;
}

export const Header: React.FC<HeaderProps> = ({
  mode,
  connectedPeersCount,
  soundEnabled,
  onToggleSound,
  onOpenClipboard,
  onOpenSettings,
  deviceName,
  activeTab,
  onTabChange,
}) => {
  return (
    <header className="w-full max-w-5xl mx-auto pt-6 px-4 mb-6 relative z-10 animate-pop">
      <div className="neo-box p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#131722] border-3 border-[#2a324b] shadow-[6px_6px_0px_#000]">
        
        {/* Brand Logo & Subtitle */}
        <div 
          className="flex items-center gap-3.5 cursor-pointer"
          onClick={() => {
            sound.playPop();
            onTabChange('transfer');
          }}
        >
          {/* Bespoke Geometric Non-AI Logo */}
          <MogLogo size={46} animated={true} />

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl font-black tracking-tight uppercase text-white font-mono">
                MOG-SHARE
              </span>
              {/* Shifted P2P Badge */}
              <span className="neo-badge bg-[#FFC900] text-black text-[10px] font-mono font-black tracking-wider uppercase px-1.5 py-0.5 rounded-md relative -top-2.5 -rotate-3 shadow-[2px_2px_0px_#000]">
                P2P
              </span>
            </div>
            <div className="text-xs font-medium text-slate-400 m-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              <span className="font-bold text-slate-200 truncate max-w-[150px] sm:max-w-none">
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
          
          {/* Instructions / Transfer Hub Toggle Button */}
          <button
            onClick={() => {
              sound.playPop();
              onTabChange(activeTab === 'transfer' ? 'instructions' : 'transfer');
            }}
            className={`neo-btn px-3 py-2 text-xs font-bold font-mono uppercase ${
              activeTab === 'instructions'
                ? 'bg-[#FFC900] text-black shadow-[3px_3px_0px_#000]'
                : 'bg-[#1e2436] hover:bg-[#283048] border-2 border-black text-slate-200 hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{activeTab === 'instructions' ? 'Transfer Hub' : 'How To Use'}</span>
          </button>

          {/* Active Nodes Sticker */}
          <div className="hidden sm:flex neo-badge bg-[#1e2436] border-[#2a324b] text-[#00F59B] items-center gap-1.5 py-1.5 px-3 shadow-[3px_3px_0px_#000]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00F59B] animate-pulse inline-block" />
            <span className="font-mono">{connectedPeersCount} {connectedPeersCount === 1 ? 'Peer' : 'Peers'}</span>
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
