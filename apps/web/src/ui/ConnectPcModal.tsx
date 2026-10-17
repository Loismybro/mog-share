import React, { useState } from 'react';
import {
  QrCode,
  Laptop,
  Smartphone,
  Copy,
  Check,
  Wifi,
  Globe,
  X,
  ArrowRight,
  Link2,
} from 'lucide-react';

interface ConnectPcModalProps {
  isOpen: boolean;
  onClose: () => void;
  shareUrl: string;
  localIpUrl?: string;
  roomCode?: string | null;
  onCreateRoom?: () => void;
  onJoinRoom?: (code: string) => void;
}

export const ConnectPcModal: React.FC<ConnectPcModalProps> = ({
  isOpen,
  onClose,
  shareUrl,
  localIpUrl,
  roomCode,
  onCreateRoom,
  onJoinRoom,
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [joinInput, setJoinInput] = useState('');

  if (!isOpen) return null;

  const activeUrl = roomCode
    ? `${shareUrl.split('?')[0]}?room=${roomCode}`
    : localIpUrl || shareUrl;

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&color=38BDF8&bgcolor=0B0F1A&data=${encodeURIComponent(
    activeUrl,
  )}`;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(activeUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleCopyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="relative w-full max-w-lg rounded-2xl mog-glass border border-white/15 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Pair Another Device (Phone / PC / Mac)
              </h3>
              <p className="text-xs text-slate-400">
                Scan QR code or enter a 6-character room code from anywhere
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center mb-5">
          {/* QR Code Box */}
          <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-[#0B0F1A] border border-white/10">
            <img
              src={qrImageUrl}
              alt="Scan to pair device"
              className="w-44 h-44 rounded-lg border border-sky-400/20"
            />
            <span className="mt-2.5 text-[11px] font-mono text-slate-400">
              Point camera to open & auto-pair
            </span>
          </div>

          {/* Room & Direct Link Controls */}
          <div className="space-y-3">
            <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-sky-400 font-semibold flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" />
                  Instant Room Code
                </span>
              </div>
              {roomCode ? (
                <div className="flex items-center justify-between gap-2 mt-2">
                  <span className="text-xl font-mono font-bold tracking-[0.2em] text-white">
                    {roomCode}
                  </span>
                  <button
                    onClick={handleCopyCode}
                    className="px-2.5 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/30 text-xs font-semibold text-sky-300 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCode ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={onCreateRoom}
                  className="w-full mt-1 py-2 px-3 rounded-lg mog-btn-primary text-xs font-bold cursor-pointer"
                >
                  Generate 6-Digit Room Code
                </button>
              )}
            </div>

            {onJoinRoom && (
              <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10">
                <label className="block text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                  Join Existing Room Code
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={joinInput}
                    onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                    placeholder="E.g. K7M9P2"
                    maxLength={8}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/15 text-xs font-mono uppercase tracking-widest text-white focus:outline-none focus:border-sky-400"
                  />
                  <button
                    onClick={() => {
                      if (joinInput.trim().length >= 4) {
                        onJoinRoom(joinInput.trim());
                        onClose();
                      }
                    }}
                    className="p-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/30 text-sky-300 cursor-pointer"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Shareable Link Bar */}
        <div className="p-3 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Link2 className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="text-xs font-mono text-slate-300 truncate">{activeUrl}</span>
          </div>
          <button
            onClick={handleCopyUrl}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedUrl ? 'Copied Link' : 'Copy Link'}</span>
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            Same Wi-Fi auto-discovers automatically
          </span>
          <span className="flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 text-sky-400" />
            <Laptop className="w-3.5 h-3.5 text-indigo-400" />
            Cross-platform WebRTC
          </span>
        </div>
      </div>
    </div>
  );
};
