import React from 'react';
import { Wifi, KeyRound, Clipboard, History } from 'lucide-react';
import { sound } from '../utils/audio';

export type MainNavTab = 'nearby' | 'room' | 'clipboard' | 'history';

interface ModeSelectorProps {
  currentTab: MainNavTab;
  onTabChange: (tab: MainNavTab) => void;
  nearbyCount?: number;
  historyCount?: number;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  currentTab,
  onTabChange,
  nearbyCount = 0,
  historyCount = 0,
}) => {
  const tabs: { id: MainNavTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: 'nearby',
      label: 'Nearby',
      icon: <Wifi className="w-4 h-4" />,
      badge: nearbyCount > 0 ? nearbyCount : undefined,
    },
    {
      id: 'room',
      label: 'Room Code',
      icon: <KeyRound className="w-4 h-4" />,
    },
    {
      id: 'clipboard',
      label: 'Clipboard',
      icon: <Clipboard className="w-4 h-4" />,
    },
    {
      id: 'history',
      label: 'History',
      icon: <History className="w-4 h-4" />,
      badge: historyCount > 0 ? historyCount : undefined,
    },
  ];

  return (
    <div className="w-full max-w-xl mx-auto px-4 mb-5">
      {/* Segmented Controller */}
      <div className="mog-card p-1 flex items-center bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl">
        {tabs.map((tab) => {
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (!isActive) {
                  sound.playPop();
                  onTabChange(tab.id);
                }
              }}
              className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 text-xs font-semibold transition-all cursor-pointer min-h-[38px] ${
                isActive
                  ? 'bg-[var(--accent-primary)] text-[var(--accent-primary-text)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-card-subtle)]'
              }`}
            >
              {tab.icon}
              <span className="hidden xs:inline">{tab.label}</span>
              {typeof tab.badge === 'number' && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                    isActive
                      ? 'bg-black/20 text-black'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
