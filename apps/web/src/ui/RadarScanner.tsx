import React from 'react';
import {
  Smartphone,
  Laptop,
  MonitorSmartphone,
  Wifi,
  Radio,
  RefreshCw,
  Sparkles,
  BatteryCharging,
  MessageSquare,
  Send,
  Download,
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
  onSimulateIncoming?: () => void;
  demoEnabled?: boolean;
  onToggleDemo?: () => void;
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
    onSimulateIncoming,
    demoEnabled,
    onToggleDemo,
    isScanning,
    hasStagedFiles,
  } = props;

  // Calculate orbital positions for up to 8 peers
  const peerPositions = peers.slice(0, 8).map((peer, i) => {
    const angle = (i * (360 / Math.max(peers.length, 1)) - 65) * (Math.PI / 180);
    const radius = peers.length === 1 ? 33 : 35 + (i % 2 === 0 ? 4 : -4);
    const x = 50 + radius * Math.cos(angle);
    const y = 50 + radius * Math.sin(angle);
    return { peer, x, y };
  });

  return (
    <div className="radar-console-card">
      <div className="radar-header">
        <div className="radar-header-left">
          <span className="radar-status-pill">
            <Radio size={14} className={isScanning ? 'pulse-icon' : ''} />
            <span>LIVE SONAR AUTO-DISCOVERY</span>
          </span>
          <span className="radar-peer-count mono">
            {peers.length} {peers.length === 1 ? 'DEVICE ONLINE' : 'DEVICES ONLINE'}
          </span>
        </div>

        <div className="radar-header-actions">
          {onToggleDemo && (
            <button
              type="button"
              className={`radar-action-chip ${demoEnabled ? 'active' : ''}`}
              onClick={onToggleDemo}
              title="Spawn a virtual loopback peer to test file transfers & chat on this device"
            >
              <Sparkles size={13} />
              <span>{demoEnabled ? 'Demo Peer: ON' : 'Simulate Peer'}</span>
            </button>
          )}
          {demoEnabled && onSimulateIncoming && (
            <button
              type="button"
              className="radar-action-chip accent"
              onClick={onSimulateIncoming}
              title="Simulate receiving a file from the demo peer"
            >
              <Download size={13} />
              <span>Test Receive</span>
            </button>
          )}
          {onRescan && (
            <button
              type="button"
              className="radar-action-chip"
              onClick={onRescan}
              title="Rescan local Wi-Fi, hotspot, and browser tabs"
            >
              <RefreshCw size={13} />
              <span>Rescan</span>
            </button>
          )}
        </div>
      </div>

      <div className="radar-screen">
        {/* Ambient glow backdrop */}
        <div className="radar-ambient-glow" />

        {/* Concentric rings */}
        <div className="radar-ring ring-1" />
        <div className="radar-ring ring-2" />
        <div className="radar-ring ring-3" />
        <div className="radar-ring ring-4" />

        {/* Crosshair grid lines */}
        <div className="radar-crosshair radar-axis-x" />
        <div className="radar-crosshair radar-axis-y" />

        {/* Sweeping Beam */}
        <div className="radar-sweep-beam" />

        {/* Center Node (You) */}
        <div className="radar-center-node" title={`This Device: ${deviceName}`}>
          <div className="center-pulse-halo" />
          <div className="center-pulse-halo delay" />
          <div className="center-avatar-box">
            <Laptop size={22} />
          </div>
          <span className="center-label mono">YOU · {deviceName.split('·')[0].trim()}</span>
          {deviceSubtitle && <span className="center-sublabel">{deviceSubtitle}</span>}
        </div>

        {/* Orbiting Peer Nodes */}
        {peerPositions.map(({ peer, x, y }) => (
          <div
            key={peer.id}
            className="radar-peer-wrapper"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <button
              type="button"
              className={`radar-peer-node ${peer.isSimulated ? 'simulated' : ''} ${hasStagedFiles ? 'ready-to-send' : ''}`}
              onClick={() => onSelectPeer(peer)}
              title={
                hasStagedFiles
                  ? `Tap to send staged files to ${peer.name}`
                  : `Tap to pick and send files to ${peer.name}`
              }
            >
              <div className="peer-node-avatar">
                {platformIcon(peer.platform, 20)}
                <span className="peer-node-online-dot" />
                {hasStagedFiles && (
                  <span className="peer-send-badge" title="Send staged files">
                    <Send size={10} />
                  </span>
                )}
              </div>
              <div className="peer-node-pill">
                <span className="peer-node-name">{peer.name}</span>
                <span className="peer-node-meta mono">
                  {peer.model || peer.os || peer.platform}
                  {peer.rttMs != null ? ` · ${peer.rttMs}ms` : ''}
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
                title={`Send quick message to ${peer.name}`}
              >
                <MessageSquare size={12} />
              </button>
            )}
          </div>
        ))}

        {/* Empty state hint */}
        {peers.length === 0 && (
          <div className="radar-empty-hint">
            <Wifi size={16} className="pulse-icon" />
            <span>
              Scanning Wi-Fi, Hotspot & Local Tabs… Open MogShare on another device or tab, or tap{' '}
              <strong>Simulate Peer</strong> to test!
            </span>
          </div>
        )}
      </div>

      <div className="radar-footer">
        <span className="radar-footer-text">
          {peers.length > 0
            ? hasStagedFiles
              ? '⚡ Files staged! Tap any orbiting device above to start instant P2P transfer.'
              : 'Tap any discovered device in orbit to pick & beam files, or drag files directly onto a device.'
            : 'Auto-detects devices on the same Wi-Fi, mobile hotspot, or browser tabs in real time.'}
        </span>
        {peers.some((p) => p.batteryLevel != null && p.isCharging) && (
          <span className="radar-telemetry-tag mono">
            <BatteryCharging size={13} /> Telemetry Active
          </span>
        )}
      </div>
    </div>
  );
}
