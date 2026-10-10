import React, { useState, useEffect } from 'react';
import { 
  Laptop, 
  Smartphone, 
  Monitor, 
  Terminal, 
  Check, 
  Upload, 
  MessageSquare, 
  ShieldCheck, 
  ShieldAlert, 
  HelpCircle, 
  ArrowRight,
  Wifi,
  Sparkles
} from 'lucide-react';
import { Device, Platform } from '../types';
import { sound } from '../utils/audio';

interface DeviceRadarProps {
  devices: Device[];
  selectedDeviceId: string | null;
  onSelectDevice: (device: Device) => void;
  onSendFilesToDevice: (device: Device, files: File[]) => void;
  onOpenMessageModal: (device: Device) => void;
  onToggleTrustDevice: (deviceId: string) => void;
  onGoToRoom: () => void;
  myDeviceName: string;
  myPlatform: Platform;
  onRenameMyDevice: () => void;
}

export const DeviceRadar: React.FC<DeviceRadarProps> = ({
  devices,
  selectedDeviceId,
  onSelectDevice,
  onSendFilesToDevice,
  onOpenMessageModal,
  onToggleTrustDevice,
  onGoToRoom,
  myDeviceName,
  myPlatform: _myPlatform,
  onRenameMyDevice,
}) => {
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [draggedOverDeviceId, setDraggedOverDeviceId] = useState<string | null>(null);

  // D7: Show troubleshooting checklist after 6 seconds of empty devices
  useEffect(() => {
    if (devices.length > 0) {
      setShowTroubleshooting(false);
      return;
    }
    const timer = setTimeout(() => {
      setShowTroubleshooting(true);
    }, 6000);

    return () => clearTimeout(timer);
  }, [devices.length]);

  const getPlatformIcon = (platform: Platform, className = "w-5 h-5") => {
    switch (platform) {
      case 'ios':
      case 'android':
        return <Smartphone className={className} />;
      case 'macos':
        return <Laptop className={className} />;
      case 'windows':
        return <Monitor className={className} />;
      case 'linux':
        return <Terminal className={className} />;
      default:
        return <Laptop className={className} />;
    }
  };

  const handleCardDragOver = (e: React.DragEvent, deviceId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggedOverDeviceId(deviceId);
  };

  const handleCardDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggedOverDeviceId(null);
  };

  const handleCardDrop = (e: React.DragEvent, device: Device) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggedOverDeviceId(null);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      sound.playPop();
      onSendFilesToDevice(device, Array.from(e.dataTransfer.files));
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 mb-6">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--text-main)]">
            Nearby Devices
          </span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--bg-card-subtle)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
            {devices.length} online
          </span>
        </div>

        {/* You appear as pill (Phase 5) */}
        <button
          type="button"
          onClick={() => {
            sound.playPop();
            onRenameMyDevice();
          }}
          title="Click to rename your device"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] flex items-center gap-1.5 transition-colors cursor-pointer py-1 px-2 rounded-md hover:bg-[var(--bg-card-subtle)]"
        >
          <span>You appear as</span>
          <span className="font-semibold text-[var(--accent-primary)] flex items-center gap-1">
            {myDeviceName}
            <Sparkles className="w-3 h-3 inline" />
          </span>
        </button>
      </div>

      {/* When devices are present: AirDrop-style device cards */}
      {devices.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {devices.map((device) => {
            const isSelected = selectedDeviceId === device.id;
            const isHoverDrop = draggedOverDeviceId === device.id;

            return (
              <div
                key={device.id}
                onDragOver={(e) => handleCardDragOver(e, device.id)}
                onDragLeave={handleCardDragLeave}
                onDrop={(e) => handleCardDrop(e, device)}
                onClick={() => {
                  sound.playPop();
                  onSelectDevice(device);
                }}
                className={`mog-card p-4 flex flex-col justify-between transition-all cursor-pointer relative overflow-hidden group ${
                  isHoverDrop
                    ? 'border-[var(--accent-primary)] bg-[var(--bg-elevated)] scale-[1.02]'
                    : isSelected
                    ? 'border-[var(--accent-primary)] bg-[var(--bg-card-subtle)]'
                    : 'hover:border-[var(--border-active)]'
                }`}
              >
                {/* Top row: Icon + Platform & Trust badge */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-main)] group-hover:text-[var(--accent-primary)] transition-colors">
                    {getPlatformIcon(device.platform, "w-5 h-5 stroke-[2]")}
                  </div>

                  <div className="flex items-center gap-1">
                    {device.isTrusted ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleTrustDevice(device.id);
                        }}
                        title="Trusted device: Auto-accepts files. Click to un-trust."
                        className="text-emerald-400 p-1 rounded hover:bg-emerald-950/40"
                      >
                        <ShieldCheck className="w-4 h-4 stroke-[2.5]" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleTrustDevice(device.id);
                        }}
                        title="Click to trust this device for auto-accepting transfers"
                        className="text-[var(--text-dim)] hover:text-[var(--text-muted)] p-1 rounded hover:bg-[var(--bg-card-subtle)]"
                      >
                        <ShieldAlert className="w-4 h-4" />
                      </button>
                    )}

                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-[var(--accent-primary)] text-[var(--accent-primary-text)] flex items-center justify-center">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Device Name & Details */}
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-[var(--text-main)] truncate m-0">
                    {device.name}
                  </h3>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {device.isLocal ? 'Local Network' : 'Direct Peer'}
                    </span>
                  </div>
                </div>

                {/* Actions row: Send File & Message (F2) */}
                <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
                  <label
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 mog-btn mog-btn-secondary !min-h-[36px] !py-1 !px-2.5 !text-xs font-semibold gap-1.5 cursor-pointer text-center"
                  >
                    <Upload className="w-3.5 h-3.5 stroke-[2]" />
                    <span>Send File</span>
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          onSendFilesToDevice(device, Array.from(e.target.files));
                        }
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      sound.playPop();
                      onOpenMessageModal(device);
                    }}
                    title="Send a quick text message or link (F2)"
                    className="mog-btn mog-btn-secondary !min-h-[36px] !min-w-[36px] !p-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)]"
                  >
                    <MessageSquare className="w-4 h-4 stroke-[2]" />
                  </button>
                </div>

                {/* Drop indicator overlay */}
                {isHoverDrop && (
                  <div className="absolute inset-0 bg-[var(--bg-elevated)]/90 backdrop-blur-sm flex flex-col items-center justify-center p-3 text-center border-2 border-[var(--accent-primary)] rounded-[var(--radius-lg)]">
                    <Upload className="w-8 h-8 text-[var(--accent-primary)] animate-bounce mb-1" />
                    <span className="text-xs font-bold text-[var(--text-main)]">
                      Drop files to send directly to {device.name}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty / Searching State (Phase 5: subtle ~120px pulse animation) */
        <div className="mog-card p-6 sm:p-8 flex flex-col items-center text-center">
          {/* Subtle ~120px pulse circle */}
          <div className="relative w-28 h-28 flex items-center justify-center mb-5">
            <div className="absolute inset-0 rounded-full bg-[var(--accent-primary)]/10 animate-pulse-ring" />
            <div className="w-20 h-20 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--accent-primary)] relative z-10 shadow-lg">
              <Wifi className="w-8 h-8 stroke-[2]" />
            </div>
          </div>

          <h3 className="text-base font-semibold text-[var(--text-main)] mb-1">
            Looking for nearby devices...
          </h3>
          <p className="text-xs text-[var(--text-muted)] max-w-sm mb-4">
            Open MOG-SHARE on another device connected to this network to start sharing files instantly.
          </p>

          {/* D7: Troubleshooting Checklist fallback */}
          {showTroubleshooting && (
            <div className="w-full max-w-md bg-[var(--bg-card-subtle)] border border-[var(--border-subtle)] rounded-xl p-4 text-left animate-pop">
              <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-[var(--text-main)]">
                <HelpCircle className="w-4 h-4 text-[var(--accent-primary)]" />
                <span>Can&apos;t see a device? Check these:</span>
              </div>
              <ul className="text-xs text-[var(--text-muted)] space-y-1.5 pl-5 list-disc mb-4">
                <li>Are both devices connected to the <strong>same Wi-Fi network</strong>?</li>
                <li>Make sure any <strong>VPN is turned off</strong> on both devices.</li>
                <li>Some Guest Wi-Fi networks have <strong>AP Isolation</strong> enabled.</li>
              </ul>
              <button
                type="button"
                onClick={() => {
                  sound.playPop();
                  onGoToRoom();
                }}
                className="w-full mog-btn mog-btn-primary !min-h-[38px] !text-xs font-semibold justify-between"
              >
                <span>Connect across different networks with a 6-digit code</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
