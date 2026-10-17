import React from 'react';
import {
  Smartphone,
  Laptop,
  MonitorSmartphone,
  RefreshCw,
  Wifi,
  Sparkles,
  MessageSquare,
  Send,
  ShieldCheck,
  Radio,
} from 'lucide-react';
import type { Device, Platform } from '../types';
import BriarGlobe from './BriarGlobe';

interface RadarScannerProps {
  peers: Device[];
  localDevice: { name: string; platform: Platform; id: string; model?: string };
  isScanning: boolean;
  onSelectPeer: (peer: Device) => void;
  onChatPeer?: (peer: Device) => void;
  onRescan: () => void;
  selectedFilesCount: number;
  selectedTotalSize?: string;
  activeGroupKey?: string;
}

export const RadarScanner: React.FC<RadarScannerProps> = ({
  peers,
  localDevice,
  isScanning,
  onSelectPeer,
  onChatPeer,
  onRescan,
  selectedFilesCount,
  selectedTotalSize,
}) => {
  const getIcon = (platform: Platform, className = 'w-4 h-4') => {
    switch (platform) {
      case 'Android':
      case 'iOS':
        return <Smartphone className={className} />;
      case 'macOS':
      case 'Windows':
      case 'Linux':
        return <Laptop className={className} />;
      default:
        return <MonitorSmartphone className={className} />;
    }
  };

  return (
    <div className="relative w-full flex flex-col items-center">
      {/* Top Status & Controls Bar */}
      <div className="w-full flex flex-wrap items-center justify-between gap-2 mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0F172A]/80 border border-white/10 text-xs font-medium text-slate-300">
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  peers.length > 0 ? 'bg-emerald-400' : 'bg-sky-400'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  peers.length > 0 ? 'bg-emerald-400' : 'bg-sky-400'
                }`}
              />
            </span>
            <Wifi className="w-3.5 h-3.5 text-sky-400" />
            <span>
              {peers.length > 0
                ? `${peers.length} Active ${peers.length === 1 ? 'Node' : 'Nodes'} in Mesh`
                : isScanning
                ? 'Scanning Local & Room Mesh…'
                : 'Mesh Standby'}
            </span>
          </div>

          {selectedFilesCount > 0 && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-300 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>
                {selectedFilesCount} {selectedFilesCount === 1 ? 'file' : 'files'} staged
                {selectedTotalSize ? ` (${selectedTotalSize})` : ''}
              </span>
            </div>
          )}
        </div>

        <button
          onClick={onRescan}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-sky-400/30 text-xs font-semibold text-slate-200 transition-all cursor-pointer"
          title="Refresh Mesh Discovery"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isScanning ? 'animate-spin' : ''}`} />
          <span>Pulse Mesh</span>
        </button>
      </div>

      {/* 3D BriarGlobe Neural Thread Sphere */}
      <div className="relative w-full h-[330px] sm:h-[380px] rounded-2xl overflow-hidden mog-glass border border-white/10">
        {/* Subtle radial glow behind the 3D sphere */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 50% 50%, rgba(56, 189, 248, 0.14) 0%, rgba(99, 102, 241, 0.07) 45%, rgba(7, 9, 15, 0) 75%)',
          }}
        />

        <BriarGlobe
          peers={peers}
          onSelectPeer={onSelectPeer}
          onChatPeer={onChatPeer}
          selectedFilesCount={selectedFilesCount}
          density={5}
          glow={6}
          motion={5}
          interactive={true}
          background="transparent"
          palette={{
            ink: '#07090F',
            primary: '#1E293B',
            secondary: '#38BDF8',
            accent: '#818CF8',
            highlight: '#F8FAFC',
          }}
          style={{ width: '100%', height: '100%' }}
        />

        {/* Local Node Identity Badge in bottom-left corner of the 3D viewport */}
        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[#07090F]/85 backdrop-blur-md border border-white/10">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-400/20 to-indigo-500/20 border border-sky-400/30 flex items-center justify-center text-sky-300">
            {getIcon(localDevice.platform, 'w-3.5 h-3.5')}
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider font-mono text-sky-400 font-semibold">
                THIS NODE
              </span>
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
            </div>
            <p className="text-xs font-bold text-slate-100 truncate max-w-[150px]">
              {localDevice.name}
            </p>
          </div>
        </div>

        {/* Interactive Hint in bottom-right corner */}
        <div className="absolute bottom-3 right-3 z-20 hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#07090F]/80 backdrop-blur-md border border-white/10 text-[11px] text-slate-400">
          <Radio className="w-3.5 h-3.5 text-sky-400" />
          <span>
            {peers.length > 0
              ? 'Hover or click glowing knots in 3D sphere to beam'
              : 'Waiting for nearby or room peers…'}
          </span>
        </div>
      </div>

      {/* Direct Discovered Peer Cards Below the 3D Sphere for 1-Tap Mobile & Desktop Access */}
      {peers.length > 0 && (
        <div className="w-full mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {peers.map((peer) => {
            const isOnlineRoom = peer.discoveryMethod === 'Online Room';
            return (
              <div
                key={peer.id}
                onClick={() => onSelectPeer(peer)}
                className="group mog-glass-card rounded-xl p-3 flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/20 to-indigo-500/20 border border-sky-400/30 flex items-center justify-center text-sky-300 shrink-0 group-hover:scale-105 transition-transform">
                    {getIcon(peer.platform, 'w-5 h-5')}
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#07090F]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-bold text-slate-100 truncate group-hover:text-sky-300 transition-colors">
                        {peer.name}
                      </p>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                          isOnlineRoom
                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/30'
                            : 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30'
                        }`}
                      >
                        {isOnlineRoom ? 'ROOM' : 'LAN'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 truncate">
                      {peer.model || peer.platform} • Direct P2P Ready
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {onChatPeer && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChatPeer(peer);
                      }}
                      className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-sky-300 transition-colors cursor-pointer"
                      title={`Chat with ${peer.name}`}
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPeer(peer);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg mog-btn-primary text-xs font-bold cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{selectedFilesCount > 0 ? 'Beam Now' : 'Send'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
