import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { 
  Copy, 
  Check, 
  ArrowRight, 
  Share2, 
  Users, 
  QrCode as QrIcon 
} from 'lucide-react';
import { sound } from '../utils/audio';
import { Device } from '../types';

interface OnlineRoomCardProps {
  roomCode: string | null;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onLeaveRoom: () => void;
  connectedRoomPeers: Device[];
}

export const OnlineRoomCard: React.FC<OnlineRoomCardProps> = ({
  roomCode,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  connectedRoomPeers,
}) => {
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);

  useEffect(() => {
    if (roomCode) {
      const shareUrl = `${window.location.origin}/#room=${roomCode}`;
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
    const shareUrl = `${window.location.origin}/#room=${roomCode}`;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return;
    sound.playPop();
    onJoinRoom(joinCodeInput.trim());
    setJoinCodeInput('');
  };

  return (
    <div className="w-full max-w-xl mx-auto px-4 mb-6">
      <div className="neo-box p-6 bg-white">
        
        {roomCode ? (
          <div>
            <div className="flex items-center justify-between pb-4 border-b-2 border-black">
              <div className="flex items-center gap-2">
                <span className="neo-badge bg-[#FFC900] text-black">
                  ACTIVE P2P ROOM
                </span>
              </div>
              <button
                onClick={() => {
                  sound.playPop();
                  onLeaveRoom();
                }}
                className="neo-badge bg-[#FF6B6B] text-white hover:bg-red-600 cursor-pointer"
              >
                Leave Room
              </button>
            </div>

            {/* Room Code Banner */}
            <div className="my-6 flex flex-col items-center">
              <div className="text-4xl sm:text-5xl font-mono font-black tracking-widest text-black px-6 py-4 rounded-2xl bg-[#FF90E8] border-3 border-black shadow-[6px_6px_0px_#000] select-all">
                {roomCode}
              </div>
              <p className="text-xs font-bold text-slate-700 mt-3 text-center">
                Share this 6-digit code or scan the QR to connect any remote phone or computer.
              </p>
            </div>

            {/* Actions: Copy Link & Show QR */}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleCopy}
                className="neo-btn neo-btn-yellow px-4 py-2.5 text-xs font-bold"
              >
                {copied ? <Check className="w-4 h-4 stroke-[3]" /> : <Copy className="w-4 h-4 stroke-[3]" />}
                <span>{copied ? 'Link Copied!' : 'Copy Magic Link'}</span>
              </button>

              <button
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
            <div className="mt-6 pt-4 border-t-2 border-black">
              <div className="flex items-center justify-between text-xs font-bold text-black mb-3">
                <span className="flex items-center gap-1.5 uppercase font-mono">
                  <Users className="w-4 h-4 stroke-[2.5]" />
                  <span>Room Peers ({connectedRoomPeers.length})</span>
                </span>
                <span className="neo-badge bg-[#00F59B] text-black text-[10px]">
                  E2EE P2P
                </span>
              </div>
              {connectedRoomPeers.length === 0 ? (
                <div className="p-3 rounded-xl border-2 border-dashed border-black/30 text-center text-xs font-medium text-slate-500 italic bg-amber-50/50">
                  Waiting for peer to enter 6-digit code or scan QR code...
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {connectedRoomPeers.map((peer) => (
                    <span
                      key={peer.id}
                      className="neo-badge bg-[#D3B5FF] text-black flex items-center gap-1.5 py-1 px-3 shadow-[2px_2px_0px_#000]"
                    >
                      <span className="w-2 h-2 rounded-full bg-black inline-block" />
                      {peer.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <span className="neo-badge bg-[#FF90E8] text-black mb-2 inline-block">
                CROSS-NETWORK SHARING
              </span>
              <h3 className="text-lg font-black uppercase text-black m-0">
                P2P Room Connection
              </h3>
              <p className="text-xs font-medium text-slate-700 mt-1 m-0">
                Transfer files with any device in another city or on 5G without size caps.
              </p>
            </div>

            {/* Join Room Form */}
            <form onSubmit={handleJoinSubmit} className="flex gap-2">
              <input
                type="text"
                placeholder="Enter 6-digit code (e.g. 748-291)"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value)}
                className="flex-1 px-4 py-3 rounded-xl border-3 border-black text-sm font-mono font-bold tracking-wider placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FFC900] shadow-[3px_3px_0px_#000]"
              />
              <button
                type="submit"
                disabled={!joinCodeInput.trim()}
                className="neo-btn neo-btn-pink px-5 py-3 text-xs font-black uppercase disabled:opacity-40"
              >
                <span>Join</span>
                <ArrowRight className="w-4 h-4 stroke-[3]" />
              </button>
            </form>

            <div className="flex items-center gap-3">
              <div className="h-[2px] flex-1 bg-black/20" />
              <span className="neo-badge bg-white text-black text-[10px]">OR</span>
              <div className="h-[2px] flex-1 bg-black/20" />
            </div>

            {/* Create Room Button */}
            <button
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

        {/* Dynamic QR Code Modal Popup */}
        {showQrModal && qrDataUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="neo-box p-6 max-w-sm w-full bg-white border-3 border-black text-center relative shadow-[8px_8px_0px_#000]">
              <span className="neo-badge bg-[#FFC900] text-black mb-2 inline-block">
                ZERO INSTALL GUEST SCAN
              </span>
              <h4 className="text-lg font-black text-black m-0 uppercase">
                Scan with iPhone or Android
              </h4>
              <p className="text-xs font-medium text-slate-700 mt-1 mb-4">
                Point your native Camera app to immediately open the web receiver in Safari/Chrome!
              </p>

              <div className="p-3 bg-white border-3 border-black rounded-2xl inline-block shadow-[4px_4px_0px_#000]">
                <img src={qrDataUrl} alt="Room QR Code" className="w-56 h-56 mx-auto rounded-lg" />
              </div>

              <div className="mt-4 font-mono text-2xl font-black text-black bg-[#FF90E8] border-2 border-black py-1.5 px-4 rounded-xl inline-block shadow-[3px_3px_0px_#000]">
                {roomCode}
              </div>

              <button
                onClick={() => {
                  sound.playPop();
                  setShowQrModal(false);
                }}
                className="neo-btn neo-btn-black w-full mt-5 py-3 text-xs font-bold uppercase"
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
