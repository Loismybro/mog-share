import React, { useState } from 'react';
import { 
  ArrowRight, 
  Laptop, 
  Smartphone, 
  Sparkles,
  Download,
  HelpCircle
} from 'lucide-react';
import { MogLogo } from './MogLogo';
import { sound } from '../utils/audio';

interface InstructionsPageProps {
  onBackToHub: () => void;
  onDownloadZip: () => void;
}

export const InstructionsPage: React.FC<InstructionsPageProps> = ({ 
  onBackToHub,
  onDownloadZip,
}) => {
  const [demoMode, setDemoMode] = useState<'local' | 'p2p'>('local');

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6 relative z-10 animate-pop">
      {/* Hero Header */}
      <div className="mog-card p-6 sm:p-8 text-center mb-6 relative overflow-hidden">
        <div className="flex flex-col items-center relative z-10">
          <div className="mb-3 cursor-pointer" onClick={() => sound.playFanfare()}>
            <MogLogo size={56} animated={false} />
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-main)] m-0">
            MOG-SHARE Quickstart & Guide
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] max-w-lg mx-auto mt-2 leading-relaxed">
            Fast, private file transfer using WebRTC DataChannels and local network grouping. Share photos, videos, and documents seamlessly across any browser or device.
          </p>

          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={() => {
                sound.playPop();
                onBackToHub();
              }}
              className="mog-btn mog-btn-primary !min-h-[40px] text-xs font-semibold gap-1.5"
            >
              <span>Back to App</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => {
                sound.playPop();
                onDownloadZip();
              }}
              className="mog-btn mog-btn-secondary !min-h-[40px] text-xs font-semibold gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>Download Project .ZIP</span>
            </button>
          </div>
        </div>
      </div>

      {/* Visual Data Channel Flow */}
      <div className="mog-card p-5 sm:p-6 mb-6">
        <div className="flex flex-col sm:flex-row items-center justify-between pb-3 border-b border-[var(--border-subtle)] gap-3 mb-5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--accent-primary)]" />
            <span className="text-sm font-semibold text-[var(--text-main)]">
              Architecture & Data Flow
            </span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                sound.playPop();
                setDemoMode('local');
              }}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                demoMode === 'local'
                  ? 'bg-[var(--accent-primary)] text-[var(--accent-primary-text)] font-semibold'
                  : 'bg-[var(--bg-app)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              Nearby (LAN Discovery)
            </button>
            <button
              type="button"
              onClick={() => {
                sound.playPop();
                setDemoMode('p2p');
              }}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                demoMode === 'p2p'
                  ? 'bg-[var(--accent-primary)] text-[var(--accent-primary-text)] font-semibold'
                  : 'bg-[var(--bg-app)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              Room (WebRTC Direct)
            </button>
          </div>
        </div>

        {/* Conduit */}
        <div className="p-6 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] flex items-center justify-between px-6 sm:px-12">
          {/* Sender */}
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--accent-primary)]">
              <Laptop className="w-6 h-6 stroke-[2]" />
            </div>
            <span className="text-[11px] font-medium text-[var(--text-muted)] mt-1.5">
              Sender (Laptop)
            </span>
          </div>

          {/* Conduit line */}
          <div className="flex-1 mx-4 sm:mx-8 flex flex-col items-center">
            <span className="text-[10px] font-mono font-medium text-emerald-400 mb-2">
              {demoMode === 'local' ? 'Direct P2P WebRTC DataChannel (16 KB Chunks)' : 'Encrypted P2P Connection (STUN / TURN)'}
            </span>
            <div className="w-full h-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-full overflow-hidden">
              <div className="h-full w-full bg-[var(--accent-primary)] animate-pulse" />
            </div>
            <span className="text-[10px] text-[var(--text-dim)] mt-1.5">
              Zero storage on server • Backpressure controlled
            </span>
          </div>

          {/* Receiver */}
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center text-emerald-400">
              <Smartphone className="w-6 h-6 stroke-[2]" />
            </div>
            <span className="text-[11px] font-medium text-[var(--text-muted)] mt-1.5">
              Receiver (Phone)
            </span>
          </div>
        </div>
      </div>

      {/* 3 Step Guide Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="mog-card p-4">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] flex items-center justify-center text-xs font-bold mb-3">
            1
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-main)] mb-1">
            Open on Both Devices
          </h3>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Open the website URL on both phones, tablets, or laptops. If on the same Wi-Fi network, devices discover each other automatically in Nearby.
          </p>
        </div>

        <div className="mog-card p-4">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] flex items-center justify-center text-xs font-bold mb-3">
            2
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-main)] mb-1">
            Select or Join Room
          </h3>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Tap a device card to choose files, or create a Room Code to connect across mobile data, VPNs, or guest networks via 6-digit code or QR code.
          </p>
        </div>

        <div className="mog-card p-4">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] flex items-center justify-center text-xs font-bold mb-3">
            3
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-main)] mb-1">
            Accept & Stream
          </h3>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            The recipient taps Accept (or Auto-Accept for trusted devices). Chunks stream directly over WebRTC DataChannels with integrity verification.
          </p>
        </div>
      </div>

      {/* Troubleshooting FAQ */}
      <div className="mog-card p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <HelpCircle className="w-4 h-4 text-[var(--accent-primary)]" />
          <h3 className="text-sm font-semibold text-[var(--text-main)] m-0">
            Frequently Asked Questions & Troubleshooting
          </h3>
        </div>

        <div className="space-y-3 text-xs text-[var(--text-muted)]">
          <div className="p-3 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <p className="font-semibold text-[var(--text-main)] mb-1">
              Why don&apos;t my devices see each other in Nearby?
            </p>
            <p className="leading-relaxed m-0">
              Nearby discovery groups devices by public IP prefix. If one device is on a VPN, or if mobile data is enabled instead of Wi-Fi, they will have different public IPs. Use the <strong>Room Code</strong> tab to connect them directly!
            </p>
          </div>

          <div className="p-3 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
            <p className="font-semibold text-[var(--text-main)] mb-1">
              How do I self-host or deploy to Render and Vercel?
            </p>
            <p className="leading-relaxed m-0">
              Deploy the static frontend to Vercel or GitHub Pages, and deploy <code>packages/server</code> to Render or Fly.io. In your frontend, set the <code>VITE_WS_URL</code> environment variable to your Render WebSocket URL (e.g. <code>wss://your-app.onrender.com/ws</code>).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
