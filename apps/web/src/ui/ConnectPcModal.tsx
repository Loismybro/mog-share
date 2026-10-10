import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { Laptop, Smartphone, Wifi, QrCode, Copy, Check, X, ArrowRight, ExternalLink } from 'lucide-react';

export function ConnectPcModal(props: {
  onClose: () => void;
  publicUrl?: string;
  roomCode?: string | null;
  pushToast: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pcUrl = props.publicUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

  useEffect(() => {
    QRCode.toDataURL(pcUrl, { width: 220, margin: 1 })
      .then(setQrUrl)
      .catch(() => setQrUrl(null));
  }, [pcUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pcUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      props.pushToast('success', 'URL copied to clipboard');
    } catch {
      props.pushToast('error', 'Failed to copy URL');
    }
  };

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal card brutal-card connect-pc-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="flex items-center gap-2">
            <span className="badge badge-brutal badge-pale-cyan"><Laptop size={14} /> XENDER WEBSHARE</span>
            <h2 className="text-xl font-extrabold">Connect to PC / Laptop</h2>
          </div>
          <button className="icon-btn brutal-btn-icon" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="connect-pc-body">
          <p className="muted small mb-4">
            Transfer files between this phone and any computer (Windows, Mac, Chromebook, Linux) with zero software installed on the computer!
          </p>

          <div className="pc-steps-grid">
            <div className="pc-step-card pale-butter-bg">
              <div className="step-num mono">1</div>
              <div className="step-content">
                <strong>Same Wi-Fi or Hotspot</strong>
                <p className="small muted">Ensure your PC and this device are on the same Wi-Fi router or Android mobile hotspot.</p>
              </div>
            </div>

            <div className="pc-step-card pale-mint-bg">
              <div className="step-num mono">2</div>
              <div className="step-content">
                <strong>Open Web Browser on PC</strong>
                <p className="small muted">Open Chrome, Edge, Safari, or Firefox on your computer and type this URL:</p>
                <div className="pc-url-box mono font-bold">
                  <span>{pcUrl}</span>
                  <button className="btn btn-brutal btn-xs" onClick={handleCopy}>
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="pc-step-card pale-lavender-bg">
              <div className="step-num mono">3</div>
              <div className="step-content">
                <strong>Scan QR Code or Enter Room</strong>
                <p className="small muted">Or scan this QR code with your phone or PC camera to connect immediately:</p>
                {qrUrl && (
                  <div className="pc-qr-box">
                    <img src={qrUrl} alt="QR Code to connect PC" width={180} height={180} className="pc-qr-img" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-brutal btn-ghost-brutal" onClick={props.onClose}>
            Done
          </button>
          <button
            className="btn btn-brutal btn-primary-brutal"
            onClick={() => window.open(pcUrl, '_blank')}
          >
            <ExternalLink size={15} /> Open in New Window
          </button>
        </div>
      </div>
    </div>
  );
}
