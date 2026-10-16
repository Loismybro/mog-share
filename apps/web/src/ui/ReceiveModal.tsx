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
  Download,
} from 'lucide-react';

export function ReceiveModal(props: {
  onClose: () => void;
  deviceName: string;
  roomCode: string | null;
  publicUrl: string;
  autoAcceptNearby: boolean;
  onToggleAutoAccept: () => void;
  onGoVault: () => void;
  onSimulateIncoming?: () => void;
  buildRoomLink: (code: string) => Promise<string>;
  pushToast: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState('');

  useEffect(() => {
    let active = true;
    const resolveTargetUrl = async () => {
      if (props.roomCode) {
        return props.buildRoomLink(props.roomCode);
      }
      if (props.publicUrl.trim()) {
        return props.publicUrl.trim();
      }
      if (typeof window !== 'undefined') {
        const host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') {
          try {
            const res = await fetch('/api/info');
            const info = await res.json();
            const lan = info?.lanAddresses?.[0];
            if (lan) {
              return `${window.location.protocol}//${lan}:${window.location.port || '4000'}`;
            }
          } catch {
            /* fallback */
          }
        }
        return window.location.origin;
      }
      return '';
    };

    resolveTargetUrl().then((l) => {
      if (!active) return;
      setLink(l);
      if (l) {
        QRCode.toDataURL(l, {
          width: 220,
          margin: 1,
          color: { dark: '#0f172a', light: '#ffffff' },
        })
          .then((url) => {
            if (active) setQrUrl(url);
          })
          .catch(() => {
            if (active) setQrUrl(null);
          });
      }
    });

    return () => {
      active = false;
    };
  }, [props.roomCode, props.publicUrl, props.buildRoomLink]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(link || props.roomCode || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      props.pushToast('success', 'Connection URL copied to clipboard!');
    } catch {
      props.pushToast('error', 'Failed to copy link');
    }
  };

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div
        className="modal receive-mode-modal"
        role="dialog"
        aria-label="Receive Beacon Mode"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="flex items-center gap-2">
            <span className="badge badge-cyan">
              <Radio size={13} className="pulse-icon" /> RECEIVE BEACON ACTIVE
            </span>
            <h2>Ready to Receive</h2>
          </div>
          <button className="icon-btn" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="receive-mode-body">
          {/* Animated Receiving Sonar Beacon */}
          <div className="receive-beacon-card">
            <div className="receive-beacon-sonar">
              <div className="beacon-ring ring-a" />
              <div className="beacon-ring ring-b" />
              <div className="beacon-ring ring-c" />
              <div className="beacon-avatar">
                <ArrowDownLeft size={26} />
              </div>
            </div>
            <div className="receive-beacon-info">
              <h3 className="beacon-title">{props.deviceName}</h3>
              <p className="beacon-desc">
                Auto-discoverable to all devices on Wi-Fi, Hotspot & Active Room
              </p>
              <div className="beacon-status-pill mono">
                <span className="beacon-dot" />
                <span>LISTENING FOR INCOMING P2P STREAMS</span>
              </div>
            </div>
          </div>

          {/* QR Code & PIN Room connection */}
          <div className="receive-connect-card">
            <div className="receive-qr-left">
              {qrUrl ? (
                <img
                  src={qrUrl}
                  alt="QR code for sender device"
                  className="receive-qr-img"
                  width={148}
                  height={148}
                />
              ) : (
                <div className="receive-qr-placeholder mono small muted">Generating QR…</div>
              )}
            </div>

            <div className="receive-connect-details">
              <h4 className="font-bold text-sm">Instant Camera / URL Pair</h4>
              <p className="small muted">
                Scan this QR code from any phone or open the link below to send files directly to this device:
              </p>
              <div className="receive-pin-box mono">
                {props.roomCode ? `ROOM: ${props.roomCode}` : link || 'LOCAL WI-FI / HOTSPOT'}
              </div>

              <div className="receive-connect-btns">
                {link && (
                  <button className="btn btn-sm btn-secondary" onClick={handleCopyLink}>
                    {copied ? (
                      <>
                        <Check size={14} /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={14} /> Copy URL
                      </>
                    )}
                  </button>
                )}
                {typeof navigator.share === 'function' && link && (
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() =>
                      navigator.share({ title: 'MogShare Receive Beacon', url: link }).catch(() => {})
                    }
                  >
                    <Share2 size={14} /> Share
                  </button>
                )}
                {props.onSimulateIncoming && (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      props.onSimulateIncoming?.();
                      props.onClose();
                    }}
                    title="Send a test file to yourself right now"
                  >
                    <Download size={14} /> Test Receive File
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Auto-Accept Toggle & Vault Navigation */}
          <div className="receive-settings-row">
            <button
              className={`btn btn-sm flex-1 ${props.autoAcceptNearby ? 'btn-emerald' : 'btn-secondary'}`}
              onClick={props.onToggleAutoAccept}
            >
              <Sparkles size={14} />
              {props.autoAcceptNearby
                ? 'Auto-Accept: ON (Instant AirDrop Mode)'
                : 'Auto-Accept: OFF (Ask Confirmation)'}
            </button>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => {
                props.onClose();
                props.onGoVault();
              }}
              title="Open Personal Space Vault"
            >
              <HardDrive size={14} /> Open Vault
            </button>
          </div>

          <p className="small muted center">
            <Wifi size={13} style={{ display: 'inline', marginRight: 5 }} />
            Every received file is SHA-256 verified and saved in your <strong>Personal Space Vault</strong> for instant viewing and download.
          </p>
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={props.onClose}>
            Keep Listening in Background
          </button>
        </div>
      </div>
    </div>
  );
}
