import React from 'react';
import { 
  Settings, 
  Activity,
  Download,
  Moon,
  Sun,
  HelpCircle
} from 'lucide-react';
import { MogLogo } from './MogLogo';
import { sound } from '../utils/audio';
import { ConnectionState } from '../types';

interface HeaderProps {
  connectionState: ConnectionState;
  activeMode: 'server' | 'mesh' | 'offline';
  onOpenDiagnostics: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onDownloadZip: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  connectionState,
  onOpenDiagnostics,
  onOpenSettings,
  onOpenHelp,
  theme,
  onToggleTheme,
  onDownloadZip,
}) => {
  const getStatusColor = () => {
    switch (connectionState) {
      case 'ready':
        return 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]';
      case 'connecting':
      case 'reconnecting':
        return 'bg-amber-400 animate-pulse';
      default:
        return 'bg-rose-500';
    }
  };

  const getStatusText = () => {
    switch (connectionState) {
      case 'ready':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'reconnecting':
        return 'Reconnecting...';
      default:
        return 'Offline';
    }
  };

  return (
    <header className="w-full max-w-5xl mx-auto px-4 pt-3 pb-2 sticky top-0 z-30 bg-[#0E1116]/85 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3 py-2 px-3 mog-card rounded-2xl">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <MogLogo size={32} animated={false} />
          <div className="flex items-baseline gap-2">
            <span className="text-base sm:text-lg font-bold tracking-tight text-[var(--text-main)]">
              MOG-SHARE
            </span>
            <span className="text-[11px] font-medium text-[var(--text-dim)] hidden sm:inline">
              v2.0
            </span>
          </div>
        </div>

        {/* Center / Right controls */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Connection status pill (Opens Diagnostics) */}
          <button
            type="button"
            onClick={() => {
              sound.playPop();
              onOpenDiagnostics();
            }}
            title="Click to view connection diagnostics"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium bg-[var(--bg-card-subtle)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] transition-all cursor-pointer min-h-[36px]"
          >
            <span className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
            <span className="text-[var(--text-muted)] text-[12px] hidden xs:inline">
              {getStatusText()}
            </span>
            <Activity className="w-3.5 h-3.5 text-[var(--text-dim)] stroke-[2]" />
          </button>

          {/* Download Final ZIP Button (User Request) */}
          <button
            type="button"
            onClick={() => {
              sound.playPop();
              onDownloadZip();
            }}
            title="Download complete app project as .ZIP"
            className="mog-btn mog-btn-primary !min-h-[36px] !py-1 !px-2.5 !text-xs font-semibold gap-1.5"
          >
            <Download className="w-3.5 h-3.5 stroke-[2.5]" />
            <span className="hidden sm:inline">Download ZIP</span>
          </button>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={() => {
              sound.playPop();
              onToggleTheme();
            }}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            className="mog-btn-icon !min-w-[36px] !min-h-[36px] !p-1.5"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-700" />
            )}
          </button>

          {/* Help / Instructions */}
          <button
            type="button"
            onClick={() => {
              sound.playPop();
              onOpenHelp();
            }}
            title="How to use & troubleshooting"
            className="mog-btn-icon !min-w-[36px] !min-h-[36px] !p-1.5"
          >
            <HelpCircle className="w-4 h-4 text-[var(--text-muted)]" />
          </button>

          {/* Settings Modal */}
          <button
            type="button"
            onClick={() => {
              sound.playPop();
              onOpenSettings();
            }}
            title="Settings & Network Configuration"
            className="mog-btn-icon !min-w-[36px] !min-h-[36px] !p-1.5"
          >
            <Settings className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
        </div>
      </div>
    </header>
  );
};
