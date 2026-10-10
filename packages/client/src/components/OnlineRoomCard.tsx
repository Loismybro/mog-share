import React, { useState, useEffect, useId } from 'react';
import QRCode from 'qrcode';
import { 
  Copy, 
  Check, 
  Share2, 
  QrCode as QrIcon, 
  Users, 
  Laptop, 
  Smartphone, 
  Monitor, 
  Terminal, 
  LogOut, 
  Loader2,
  X
} from 'lucide-react';
import { Device, Platform, ConnectionState } from '../types';
import { sound } from '../utils/audio';
import { safeGetStorage } from '../services/network';

interface OnlineRoomCardProps {
  roomCode: string | null;
  connectionState: ConnectionState;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onLeaveRoom: () => void;
  connectedRoomPeers: Device[];
  selectedDeviceId?: string | null;
  onSelectDevice?: (peer: Device) => void;
  errorMessage?: string | null;
  onClearError?: () => void;
  serverLocalIps?: string[];
  serverPort?: number;
}

export const OnlineRoomCard: React.FC<OnlineRoomCardProps> = ({
  roomCode,
  connectionState,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  connectedRoomPeers,
  selectedDeviceId,
  onSelectDevice,
  errorMessage,
  onClearError,
  serverLocalIps = [],
  serverPort = 4000,
}) => {
  const [joinInput, setJoinInput] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const inputId = useId();

  // Reset join loader on code change or error
  useEffect(() => {
    if (roomCode || errorMessage) {
      setIsJoining(false);
    }
  }, [roomCode, errorMessage]);

  // Compute proper share URL using R6 order of preference
  const getShareableUrl = (code: string): string => {
    // 1. Saved Public URL in Settings
    const publicUrl = safeGetStorage('mog_public_url');
    if (publicUrl && publicUrl.trim()) {
      try {
        const u = new URL(publicUrl.trim());
        u.hash = `room=${code}`;
        return u.toString();
      } catch {}
    }

    // 2. If on localhost, prefer LAN IPv4 address from server /api/info
    if (
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
      serverLocalIps.length > 0
    ) {
      const lanIp = serverLocalIps[0];
      const port = window.location.port || String(serverPort);
      const proto = window.location.protocol;
      try {
        const u = new URL(`${proto}//${lanIp}:${port}`);
        u.hash = `room=${code}`;
        return u.toString();
      } catch {}
    }

    // 3. Fallback: window.location.origin
    try {
      const u = new URL(window.location.href);
      u.hash = `room=${code}`;
      return u.toString();
    } catch {
      return `${window.location.origin}/#room=${code}`;
    }
  };

  // Generate QR Code
  useEffect(() => {
    if (!roomCode) {
      setQrDataUrl(null);
      return;
    }

    const shareUrl = getShareableUrl(roomCode);
    QRCode.toDataURL(shareUrl, {
      width: 280,
      margin: 1.5,
      color: {
        dark: '#0E1116',
        light: '#FFFFFF',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch(console.error);
  }, [roomCode, serverLocalIps]);

  // Handle Join input with auto-formatting & auto-submit on 6 digits (R7)
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onClearError?.();
    const val = e.target.value;

    // Check if full link was pasted
    if (val.includes('#room=')) {
      const extracted = val.split('#room=')[1].trim();
      const digits = extracted.replace(/[^\d]/g, '');
      if (digits.length === 6) {
        const formatted = `${digits.slice(0, 3)}-${digits.slice(3, 6)}`;
        setJoinInput(formatted);
        submitJoin(formatted);
        return;
      }
    }

    // Clean to digits only
    const digits = val.replace(/[^\d]/g, '').slice(0, 6);
    if (digits.length > 3) {
      const formatted = `${digits.slice(0, 3)}-${digits.slice(3, 6)}`;
      setJoinInput(formatted);
      if (digits.length === 6) {
        submitJoin(formatted);
      }
    } else {
      setJoinInput(digits);
    }
  };

  const submitJoin = (code: string) => {
    if (isJoining || connectionState !== 'ready') return;
    setIsJoining(true);
    sound.playPop();
    onJoinRoom(code);

    // Timeout after 6s (R7)
    setTimeout(() => {
      setIsJoining((prev) => {
        if (prev) {
          // If still joining, report not found or expired
          onClearError?.();
          return false;
        }
        return false;
      });
    }, 6000);
  };

  const handleCopyLink = () => {
    if (!roomCode) return;
    sound.playPop();
    const shareUrl = getShareableUrl(roomCode);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } else {
      // Fallback for HTTP environments
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
      document.body.removeChild(textArea);
    }
  };

  const handleShare = async () => {
    if (!roomCode) return;
    sound.playPop();
    const shareUrl = getShareableUrl(roomCode);

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my MOG-SHARE Room',
          text: `Connect to my MOG-SHARE room (${roomCode}) to send and receive files:`,
          url: shareUrl,
        });
      } catch {}
    } else {
      handleCopyLink();
    }
  };

  const getPlatformIcon = (platform: Platform) => {
    switch (platform) {
      case 'ios':
      case 'android':
        return <Smartphone className="w-4 h-4 text-emerald-400" />;
      case 'macos':
        return <Laptop className="w-4 h-4 text-blue-400" />;
      case 'windows':
        return <Monitor className="w-4 h-4 text-amber-400" />;
      case 'linux':
        return <Terminal className="w-4 h-4 text-purple-400" />;
      default:
        return <Laptop className="w-4 h-4 text-slate-400" />;
    }
  };

  const isConnected = connectionState === 'ready';

  return (
    <div className="w-full max-w-xl mx-auto px-4 mb-6 animate-pop">
      <div className="mog-card p-5 sm:p-6">
        {/* Error notice */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-red-200 text-xs flex items-center justify-between gap-2">
            <span>{errorMessage}</span>
            {onClearError && (
              <button
                type="button"
                onClick={onClearError}
                className="text-red-400 hover:text-red-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* ACTIVE ROOM VIEW */}
        {roomCode ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Active Room
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  sound.playPop();
                  onLeaveRoom();
                }}
                className="mog-btn mog-btn-danger !min-h-[32px] !py-1 !px-2.5 !text-xs font-semibold gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Leave</span>
              </button>
            </div>

            {/* Segmented 6-digit Code Display */}
            <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] mb-4">
              <span className="text-xs text-[var(--text-muted)] mb-2 font-medium">
                Room Access Code
              </span>

              <div className="flex items-center gap-2 font-mono text-2xl sm:text-3xl font-bold tracking-widest text-[var(--accent-primary)]">
                {roomCode.split('-').map((part, idx) => (
                  <React.Fragment key={idx}>
                    {idx > 0 && <span className="text-[var(--text-dim)]">-</span>}
                    <span className="px-3 py-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg">
                      {part}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Room Actions: Copy Link, Share, QR */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              <button
                type="button"
                onClick={handleCopyLink}
                className="mog-btn mog-btn-secondary !min-h-[40px] !text-xs font-medium gap-1.5"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Link</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleShare}
                className="mog-btn mog-btn-secondary !min-h-[40px] !text-xs font-medium gap-1.5"
              >
                <Share2 className="w-4 h-4" />
                <span>Share</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  sound.playPop();
                  setQrModalOpen(true);
                }}
                className="mog-btn mog-btn-secondary !min-h-[40px] !text-xs font-medium gap-1.5"
              >
                <QrIcon className="w-4 h-4" />
                <span>Show QR</span>
              </button>
            </div>

            {/* Connected Room Peers */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[var(--text-main)] flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                  <span>Participants ({connectedRoomPeers.length + 1})</span>
                </span>
                <span className="text-[11px] text-[var(--text-dim)]">Max 10</span>
              </div>

              <div className="space-y-1.5">
                {/* You */}
                <div className="p-2.5 rounded-lg bg-[var(--bg-card-subtle)] border border-[var(--border-subtle)] flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="font-semibold text-[var(--text-main)]">You (Host/Peer)</span>
                  </div>
                  <span className="text-[11px] text-[var(--text-muted)]">Connected</span>
                </div>

                {/* Other Peers */}
                {connectedRoomPeers.map((peer) => {
                  const isSelected = selectedDeviceId === peer.id;
                  return (
                    <div
                      key={peer.id}
                      onClick={() => onSelectDevice?.(peer)}
                      className={`p-2.5 rounded-lg border transition-all flex items-center justify-between text-xs cursor-pointer ${
                        isSelected
                          ? 'border-[var(--accent-primary)] bg-[var(--bg-elevated)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-card-subtle)] hover:border-[var(--border-active)]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {getPlatformIcon(peer.platform)}
                        <span className="font-semibold text-[var(--text-main)]">{peer.name}</span>
                      </div>
                      <span className="text-[11px] text-emerald-400 font-medium">Online</span>
                    </div>
                  );
                })}

                {connectedRoomPeers.length === 0 && (
                  <p className="text-xs text-[var(--text-dim)] text-center py-2">
                    Waiting for peers to join with code or QR...
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* NO ACTIVE ROOM: CREATE OR JOIN */
          <div>
            <div className="text-center mb-5">
              <h3 className="text-base font-semibold text-[var(--text-main)] mb-1">
                Direct Room Sharing
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Connect across different Wi-Fi networks, mobile data, or VPNs using a 6-digit code.
              </p>
            </div>

            {/* Create Room Button (R2: Disabled until connection ready) */}
            <div className="mb-5">
              <button
                type="button"
                disabled={!isConnected}
                onClick={() => {
                  sound.playPop();
                  onCreateRoom();
                }}
                className="w-full mog-btn mog-btn-primary font-semibold text-sm justify-center"
              >
                {!isConnected ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting to Server...</span>
                  </>
                ) : (
                  <span>Create a New Room</span>
                )}
              </button>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-[1px] bg-[var(--border-subtle)]" />
              <span className="text-[11px] font-medium text-[var(--text-dim)] uppercase">or join</span>
              <div className="flex-1 h-[1px] bg-[var(--border-subtle)]" />
            </div>

            {/* Join Room Input (R7) */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitJoin(joinInput);
              }}
              className="space-y-3"
            >
              <label htmlFor={inputId} className="block text-xs font-medium text-[var(--text-muted)]">
                Enter 6-digit Code or Paste Link
              </label>

              <div className="flex items-center gap-2">
                <input
                  id={inputId}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  placeholder="123-456"
                  value={joinInput}
                  onChange={handleInputChange}
                  disabled={!isConnected || isJoining}
                  className="flex-1 mog-input font-mono text-center tracking-widest text-base font-bold placeholder:font-normal placeholder:tracking-normal placeholder:text-xs"
                />

                <button
                  type="submit"
                  disabled={!isConnected || isJoining || joinInput.replace(/[^\d]/g, '').length !== 6}
                  className="mog-btn mog-btn-secondary !min-h-[44px] !px-4 text-xs font-semibold"
                >
                  {isJoining ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-primary)]" />
                  ) : (
                    <span>Join</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* QR Code Modal */}
      {qrModalOpen && qrDataUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-pop">
          <div className="mog-card p-6 max-w-sm w-full flex flex-col items-center text-center relative bg-[var(--bg-card)]">
            <button
              type="button"
              onClick={() => setQrModalOpen(false)}
              className="absolute top-3 right-3 mog-btn-icon !min-w-[32px] !min-h-[32px] !p-1 text-[var(--text-muted)]"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-bold text-[var(--text-main)] mb-1">
              Scan to Join Room
            </h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Scan this QR code with any mobile camera to join immediately.
            </p>

            <div className="p-3 bg-white rounded-2xl shadow-xl mb-4">
              <img src={qrDataUrl} alt="Room QR Code" className="w-56 h-56 block rounded-lg" />
            </div>

            <div className="font-mono text-lg font-bold text-[var(--accent-primary)] mb-4">
              Code: {roomCode}
            </div>

            <button
              type="button"
              onClick={() => setQrModalOpen(false)}
              className="w-full mog-btn mog-btn-secondary !min-h-[40px] text-xs font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
