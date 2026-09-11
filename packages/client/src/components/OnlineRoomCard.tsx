import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { 
  Copy, 
  Check, 
  ArrowRight, 
  Share2, 
  Users, 
  QrCode as QrIcon,
  AlertCircle,
  Laptop,
  Smartphone,
  Monitor,
  Terminal
} from 'lucide-react';
import { sound } from '../utils/audio';
import { Device, Platform } from '../types';

interface OnlineRoomCardProps {
  roomCode: string | null;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onLeaveRoom: () => void;
  connectedRoomPeers: Device[];
  selectedDeviceId?: string | null;
  onSelectDevice?: (peer: Device) => void;
  errorMessage?: string | null;
  onClearError?: () => void;
}

export const OnlineRoomCard: React.FC<OnlineRoomCardProps> = ({
  roomCode,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  connectedRoomPeers,
  selectedDeviceId,
  onSelectDevice,
  errorMessage,
  onClearError,
}) => {
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);

  useEffect(() => {
    if (roomCode) {
      const origin = window.location.origin;
      const pathname = window.location.pathname.replace(/\/+$/, '');
      const shareUrl = `${origin}${pathname}/#room=${roomCode}`;
      QRCode.toDataURL(shareUrl, {
        width: 260,
        margin: 1.5,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      }).then(setQrDataUrl).catch(console.error);
    } else {
      setQrDataUrl(null);
    }
  }, [roomCode]);

  const handleCopy = () => {
    if (!roomCode) return;
    sound.playPop();
    const origin = window.location.origin;
    const pathname = window.location.pathname.replace(/\/+$/, '');
    const shareUrl = `${origin}${pathname}/#room=${roomCode}`;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Smart input formatter: auto-hyphenates 6 digits into XXX-XXX
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onClearError?.();
    const raw = e.target.value;
    const digitsOnly = raw.replace(/[^\w-]/g, '').toUpperCase();
    
    // If user types raw digits like 123456, format as 123-456
    const cleanDigits = digitsOnly.replace(/-/g, '');
    if (cleanDigits.length > 3) {
      setJoinCodeInput(`${cleanDigits.slice(0, 3)}-${cleanDigits.slice(3, 6)}`);
    } else {
      setJoinCodeInput(digitsOnly.slice(0, 8));
    }
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = joinCodeInput.trim();
    if (!raw) return;
    const cleanDigits = raw.replace(/[^\w]/g, '').toUpperCase();
    const formatted = cleanDigits.length === 6 ? `${cleanDigits.slice(0, 3)}-${cleanDigits.slice(3, 6)}` : raw.toUpperCase();
    sound.playPop();
    onJoinRoom(formatted);
  };

  const getPlatformIcon = (platform: Platform) => {
    switch (platform) {
      case 'ios':
      case 'android':
        return <Smartphone className="w-4 h-4 text-[#00F59B]" />;
      case 'macos':
        return <Laptop className="w-4 h-4 text-[#60A5FA]" />;
      case 'windows':
        return <Monitor className="w-4 h-4 text-[#FFC900]" />;
      case 'linux':
        return <Terminal className="w-4 h-4 text-[#D3B5FF]" />;
      default:
        return <Laptop className="w-4 h-4 text-slate-300" />;
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto px-4 mb-6 relative z-10 animate-pop">
      <div className="neo-box p-6 bg-[#131722] border-3 border-[#2a324b] text-white">
        
        {/* Error Notification Banner */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-rose-950/80 border-2 border-rose-500 text-rose-200 text-xs flex items-center justify-between gap-2 shadow-[2px_2px_0px_#000] animate-pop">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 stroke-[2.5]" />
              <span className="font-bold font-mono">{errorMessage}</span>
            </div>
            {onClearError && (
              <button
                type="button"
                onClick={onClearError}
                className="text-rose-300 hover:text-white font-black text-sm px-1 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {roomCode ? (
          <div>
            <div className="flex items-center justify-between pb-4 border-b-2 border-[#2a324b]">
              <div className="flex items-center gap-2">
                <span className="neo-badge bg-[#FFC900] text-black">
                  ACTIVE P2P ROOM
                </span>
                <span className="neo-badge bg-[#1e2436] border-[#2a324b] text-[#00F59B] text-[10px] hidden sm:inline-block">
                  Direct Relay
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  sound.playPop();
                  onLeaveRoom();
                }}
                className="neo-badge bg-[#FF6B6B] text-white hover:bg-red-600 cursor-pointer transition-colors"
              >
                Leave Room
              </button>
            </div>

            {/* Room Code Banner */}
            <div className="my-6 flex flex-col items-center">
              <div className="text-4xl sm:text-5xl font-mono font-black tracking-widest text-[#FFC900] px-6 py-4 rounded-2xl bg-[#0e111a] border-3 border-[#2a324b] shadow-[6px_6px_0px_#000] select-all">
                {roomCode}
              </div>
              <p className="text-xs font-bold text-slate-400 mt-3 text-center">
                Share this 6-digit code or scan the QR to connect any remote phone, Android, or computer.
              </p>
            </div>

            {/* Actions: Copy Link & Show QR */}
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleCopy}
                className="neo-btn neo-btn-yellow px-4 py-2.5 text-xs font-bold"
              >
                {copied ? <Check className="w-4 h-4 stroke-[3]" /> : <Copy className="w-4 h-4 stroke-[3]" />}
                <span>{copied ? 'Link Copied!' : 'Copy Magic Link'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  sound.playPop();
                  setShowQrModal(true);
                }}
                className="neo-btn neo-btn-mint px-4 py-2.5 text-xs font-bold"
              >
                <QrIcon className="w-4 h-4 stroke-[3]" />
                <span>Camera QR Scan</span>
              </button>
            </div>

            {/* Connected Peers in Room */}
            <div className="mt-6 pt-4 border-t-2 border-[#2a324b]">
              <div className="flex items-center justify-between text-xs font-bold text-slate-300 mb-3">
                <span className="flex items-center gap-1.5 uppercase font-mono">
                  <Users className="w-4 h-4 stroke-[2.5] text-[#00F59B]" />
                  <span>Room Peers ({connectedRoomPeers.length})</span>
                </span>
                {connectedRoomPeers.length > 0 && (
                  <span className="neo-badge bg-[#1e2436] border-[#00F59B] text-[#00F59B] text-[10px] animate-pulse">
                    CONNECTED
                  </span>
                )}
              </div>

              {connectedRoomPeers.length === 0 ? (
                <div className="p-4 rounded-xl border-2 border-dashed border-[#2a324b] text-center text-xs font-medium text-slate-400 bg-[#0e111a] space-y-1">
                  <div className="flex items-center justify-center gap-2 text-amber-400 font-bold font-mono">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping inline-block" />
                    Waiting for remote device to join room {roomCode}...
                  </div>
                  <p className="text-[11px] text-slate-500 m-0">
                    Open this URL on your second device or enter code <span className="text-white font-mono font-bold">{roomCode}</span>
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {connectedRoomPeers.map((peer) => {
                    const isSelected = selectedDeviceId === peer.id;
                    return (
                      <button
                        key={peer.id}
                        type="button"
                        onClick={() => {
                          sound.playPop();
                          onSelectDevice?.(peer);
                        }}
                        className={`neo-box p-3 flex items-center justify-between text-left cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-[#1e2436] border-[#00F59B] text-white shadow-[4px_4px_0px_#000] -translate-y-0.5'
                            : 'bg-[#151926] border-[#2a324b] text-slate-300 hover:border-[#3e4868]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-1">
                          <div className="p-1.5 rounded-lg bg-[#0e111a] border border-[#2a324b]">
                            {getPlatformIcon(peer.platform)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate m-0">{peer.name}</p>
                            <p className="text-[10px] font-mono text-[#00F59B] m-0 font-bold flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#00F59B] inline-block" />
                              Ready To Transfer
                            </p>
                          </div>
                        </div>
                        {isSelected ? (
                          <span className="neo-badge bg-[#00F59B] text-black text-[9px] py-0.5 px-2 shrink-0">
                            TARGET READY
                          </span>
                        ) : (
                          <span className="neo-badge bg-[#1e2436] border-[#2a324b] text-slate-300 text-[9px] py-0.5 px-2 shrink-0">
                            SELECT
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <span className="neo-badge bg-[#FFC900] text-black mb-2 inline-block">
                CROSS-NETWORK SHARING
              </span>
              <h3 className="text-lg font-black uppercase text-white m-0 font-mono">
                P2P Room Connection
              </h3>
              <p className="text-xs font-medium text-slate-400 mt-1 m-0">
                Transfer files with any phone, Android, iPhone, or PC anywhere across networks.
              </p>
            </div>

            {/* Join Room Form */}
            <form onSubmit={handleJoinSubmit} className="flex gap-2">
              <input
                type="text"
                placeholder="Enter 6-digit code (e.g. 748-291)"
                value={joinCodeInput}
                onChange={handleInputChange}
                maxLength={10}
                className="flex-1 px-4 py-3 rounded-xl border-3 border-[#2a324b] bg-[#0e111a] text-white text-sm font-mono font-bold tracking-wider placeholder:font-sans placeholder:text-slate-500 focus:outline-none focus:border-[#FFC900] shadow-[3px_3px_0px_#000]"
              />
              <button
                type="submit"
                disabled={!joinCodeInput.trim()}
                className="neo-btn neo-btn-mint px-5 py-3 text-xs font-black uppercase disabled:opacity-40"
              >
                <span>Join</span>
                <ArrowRight className="w-4 h-4 stroke-[3]" />
              </button>
            </form>

            <div className="flex items-center gap-3">
              <div className="h-[1px] flex-1 bg-zinc-800" />
              <span className="neo-badge bg-[#0e111a] border-[#2a324b] text-slate-400 text-[10px]">OR</span>
              <div className="h-[1px] flex-1 bg-zinc-800" />
            </div>

            {/* Create Room Button */}
            <button
              type="button"
              onClick={() => {
                sound.playPop();
                onCreateRoom();
              }}
              className="neo-btn neo-btn-yellow w-full py-3.5 text-sm font-black uppercase text-black shadow-[4px_4px_0px_#000]"
            >
              <Share2 className="w-5 h-5 stroke-[2.5]" />
              <span>Generate New 6-Digit Room & QR</span>
            </button>
          </div>
        )}

        {/* Dynamic QR Code Modal */}
        {showQrModal && qrDataUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <div className="neo-box p-6 max-w-sm w-full bg-[#131722] border-3 border-[#2a324b] text-center relative shadow-[8px_8px_0px_#000]">
              <span className="neo-badge bg-[#FFC900] text-black mb-2 inline-block">
                ZERO INSTALL GUEST SCAN
              </span>
              <h4 className="text-lg font-black text-white m-0 uppercase font-mono">
                Scan with Phone Camera
              </h4>
              <p className="text-xs font-medium text-slate-400 mt-1 mb-4">
                Point your native Camera app to immediately open the web receiver in Safari/Chrome!
              </p>

              <div className="p-3 bg-white border-3 border-black rounded-2xl inline-block shadow-[4px_4px_0px_#000]">
                <img src={qrDataUrl} alt="Room QR Code" className="w-56 h-56 mx-auto rounded-lg" />
              </div>

              <div className="mt-4 font-mono text-2xl font-black text-[#FFC900] bg-[#0e111a] border-2 border-[#2a324b] py-1.5 px-4 rounded-xl inline-block shadow-[3px_3px_0px_#000]">
                {roomCode}
              </div>

              <button
                type="button"
                onClick={() => {
                  sound.playPop();
                  setShowQrModal(false);
                }}
                className="neo-btn neo-btn-dark w-full mt-5 py-3 text-xs font-bold uppercase"
              >
                Close QR Code
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
