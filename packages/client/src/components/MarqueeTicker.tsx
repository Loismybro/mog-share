import React from 'react';

export const MarqueeTicker: React.FC = () => {
  const items = [
    '🔥 MOG-SHARE V1.0',
    'AIRDROP IS OFFICIALLY COOKED',
    '⚡ 120 MB/S GIGABIT LAN',
    '🔒 100% P2P • ZERO CLOUD LOGS',
    '📱 SCAN QR TO RECEIVE ON IPHONE & ANDROID',
    '✨ NO ACCOUNTS • NO APP REQUIRED FOR GUESTS',
    '💻 MAC • WINDOWS • LINUX • IOS • ANDROID',
    '📋 UNIVERSAL REALTIME CLIPBOARD',
  ];

  return (
    <div className="w-full bg-[#FFC900] border-b-3 border-black py-1.5 overflow-hidden select-none">
      <div className="marquee-track flex whitespace-nowrap">
        {[...items, ...items].map((text, i) => (
          <span
            key={i}
            className="text-xs font-mono font-black tracking-wider uppercase text-black mx-4 flex items-center gap-3"
          >
            <span>{text}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-black inline-block" />
          </span>
        ))}
      </div>
    </div>
  );
};
