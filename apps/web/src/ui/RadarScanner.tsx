import {
  Smartphone,
  Laptop,
  MonitorSmartphone,
  Wifi,
  RefreshCw,
  MessageSquare,
  Send,
} from 'lucide-react';
import type { Device, Platform } from '../types';

function platformIcon(platform: Platform, size = 18) {
  if (platform === 'ios' || platform === 'android') return <Smartphone size={size} aria-hidden />;
  if (platform === 'web') return <MonitorSmartphone size={size} aria-hidden />;
  return <Laptop size={size} aria-hidden />;
}

export function RadarScanner(props: {
  deviceName: string;
  deviceSubtitle?: string;
  peers: Device[];
  onSelectPeer: (peer: Device) => void;
  onMessagePeer?: (peer: Device) => void;
  onRescan?: () => void;
  isScanning: boolean;
  hasStagedFiles?: boolean;
}) {
  const {
    deviceName,
    deviceSubtitle,
    peers,
    onSelectPeer,
    onMessagePeer,
    onRescan,
    isScanning,
    hasStagedFiles,
  } = props;

  // Place peers cleanly along the circular orbit (radius 36% of square stage so they never clip)
  const peerPositions = peers.slice(0, 8).map((peer, i) => {
    const count = Math.min(peers.length, 8);
    const angle = ((i * (360 / Math.max(count, 1)) - 55) * Math.PI) / 180;
    const radius = count === 1 ? 33 : 35;
    const x = 50 + radius * Math.cos(angle);
    const y = 50 + radius * Math.sin(angle);
    return { peer, x, y };
  });

  return (
    <div className="radar-console-card">
      <div className="radar-header">
        <div className="radar-header-left">
          <span className="radar-status-pill">
            <span className={`radar-live-dot ${isScanning ? 'active' : ''}`} />
            <span>Nearby Discovery</span>
          </span>
          <span className="radar-peer-count">
            {peers.length === 0
              ? 'Searching local Wi-Fi & Hotspot…'
              : `${peers.length} ${peers.length === 1 ? 'device ready' : 'devices ready'}`}
          </span>
        </div>

        {onRescan && (
          <button
            type="button"
            className="radar-action-chip"
            onClick={onRescan}
            title="Refresh nearby device scan"
          >
            <RefreshCw size={13} />
            <span>Scan Again</span>
          </button>
        )}
      </div>

      <div className="radar-stage-wrap">
        <div className="radar-disc">
          {/* Subtle concentric rings that fit 100% inside the circular disc */}
          <div className="radar-ring ring-inner" />
          <div className="radar-ring ring-mid" />
          <div className="radar-ring ring-outer" />

          {/* Soft rotating scanner sweep */}
          <div className="radar-sweep-cone" />

          {/* Center Node (This Device) */}
          <div className="radar-center-node" title={`This device: ${deviceName}`}>
            <div className="center-pulse-halo" />
            <div className="center-avatar-box">
              <Laptop size={20} />
            </div>
            <span className="center-label">{deviceName}</span>
            {deviceSubtitle && <span className="center-sublabel">{deviceSubtitle}</span>}
          </div>

          {/* Discovered Peer Nodes in Orbit */}
          {peerPositions.map(({ peer, x, y }) => (
            <div
              key={peer.id}
              className="radar-peer-wrapper"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <button
                type="button"
                className={`radar-peer-node ${hasStagedFiles ? 'ready-to-send' : ''}`}
                onClick={() => onSelectPeer(peer)}
                title={
                  hasStagedFiles
                    ? `Send staged files to ${peer.name}`
                    : `Pick files to send to ${peer.name}`
                }
              >
                <div className="peer-node-avatar">
                  {platformIcon(peer.platform, 19)}
                  <span className="peer-node-online-dot" />
                  {hasStagedFiles && (
                    <span className="peer-send-badge">
                      <Send size={9} />
                    </span>
                  )}
                </div>
                <div className="peer-node-pill">
                  <span className="peer-node-name">{peer.name}</span>
                  <span className="peer-node-meta">
                    {peer.rttMs != null ? `${peer.rttMs}ms` : 'Local Wi-Fi'}
                    {peer.batteryLevel != null ? ` · ${peer.batteryLevel}%` : ''}
                  </span>
                </div>
              </button>
              {onMessagePeer && (
                <button
                  type="button"
                  className="radar-peer-msg-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMessagePeer(peer);
                  }}
                  title={`Message ${peer.name}`}
                >
                  <MessageSquare size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="radar-footer">
        <Wifi size={14} className="radar-footer-icon" />
        <span>
          {peers.length > 0
            ? hasStagedFiles
              ? 'Tap any device above to send your selected files immediately.'
              : 'Tap a device to send files directly over Wi-Fi (uses 0 MB of internet data).'
            : 'Open MogShare on another phone, tablet, or computer on the same Wi-Fi or Hotspot.'}
        </span>
      </div>
    </div>
  );
}
