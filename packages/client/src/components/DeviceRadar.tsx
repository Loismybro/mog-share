import React from 'react';
import { 
  Laptop, 
  Smartphone, 
  Monitor, 
  Terminal, 
  Check, 
  Send 
} from 'lucide-react';
import { Device, Platform } from '../types';
import { sound } from '../utils/audio';

interface DeviceRadarProps {
  devices: Device[];
  selectedDeviceId: string | null;
  onSelectDevice: (device: Device) => void;
  myDeviceName: string;
  myPlatform: Platform;
}

export const DeviceRadar: React.FC<DeviceRadarProps> = ({
  devices,
  selectedDeviceId,
  onSelectDevice,
  myDeviceName,
  myPlatform,
}) => {
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

  const getDevicePosition = (index: number, total: number) => {
    if (total === 1) return { top: '24%', left: '50%', transform: 'translate(-50%, -50%)' };
    if (total === 2) {
      const positions = [
        { top: '26%', left: '26%', transform: 'translate(-50%, -50%)' },
        { top: '26%', left: '74%', transform: 'translate(-50%, -50%)' },
      ];
      return positions[index % 2];
    }
    const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
    const radius = 38;
    const x = 50 + radius * Math.cos(angle);
    const y = 50 + radius * Math.sin(angle);
    return {
      top: `${y}%`,
      left: `${x}%`,
      transform: 'translate(-50%, -50%)'
    };
  };

  const getPlatformColor = (platform: Platform) => {
    switch (platform) {
      case 'ios': return 'bg-[#FF90E8]';
      case 'android': return 'bg-[#00F59B]';
      case 'macos': return 'bg-[#90B8F8]';
      case 'windows': return 'bg-[#FFC900]';
      case 'linux': return 'bg-[#D3B5FF]';
      default: return 'bg-[#FFFDF8]';
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto px-4 mb-6">
      <div className="neo-box p-6 relative overflow-hidden flex flex-col items-center justify-center min-h-[380px] bg-[#FFFDF8] retro-grid-bg">
        
        {/* Radar Concentric Rings & Crosshair */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-80 h-80 rounded-full border-2 border-dashed border-black/25 flex items-center justify-center">
            <div className="w-56 h-56 rounded-full border-2 border-black/20 flex items-center justify-center">
              <div className="w-32 h-32 rounded-full border-2 border-black/30" />
            </div>
          </div>
          {/* Crosshair Lines */}
          <div className="absolute w-80 h-[1px] bg-black/15" />
          <div className="absolute h-80 w-[1px] bg-black/15" />

          {/* Rotating Sonar Sweep Beam */}
          <div className="absolute w-80 h-80 rounded-full overflow-hidden animate-sweep opacity-20">
            <div className="w-1/2 h-1/2 bg-gradient-to-br from-[#00F59B] to-transparent origin-bottom-right" />
          </div>
        </div>

        {/* Center Node (Host Device) */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="relative group cursor-default">
            <div className="w-16 h-16 rounded-2xl bg-[#FFC900] border-3 border-black shadow-[4px_4px_0px_#000] flex items-center justify-center">
              {getPlatformIcon(myPlatform, "w-8 h-8 text-black stroke-[2.5]")}
            </div>
            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#00F59B] border-2 border-black" />
          </div>
          <div className="mt-2 text-center">
            <span className="neo-badge bg-black text-white text-[11px] block py-0.5 px-2">
              {myDeviceName} (You)
            </span>
          </div>
        </div>

        {/* Orbiting Discovered Devices */}
        {devices.map((device, index) => {
          const isSelected = selectedDeviceId === device.id;
          const pos = getDevicePosition(index, devices.length);
          const colorClass = getPlatformColor(device.platform);

          return (
            <div
              key={device.id}
              style={pos}
              onClick={() => {
                sound.playPop();
                onSelectDevice(device);
              }}
              className="absolute z-20 flex flex-col items-center cursor-pointer transition-all duration-150 hover:scale-110 active:scale-95"
            >
              <div
                className={`relative w-15 h-15 rounded-2xl border-3 border-black flex items-center justify-center shadow-[4px_4px_0px_#000] transition-all ${
                  isSelected
                    ? 'bg-black text-white shadow-[6px_6px_0px_#FFC900] -translate-y-1'
                    : `${colorClass} text-black hover:shadow-[6px_6px_0px_#000]`
                }`}
              >
                {getPlatformIcon(
                  device.platform,
                  isSelected ? 'w-7 h-7 text-white stroke-[2.5]' : 'w-7 h-7 text-black stroke-[2.5]'
                )}

                {/* Selected Checkmark Badge */}
                {isSelected && (
                  <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[#00F59B] border-2 border-black text-black flex items-center justify-center shadow-[2px_2px_0px_#000]">
                    <Check className="w-4 h-4 stroke-[4]" />
                  </span>
                )}
              </div>

              {/* Device Label */}
              <div className="mt-2 text-center max-w-[120px]">
                <span className="neo-badge bg-white text-black text-[10px] block truncate px-1.5 py-0.5">
                  {device.name}
                </span>
                <span className="text-[9px] font-mono font-black text-black/70 uppercase">
                  {device.isLocal ? '120 MB/s LAN' : 'P2P Ready'}
                </span>
              </div>
            </div>
          );
        })}

        {/* Empty Radar Prompt */}
        {devices.length === 0 && (
          <div className="absolute bottom-4 left-0 right-0 text-center px-6">
            <p className="text-xs font-bold text-slate-700 m-0">
              Scanning local Wi-Fi... Open MOG-SHARE on any other phone or PC to auto-connect!
            </p>
          </div>
        )}
      </div>

      {/* Target Selected Notification */}
      {selectedDeviceId && (
        <div className="mt-3 text-center">
          <span className="neo-badge bg-[#FF90E8] text-black inline-flex items-center gap-1.5 py-1 px-3 shadow-[3px_3px_0px_#000] animate-bounce">
            <Send className="w-3.5 h-3.5 stroke-[3]" />
            Target peer selected! Drop files below to start mogging.
          </span>
        </div>
      )}
    </div>
  );
};
