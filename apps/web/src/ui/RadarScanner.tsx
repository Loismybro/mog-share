import React from 'react';
import { Smartphone, Laptop, MonitorSmartphone, Wifi, Radio } from 'lucide-react';
import type { Device, Platform } from '../types';

function platformIcon(platform: Platform, size = 18) {
  if (platform === 'ios' || platform === 'android') return <Smartphone size={size} aria-hidden />;
  if (platform === 'web') return <MonitorSmartphone size={size} aria-hidden />;
  return <Laptop size={size} aria-hidden />;
}

export function RadarScanner(props: {
  deviceName: string;
  peers: Device[];
  onSelectPeer: (peer: Device) => void;
  isScanning: boolean;
}) {
  const { deviceName, peers, onSelectPeer, isScanning } = props;

  // Calculate orbital positions for up to 8 peers
  const peerPositions = peers.slice(0, 8).map((peer, i) => {
    const angle = (i * (360 / Math.max(peers.length, 1)) - 90) * (Math.PI / 180);
    // Radius percentage (between 32% and 42% from center)
    const radius = 37 + (i % 2 === 0 ? 5 : -4);
    const x = 50 + radius * Math.cos(angle);
    const y = 50 + radius * Math.sin(angle);
    return { peer, x, y };
  });

  return (
    <div className="radar-container brutal-card">
      <div className="radar-header">
        <div className="radar-badge badge-brutal badge-pale-mint">
          <Radio size={14} className={isScanning ? 'pulse-icon' : ''} />
          <span>XENDER RADAR DISCOVERY</span>
        </div>
        <span className="mono small font-bold">
          {peers.length} {peers.length === 1 ? 'PEER FOUND' : 'PEERS FOUND'}
        </span>
      </div>

      <div className="radar-screen">
        {/* Concentric rings */}
        <div className="radar-ring ring-1"></div>
        <div className="radar-ring ring-2"></div>
        <div className="radar-ring ring-3"></div>

        {/* Crosshair grid lines */}
        <div className="radar-crosshair radar-axis-x"></div>
        <div className="radar-crosshair radar-axis-y"></div>

        {/* Sweeping Beam */}
        <div className="radar-sweep-beam"></div>

        {/* Center Node (You) */}
        <div className="radar-center-node" title={`You: ${deviceName}`}>
          <div className="center-pulse-halo"></div>
          <div className="center-avatar-box">
            <Smartphone size={20} />
          </div>
          <span className="center-label mono small">YOU</span>
        </div>

        {/* Orbiting Peer Nodes */}
        {peerPositions.map(({ peer, x, y }) => (
          <button
            key={peer.id}
            className="radar-peer-node"
            style={{ left: `${x}%`, top: `${y}%` }}
            onClick={() => onSelectPeer(peer)}
            title={`Send files to ${peer.name}`}
          >
            <div className="peer-node-avatar">
              {platformIcon(peer.platform, 18)}
              <span className="peer-node-online-dot"></span>
            </div>
            <span className="peer-node-name mono">{peer.name}</span>
          </button>
        ))}

        {/* Empty state hint */}
        {peers.length === 0 && (
          <div className="radar-empty-hint mono small">
            <Wifi size={18} className="spin-slow" />
            <span>Scanning Wi-Fi & Hotspot…</span>
          </div>
        )}
      </div>

      <p className="radar-footer-hint small muted center">
        {peers.length > 0
          ? 'Tap any peer in the radar to send files instantly!'
          : 'Devices on the same network or mobile hotspot appear automatically in orbit.'}
      </p>
    </div>
  );
}
