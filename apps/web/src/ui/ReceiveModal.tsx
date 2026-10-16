import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import {
  ArrowDownLeft,
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
      props.pushToast('success', 'Link copied to clipboard');
    } catch {
      props.pushToast('error', 'Failed to copy link');
    }
  };

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div
        className="modal receive-mode-modal"
        role="dialog"
        aria-label="Receive Files"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="flex items-center gap-2">
            <span className="badge badge-emerald">Listening</span>
            <h2>Ready to Receive Files</h2>
          </div>
          <button className="icon-btn" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="receive-mode-body">
          <div className="receive-beacon-card">
            <div className="receive-beacon-sonar">
              <div className="beacon-ring ring-a" />
              <div className="beacon-ring ring-b" />
              <div className="beacon-ring ring-c" />
              <div className="beacon-avatar">
                <ArrowDownLeft size={24} />
              </div>
            </div>
            <div className="receive-beacon-info">
              <h3 className="beacon-title">{props.deviceName}</h3>
              <p className="beacon-desc">
                Visible to nearby devices on your Wi-Fi, Hotspot, or active Online Room
              </p>
              <div className="beacon-status-pill">
                <span className="beacon-dot" />
                <span>Waiting for incoming files…</span>
              </div>
            </div>
          </div>

          <div className="receive-connect-card">
            <div className="receive-qr-left">
              {qrUrl ? (
                <img
                  src={qrUrl}
                  alt="QR code to connect and send files"
                  className="receive-qr-img"
                  width={144}
                  height={144}
                />
              ) : (
                <div className="receive-qr-placeholder small muted">Generating QR…</div>
              )}
            </div>

            <div className="receive-connect-details">
              <h4 className="font-bold text-sm">Scan QR Code from Sender Device</h4>
              <p className="small muted">
                Point the other phone or tablet's camera at this QR code, or open this address:
              </p>
              <div className="receive-pin-box mono">
                {props.roomCode ? `Room Code: ${props.roomCode}` : link || 'Same Wi-Fi / Hotspot'}
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
                        <Copy size={14} /> Copy Link
                      </>
                    )}
                  </button>
                )}
                {typeof navigator.share === 'function' && link && (
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() =>
                      navigator.share({ title: 'Send files to me on MogShare', url: link }).catch(() => {})
                    }
                  >
                    <Share2 size={14} /> Share Link
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="receive-settings-row">
            <button
              className={`btn btn-sm flex-1 ${props.autoAcceptNearby ? 'btn-emerald' : 'btn-secondary'}`}
              onClick={props.onToggleAutoAccept}
            >
              <Sparkles size={14} />
              {props.autoAcceptNearby
                ? 'Auto-Accept: ON (Save automatically)'
                : 'Auto-Accept: OFF (Ask before receiving)'}
            </button>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => {
                props.onClose();
                props.onGoVault();
              }}
            >
              <HardDrive size={14} /> Saved Files
            </button>
          </div>

          <p className="small muted center">
            <Wifi size={13} style={{ display: 'inline', marginRight: 5 }} />
            Local Wi-Fi transfers happen directly between your devices and use <strong>0 MB</strong> of internet data.
          </p>
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
