import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import {
  ArrowDownLeft,
  Radio,
  Wifi,
  HardDrive,
  Copy,
  Check,
  X,
  Share2,
  Sparkles,
} from 'lucide-react';

export function ReceiveModal(props: {
  onClose: () => void;
  deviceName: string;
  roomCode: string | null;
  publicUrl: string;
  autoAcceptNearby: boolean;
  onToggleAutoAccept: () => void;
  onGoVault: () => void;
  buildRoomLink: (code: string) => Promise<string>;
  pushToast: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState('');

  useEffect(() => {
    let active = true;
    const targetUrl = props.roomCode
      ? props.buildRoomLink(props.roomCode)
      : Promise.resolve(props.publicUrl || (typeof window !== 'undefined' ? window.location.origin : ''));

    targetUrl.then((l) => {
      if (!active) return;
      setLink(l);
      if (l) {
        QRCode.toDataURL(l, { width: 220, margin: 1 })
          .then((url) => { if (active) setQrUrl(url); })
          .catch(() => { if (active) setQrUrl(null); });
      }
    });

    return () => { active = false; };
  }, [props.roomCode, props.publicUrl, props.buildRoomLink]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(link || props.roomCode || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      props.pushToast('success', 'Connection link copied!');
    } catch {
      props.pushToast('error', 'Failed to copy link');
    }
  };

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div
        className="modal card brutal-card receive-mode-modal"
        role="dialog"
        aria-label="Receive Mode"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-head">
          <div className="flex items-center gap-2">
            <span className="badge badge-brutal badge-pale-cyan">
              <Radio size={14} className="pulse-icon" /> XENDER RECEIVE BEACON
            </span>
            <h2 className="text-xl font-extrabold">Ready to Receive</h2>
          </div>
          <button className="icon-btn brutal-btn-icon" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="receive-mode-body">
          {/* Animated Receiving Sonar Beacon */}
          <div className="card brutal-card receive-beacon-card pale-cyan-bg">
            <div className="receive-beacon-sonar">
              <div className="beacon-ring ring-a"></div>
              <div className="beacon-ring ring-b"></div>
              <div className="beacon-ring ring-c"></div>
              <div className="beacon-avatar">
                <ArrowDownLeft size={28} />
              </div>
            </div>
            <div className="receive-beacon-info">
              <h3 className="beacon-title font-extrabold">{props.deviceName}</h3>
              <p className="beacon-desc mono small">
                Visible to all sender devices on Wi-Fi or Hotspot
              </p>
              <div className="beacon-status-pill mono small font-bold">
                <span className="beacon-dot"></span>
                <span>LISTENING FOR INCOMING FILES</span>
              </div>
            </div>
          </div>

          {/* QR Code & PIN Room connection */}
          <div className="card brutal-card receive-connect-card pale-paper-bg">
            <div className="receive-qr-left">
              {qrUrl ? (
                <img
                  src={qrUrl}
                  alt="QR code for sender device"
                  className="receive-qr-img"
                  width={150}
                  height={150}
                />
              ) : (
                <div className="receive-qr-placeholder mono small muted">
                  Generating QR…
                </div>
              )}
            </div>

            <div className="receive-connect-details">
              <h4 className="font-bold text-sm">Quick Sender Connection</h4>
              <p className="small muted">
                Sender can scan this QR code or connect with PIN Room Code:
              </p>
              {props.roomCode ? (
                <div className="receive-pin-box mono font-extrabold">
                  {props.roomCode}
                </div>
              ) : (
                <div className="receive-pin-box mono font-bold small text-muted">
                  LOCAL WI-FI / HOTSPOT
                </div>
              )}

              <div className="receive-connect-btns">
                {link && (
                  <button className="btn btn-brutal btn-xs" onClick={handleCopyLink}>
                    {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy Link</>}
                  </button>
                )}
                {typeof navigator.share === 'function' && link && (
                  <button
                    className="btn btn-brutal btn-xs"
                    onClick={() => navigator.share({ title: 'Mog Share Beacon', url: link }).catch(() => {})}
                  >
                    <Share2 size={12} /> Share
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Auto-Accept Toggle & Vault Navigation */}
          <div className="receive-settings-row">
            <button
              className={`btn btn-brutal btn-sm flex-1 ${props.autoAcceptNearby ? 'btn-pale-mint' : 'btn-ghost-brutal'}`}
              onClick={props.onToggleAutoAccept}
            >
              <Sparkles size={14} />
              {props.autoAcceptNearby ? 'Auto-Accept: ON (AirDrop mode)' : 'Auto-Accept: OFF (Ask me)'}
            </button>
            <button
              className="btn btn-brutal btn-pale-lavender btn-sm"
              onClick={() => {
                props.onClose();
                props.onGoVault();
              }}
              title="Open Personal Space Vault"
            >
              <HardDrive size={14} /> Personal Space
            </button>
          </div>

          <p className="small muted center mt-2">
            <Wifi size={13} style={{ display: 'inline', marginRight: 4 }} />
            Files received will be automatically preserved in your <strong>Personal Space</strong> so you can open, play, and share them anytime!
          </p>
        </div>

        {/* Footer */}
        <div className="modal-actions">
          <button className="btn btn-brutal btn-primary-brutal" onClick={props.onClose}>
            Done (Keep Receiving in Background)
          </button>
        </div>
      </div>
    </div>
  );
}
