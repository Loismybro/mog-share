import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { Laptop, Copy, Check, X } from 'lucide-react';

export function ConnectPcModal(props: {
  onClose: () => void;
  publicUrl?: string;
  roomCode?: string | null;
  pushToast: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lanUrl, setLanUrl] = useState<string>(
    props.publicUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173')
  );

  useEffect(() => {
    let active = true;
    async function resolveUrl() {
      if (props.publicUrl?.trim()) {
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
              const port = window.location.port || String(info.port || 4000);
              return `${window.location.protocol}//${lan}:${port}`;
            }
          } catch {
            /* fallback */
          }
        }
        return window.location.origin;
      }
      return 'http://localhost:5173';
    }

    resolveUrl().then((resolved) => {
      if (!active) return;
      const finalUrl = props.roomCode ? `${resolved.replace(/\/+$/, '')}/#room=${props.roomCode}` : resolved;
      setLanUrl(finalUrl);
      QRCode.toDataURL(finalUrl, {
        width: 200,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
        .then((u) => {
          if (active) setQrUrl(u);
        })
        .catch(() => {
          if (active) setQrUrl(null);
        });
    });

    return () => {
      active = false;
    };
  }, [props.publicUrl, props.roomCode]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(lanUrl);
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
        className="modal connect-pc-modal"
        role="dialog"
        aria-label="Pair Another Device"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="flex items-center gap-2">
            <span className="badge badge-indigo">
              <Laptop size={13} /> Quick Pair
            </span>
            <h2>Pair Phone, Tablet, or PC</h2>
          </div>
          <button className="icon-btn" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="connect-pc-body">
          <p className="muted small">
            Connect any Android, iPhone, iPad, Mac, or Windows PC without installing any app.
          </p>

          <div className="pc-steps-grid">
            <div className="pc-step-card">
              <div className="step-num mono">1</div>
              <div className="step-content">
                <strong>Same Wi-Fi or Hotspot (Zero Internet Data)</strong>
                <p className="small muted">
                  If both devices are on the same Wi-Fi or mobile hotspot, files transfer directly over local Wi-Fi without using your internet data.
                </p>
              </div>
            </div>

            <div className="pc-step-card">
              <div className="step-num mono">2</div>
              <div className="step-content">
                <strong>Open Link or Scan QR Code</strong>
                <p className="small muted">
                  Open this link in the browser on your other device, or scan the QR code below:
                </p>
                <div className="pc-url-box mono">
                  <span>{lanUrl}</span>
                  <button className="btn btn-xs btn-secondary" onClick={handleCopy}>
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
                {qrUrl && (
                  <div className="pc-qr-box">
                    <img
                      src={qrUrl}
                      alt="QR Code to connect device"
                      width={160}
                      height={160}
                      className="pc-qr-img"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
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
