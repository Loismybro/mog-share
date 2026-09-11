import React from 'react';
import { 
  Laptop, 
  Smartphone, 
  Monitor, 
  Terminal, 
  Check, 
  Send,
  Radar
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
    if (total === 1) return { top: '22%', left: '50%', transform: 'translate(-50%, -50%)' };
    if (total === 2) {
      return [
        { top: '24%', left: '25%', transform: 'translate(-50%, -50%)' },
        { top: '24%', left: '75%', transform: 'translate(-50%, -50%)' },
      ][index % 2];
    }
    if (total === 3) {
      return [
        { top: '20%', left: '28%', transform: 'translate(-50%, -50%)' },
        { top: '20%', left: '72%', transform: 'translate(-50%, -50%)' },
        { top: '78%', left: '50%', transform: 'translate(-50%, -50%)' },
      ][index % 3];
    }
    const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
    const radius = 34;
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
      case 'ios': return 'bg-[#FF90E8] text-black';
      case 'android': return 'bg-[#00F59B] text-black';
      case 'macos': return 'bg-[#60A5FA] text-black';
      case 'windows': return 'bg-[#FFC900] text-black';
      case 'linux': return 'bg-[#D3B5FF] text-black';
      default: return 'bg-[#22293d] text-white';
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto px-4 mb-6 relative z-10 animate-pop">
      <div className="neo-box p-4 sm:p-6 relative overflow-hidden flex flex-col items-center justify-center min-h-[380px] sm:min-h-[420px] bg-[#131722] border-3 border-[#2a324b]">
        
        {/* Radar Concentric Rings & Tactical Grid */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-72 sm:w-84 h-72 sm:h-84 rounded-full border-2 border-dashed border-zinc-700/40 flex items-center justify-center">
            <div className="w-52 sm:w-60 h-52 sm:h-60 rounded-full border border-zinc-700/30 flex items-center justify-center">
              <div className="w-32 sm:w-36 h-32 sm:h-36 rounded-full border border-zinc-700/50" />
            </div>
          </div>
          <div className="absolute w-72 sm:w-84 h-[1px] bg-zinc-700/30" />
          <div className="absolute h-72 sm:h-84 w-[1px] bg-zinc-700/30" />

          {/* Rotating Sonar Beam */}
          <div className="absolute w-72 sm:w-84 h-72 sm:h-84 rounded-full overflow-hidden animate-sweep opacity-25">
            <div className="w-1/2 h-1/2 bg-gradient-to-br from-[#00F59B] to-transparent origin-bottom-right" />
          </div>
        </div>

        {/* Center Node (Host Device) */}
        <div className="relative z-10 flex flex-col items-center pointer-events-none">
          <div className="w-14 sm:w-16 h-14 sm:h-16 rounded-2xl bg-[#FFC900] border-3 border-black shadow-[4px_4px_0px_#000] flex items-center justify-center">
            {getPlatformIcon(myPlatform, "w-7 sm:w-8 h-7 sm:h-8 text-black stroke-[2.5]")}
          </div>
          <div className="mt-2 text-center">
            <span className="neo-badge bg-black border-[#2a324b] text-[#FFC900] text-[10px] sm:text-[11px] block py-0.5 px-2.5 truncate max-w-[150px]">
              {myDeviceName} (You)
            </span>
          </div>
        </div>

        {/* Orbiting Discovered Device Nodes */}
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
                className={`relative w-12 sm:w-14 h-12 sm:h-14 rounded-2xl border-3 border-black flex items-center justify-center shadow-[4px_4px_0px_#000] transition-all ${
                  isSelected
                    ? 'bg-[#00F59B] text-black shadow-[6px_6px_0px_#FFC900] -translate-y-1'
                    : `${colorClass} hover:shadow-[6px_6px_0px_#000]`
                }`}
              >
                {getPlatformIcon(
                  device.platform,
                  'w-6 h-6 text-black stroke-[2.5]'
                )}

                {/* Selected Badge */}
                {isSelected && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#FFC900] border-2 border-black text-black flex items-center justify-center shadow-[1px_1px_0px_#000]">
                    <Check className="w-3.5 h-3.5 stroke-[4]" />
                  </span>
                )}
              </div>

              {/* Compact Device Badge */}
              <div className="mt-1 text-center max-w-[90px] sm:max-w-[110px]">
                <span className="neo-badge bg-[#1a1f2e] border-[#2a324b] text-slate-200 text-[9px] sm:text-[10px] block truncate px-1.5 py-0 shadow-[2px_2px_0px_#000]">
                  {device.name}
                </span>
              </div>
            </div>
          );
        })}

        {/* Empty Radar Prompt */}
        {devices.length === 0 && (
          <div className="absolute bottom-3 left-0 right-0 text-center px-4">
            <span className="neo-badge bg-[#1e2436] border-[#2a324b] text-[#FFC900] text-[11px] py-1 px-2.5">
              Scanning local Wi-Fi for nearby peers...
            </span>
          </div>
        )}
      </div>

      {/* Discovered Peer Deck */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-black uppercase text-slate-300 font-mono flex items-center gap-1.5">
            <Radar className="w-3.5 h-3.5 text-[#00F59B]" />
            Nearby LAN Devices ({devices.length})
          </span>
          <span className="text-[11px] font-bold text-slate-500 font-mono">[CLICK TO SELECT]</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {devices.map((device) => {
            const isSelected = selectedDeviceId === device.id;
            const colorClass = getPlatformColor(device.platform);

            return (
              <button
                key={device.id}
                onClick={() => {
                  sound.playPop();
                  onSelectDevice(device);
                }}
                className={`neo-box p-3 flex items-center gap-2.5 text-left cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-[#1e2436] border-[#00F59B] text-white shadow-[4px_4px_0px_#000] -translate-y-0.5'
                    : 'bg-[#151926] border-[#2a324b] text-slate-300 hover:bg-[#1c2233] hover:text-white hover:border-[#3e4868]'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-xl border-2 border-black flex items-center justify-center shrink-0 ${colorClass}`}
                >
                  {getPlatformIcon(device.platform, "w-5 h-5 text-black stroke-[2.5]")}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold truncate m-0 text-white">{device.name}</p>
                  <p className={`text-[10px] font-mono font-bold m-0 ${isSelected ? 'text-[#00F59B]' : 'text-slate-400'}`}>
                    {device.isLocal ? '120 MB/s LAN' : 'P2P Ready'}
                  </p>
                </div>
                {isSelected && (
                  <Check className="w-4 h-4 text-[#00F59B] stroke-[3] shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Target Selected Notification */}
      {selectedDeviceId && (
        <div className="mt-3 text-center">
          <span className="neo-badge bg-[#00F59B] text-black inline-flex items-center gap-1.5 py-1 px-3 shadow-[3px_3px_0px_#000]">
            <Send className="w-3.5 h-3.5 stroke-[3]" />
            Target peer selected! Drop files below to send.
          </span>
        </div>
      )}
    </div>
  );
};
