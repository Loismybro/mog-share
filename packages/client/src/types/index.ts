export type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'web';

export type ShareMode = 'local' | 'online';

export interface Device {
  id: string;
  name: string;
  platform: Platform;
  isLocal: boolean;
  status: 'online' | 'busy' | 'offline';
  badgeColor?: string;
}

export interface TransferFile {
  id: string;
  name: string;
  size: number;
  type: string;
  progress: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  status: 'pending' | 'transferring' | 'completed' | 'cancelled' | 'error';
  direction: 'sending' | 'receiving';
  peerName: string;
  blobUrl?: string;
  createdAt: number;
}

export interface ClipboardItem {
  id: string;
  content: string;
  fromDevice: string;
  timestamp: number;
}
