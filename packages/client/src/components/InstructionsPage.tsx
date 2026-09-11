import React, { useState } from 'react';
import { 
  Wifi, 
  Globe, 
  QrCode, 
  Clipboard, 
  ArrowRight, 
  Laptop, 
  Smartphone, 
  Check, 
  Sparkles,
  Layers
} from 'lucide-react';
import { MogLogo } from './MogLogo';
import { sound } from '../utils/audio';

interface InstructionsPageProps {
  onBackToHub: () => void;
}

export const InstructionsPage: React.FC<InstructionsPageProps> = ({ onBackToHub }) => {
  const [demoMode, setDemoMode] = useState<'local' | 'p2p'>('local');

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8 relative z-10 animate-pop">
      
      {/* Hero Header with Non-AI MogLogo */}
      <div className="neo-box p-6 sm:p-8 bg-[#131722] border-3 border-[#2a324b] text-white text-center mb-8 relative overflow-hidden">
        {/* Subtle Ambient Background Flare */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-96 bg-[#FFC900]/10 rounded-full blur-[90px] pointer-events-none" />

        <div className="flex flex-col items-center relative z-10">
          {/* Bespoke Non-AI MOG-SHARE Logo */}
          <div className="mb-4 cursor-pointer" onClick={() => sound.playFanfare()}>
            <MogLogo size={68} animated={true} />
          </div>

          <div className="flex items-center gap-2 mb-2">
            <span className="neo-badge bg-[#FFC900] text-black">
              HOW TO USE MOG-SHARE
            </span>
            <span className="neo-badge bg-[#00F59B] text-black">
              FIELD GUIDE V1.0
            </span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-black uppercase tracking-tight text-white font-mono m-0 mt-2">
            Protocol Instructions
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto mt-2 font-medium leading-relaxed">
            MOG-SHARE is a sovereign, zero-cloud transfer engine. Transfer gigabytes in seconds across iOS, Android, Mac, Windows, and Linux.
          </p>

          <button
            onClick={() => {
              sound.playPop();
              onBackToHub();
            }}
            className="neo-btn neo-btn-yellow mt-5 px-6 py-2.5 text-xs font-black uppercase text-black"
          >
            <span>Launch Transfer Hub</span>
            <ArrowRight className="w-4 h-4 stroke-[3]" />
          </button>
        </div>
      </div>

      {/* Interactive Animated Transmission Demo (The "Sick Animation") */}
      <div className="neo-box p-6 sm:p-8 bg-[#131722] border-3 border-[#2a324b] text-white mb-8 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-center justify-between pb-4 border-b-2 border-[#2a324b] gap-3 mb-6">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#FFC900]" />
            <span className="font-mono text-sm font-black uppercase text-white tracking-wider">
              Live Protocol Simulation
            </span>
          </div>

          {/* Mode Switch for Demo */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                sound.playPop();
                setDemoMode('local');
              }}
              className={`px-3 py-1.5 rounded-lg border-2 border-black text-xs font-bold font-mono transition-all ${
                demoMode === 'local'
                  ? 'bg-[#FFC900] text-black shadow-[2px_2px_0px_#000]'
                  : 'bg-[#1a1f2e] text-slate-400 hover:text-white'
              }`}
            >
              LAN Mesh (120 MB/s)
            </button>
            <button
              onClick={() => {
                sound.playPop();
                setDemoMode('p2p');
              }}
              className={`px-3 py-1.5 rounded-lg border-2 border-black text-xs font-bold font-mono transition-all ${
                demoMode === 'p2p'
                  ? 'bg-[#00F59B] text-black shadow-[2px_2px_0px_#000]'
                  : 'bg-[#1a1f2e] text-slate-400 hover:text-white'
              }`}
            >
              WAN WebRTC P2P
            </button>
          </div>
        </div>

        {/* Animated Data Pipe Canvas */}
        <div className="p-6 rounded-2xl bg-[#0b0d14] border-2 border-[#2a324b] relative overflow-hidden min-h-[190px] flex items-center justify-between px-6 sm:px-14">
          
          {/* Sender Node: MacBook / Laptop */}
          <div className="flex flex-col items-center relative z-10 shrink-0">
            <div className="w-16 h-16 rounded-2xl bg-[#FFC900] border-3 border-black shadow-[4px_4px_0px_#000] flex items-center justify-center">
              <Laptop className="w-8 h-8 text-black stroke-[2.5]" />
            </div>
            <span className="neo-badge bg-[#1e2436] border-[#2a324b] text-slate-200 text-[10px] mt-2 shadow-[2px_2px_0px_#000]">
              Mac / PC
            </span>
          </div>

          {/* Clean High-Speed Data Conduit (Zero Interruption) */}
          <div className="flex-1 mx-6 sm:mx-10 flex flex-col items-center justify-center">
            {/* Speed Badge Cleanly Positioned Above Line */}
            <div className="mb-3">
              <span className={`neo-badge ${demoMode === 'local' ? 'bg-[#FFC900]' : 'bg-[#00F59B]'} text-black text-[10px] font-mono font-black py-1 px-3 shadow-[2px_2px_0px_#000]`}>
                {demoMode === 'local' ? '120.4 MB/s DIRECT LAN STREAM' : '28.6 MB/s ENCRYPTED P2P'}
              </span>
            </div>

            {/* Uninterrupted Data Conduit Pipe */}
            <div className="w-full h-3.5 bg-[#151926] border-2 border-black rounded-full overflow-hidden relative shadow-[2px_2px_0px_#000]">
              <div 
                className={`h-full w-full ${demoMode === 'local' ? 'bg-[#FFC900]' : 'bg-[#00F59B]'} striped-progress`} 
              />
            </div>

            {/* Flow Indicators Cleanly Aligned Below */}
            <div className="mt-2.5 flex items-center gap-1.5 text-[10px] font-mono font-bold text-slate-400">
              <span className="uppercase tracking-wider">DIRECT STREAMING</span>
              <ArrowRight className={`w-3.5 h-3.5 stroke-[3] ${demoMode === 'local' ? 'text-[#FFC900]' : 'text-[#00F59B]'}`} />
              <span className="text-slate-500">NO INTERMEDIARY</span>
            </div>
          </div>

          {/* Receiver Node: Phone */}
          <div className="flex flex-col items-center relative z-10 shrink-0">
            <div className="w-16 h-16 rounded-2xl bg-[#00F59B] border-3 border-black shadow-[4px_4px_0px_#000] flex items-center justify-center">
              <Smartphone className="w-8 h-8 text-black stroke-[2.5]" />
            </div>
            <span className="neo-badge bg-[#1e2436] border-[#2a324b] text-slate-200 text-[10px] mt-2 shadow-[2px_2px_0px_#000]">
              iPhone / Android
            </span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-slate-400 font-mono">
          <span>• 0% Cloud Buffer</span>
          <span>• Zero Disk Logging on Server</span>
          <span>• Direct RAM/Disk Streaming</span>
        </div>
      </div>

      {/* 4-Step Playbook Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        
        {/* Step 1: Local LAN Share */}
        <div className="neo-box p-6 bg-[#131722] border-3 border-[#2a324b] text-white flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-2xl font-black text-[#FFC900]">01</span>
              <span className="neo-badge bg-[#FFC900] text-black">
                SAME WI-FI (LAN)
              </span>
            </div>
            <h3 className="text-lg font-black uppercase text-white m-0 font-mono flex items-center gap-2">
              <Wifi className="w-5 h-5 text-[#FFC900]" />
              <span>Local Gigabit Mesh</span>
            </h3>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              When both devices are on the same home or office Wi-Fi network (or mobile phone hotspot):
            </p>
            <ul className="mt-3 space-y-2 text-xs text-slate-300">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#00F59B] shrink-0 mt-0.5" />
                <span>Open MOG-SHARE on both devices simultaneously.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#00F59B] shrink-0 mt-0.5" />
                <span>Devices auto-discover each other on the sonar radar within 500ms.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#00F59B] shrink-0 mt-0.5" />
                <span>Tap the target peer, drag & drop files, and enjoy up to <strong>120 MB/s</strong> speeds offline.</span>
              </li>
            </ul>
          </div>
          <div className="mt-4 pt-3 border-t border-[#2a324b] text-[11px] font-mono text-slate-500">
            SPEED: ~120 MB/s • INTERNET REQUIRED: NO
          </div>
        </div>

        {/* Step 2: Online P2P Mode */}
        <div className="neo-box p-6 bg-[#131722] border-3 border-[#2a324b] text-white flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-2xl font-black text-[#00F59B]">02</span>
              <span className="neo-badge bg-[#00F59B] text-black">
                ANYWHERE (WAN P2P)
              </span>
            </div>
            <h3 className="text-lg font-black uppercase text-white m-0 font-mono flex items-center gap-2">
              <Globe className="w-5 h-5 text-[#00F59B]" />
              <span>6-Digit P2P Room</span>
            </h3>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              When devices are on different networks, separate cities, or mobile 5G cellular data:
            </p>
            <ul className="mt-3 space-y-2 text-xs text-slate-300">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#00F59B] shrink-0 mt-0.5" />
                <span>Switch to the <strong>Online Share</strong> tab.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#00F59B] shrink-0 mt-0.5" />
                <span>Click <strong>Generate New 6-Digit Room</strong> (e.g. <code>482-901</code>).</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#00F59B] shrink-0 mt-0.5" />
                <span>Enter the 6-digit code on the remote machine. WebRTC establishes a direct encrypted pipe.</span>
              </li>
            </ul>
          </div>
          <div className="mt-4 pt-3 border-t border-[#2a324b] text-[11px] font-mono text-slate-500">
            ENCRYPTION: DTLS-SRTP • FILE SIZE CAP: UNLIMITED
          </div>
        </div>

        {/* Step 3: Zero-Install Mobile Camera Scan */}
        <div className="neo-box p-6 bg-[#131722] border-3 border-[#2a324b] text-white flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-2xl font-black text-[#FF90E8]">03</span>
              <span className="neo-badge bg-[#FF90E8] text-black">
                KILLER FEATURE
              </span>
            </div>
            <h3 className="text-lg font-black uppercase text-white m-0 font-mono flex items-center gap-2">
              <QrCode className="w-5 h-5 text-[#FF90E8]" />
              <span>Camera QR Guest Mode</span>
            </h3>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Sending a video to a coworker or friend who doesn't have MOG-SHARE installed?
            </p>
            <ul className="mt-3 space-y-2 text-xs text-slate-300">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#00F59B] shrink-0 mt-0.5" />
                <span>Click <strong>Camera QR Scan</strong> in the Online Share view.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#00F59B] shrink-0 mt-0.5" />
                <span>Have them point their native iPhone or Android Camera at the screen.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#00F59B] shrink-0 mt-0.5" />
                <span>Safari or Chrome opens automatically and downloads the file with <strong>zero app installation</strong>.</span>
              </li>
            </ul>
          </div>
          <div className="mt-4 pt-3 border-t border-[#2a324b] text-[11px] font-mono text-slate-500">
            COMPATIBILITY: ALL IPHONE & ANDROID BROWSERS
          </div>
        </div>

        {/* Step 4: Universal Realtime Clipboard */}
        <div className="neo-box p-6 bg-[#131722] border-3 border-[#2a324b] text-white flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-2xl font-black text-[#60A5FA]">04</span>
              <span className="neo-badge bg-[#60A5FA] text-black">
                CONTINUITY
              </span>
            </div>
            <h3 className="text-lg font-black uppercase text-white m-0 font-mono flex items-center gap-2">
              <Clipboard className="w-5 h-5 text-[#60A5FA]" />
              <span>Universal Clipboard Sync</span>
            </h3>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Apple charges $1,000s for hardware ecosystem clipboard sync. MOG-SHARE makes it free across all OSes:
            </p>
            <ul className="mt-3 space-y-2 text-xs text-slate-300">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#00F59B] shrink-0 mt-0.5" />
                <span>Tap the <strong>Clipboard icon</strong> in the top header.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#00F59B] shrink-0 mt-0.5" />
                <span>Paste any API token, URL, or code snippet and tap <strong>Broadcast</strong>.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#00F59B] shrink-0 mt-0.5" />
                <span>Paired devices receive a gentle chime and can copy it with 1 click.</span>
              </li>
            </ul>
          </div>
          <div className="mt-4 pt-3 border-t border-[#2a324b] text-[11px] font-mono text-slate-500">
            CHANNELS: LOCAL MESH & ROOM BROADCAST
          </div>
        </div>
      </div>

      {/* Pro-Tips & Architecture Highlights */}
      <div className="neo-box p-6 bg-[#131722] border-3 border-[#2a324b] text-white mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="w-5 h-5 text-[#FFC900]" />
          <h3 className="text-base font-black uppercase text-white m-0 font-mono">
            Frequently Asked Questions & Pro-Tips
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-[#1a1f2e] border-2 border-[#2a324b]">
            <p className="font-bold text-[#FFC900] m-0 mb-1">
              Q: Does local transfer consume mobile data?
            </p>
            <p className="text-slate-400 m-0 leading-relaxed">
              No. In Local Share mode, packets stream directly over your local Wi-Fi router or hotspot. It uses 0 KB of internet data.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#1a1f2e] border-2 border-[#2a324b]">
            <p className="font-bold text-[#00F59B] m-0 mb-1">
              Q: What is the maximum file size limit?
            </p>
            <p className="text-slate-400 m-0 leading-relaxed">
              There is no file limit. MOG-SHARE uses streaming binary chunks with memory backpressure management so even 50GB+ 4K files transfer smoothly.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#1a1f2e] border-2 border-[#2a324b]">
            <p className="font-bold text-[#FF90E8] m-0 mb-1">
              Q: Are files stored on a server?
            </p>
            <p className="text-slate-400 m-0 leading-relaxed">
              Zero files ever touch any server disk. All connections are strictly point-to-point (P2P).
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#1a1f2e] border-2 border-[#2a324b]">
            <p className="font-bold text-[#60A5FA] m-0 mb-1">
              Q: Can I install this on my iPhone / Android?
            </p>
            <p className="text-slate-400 m-0 leading-relaxed">
              Yes! Tap "Share" in Safari or Chrome and select "Add to Home Screen" to install it as an offline PWA app with standalone launch.
            </p>
          </div>
        </div>
      </div>

      {/* Bottom CTA to Return to Transfer Hub */}
      <div className="text-center pb-8">
        <button
          onClick={() => {
            sound.playPop();
            onBackToHub();
          }}
          className="neo-btn neo-btn-yellow px-8 py-3.5 text-sm font-black uppercase text-black inline-flex items-center gap-2 shadow-[6px_6px_0px_#000]"
        >
          <span>Return to Transfer Hub</span>
          <ArrowRight className="w-4 h-4 stroke-[3]" />
        </button>
      </div>

    </div>
  );
};
