export type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'web';

export type ShareMode = 'local' | 'online';

export type ConnectionState = 'idle' | 'connecting' | 'ready' | 'reconnecting';

export type TransferStatus =
  | 'waiting'
  | 'connecting'
  | 'transferring'
  | 'completed'
  | 'failed'
  | 'declined'
  | 'expired'
  | 'cancelled';

export interface Device {
  id: string;
  name: string;
  platform: Platform;
  isLocal: boolean;
  status: 'online' | 'busy' | 'offline';
  badgeColor?: string;
  isTrusted?: boolean;
}

export interface FileMeta {
  name: string;
  size: number;
  type: string;
  sha256?: string;
  isExecutable?: boolean;
}

export interface TransferFile {
  id: string;
  peerId: string;
  peerName: string;
  name: string;
  size: number;
  type: string;
  progress: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  status: TransferStatus;
  direction: 'sending' | 'receiving';
  relayed?: boolean;
  errorReason?: string;
  sha256?: string;
  blobUrl?: string;
  thumbnailUrl?: string;
  createdAt: number;
  completedAt?: number;
}

export interface ClipboardItem {
  id: string;
  content: string;
  fromDevice: string;
  timestamp: number;
}

export interface DirectMessage {
  id: string;
  fromPeerId: string;
  fromDevice: string;
  text: string;
  timestamp: number;
}

export interface DiagnosticsData {
  connectionState: ConnectionState;
  activeMode: 'server' | 'mesh' | 'offline';
  serverUrl: string | null;
  networkKey: string;
  localIps: string[];
  publicIp: string;
  deviceId: string;
  deviceName: string;
  platform: Platform;
  latencyMs: number | null;
  iceCandidateTypes: string[];
  activePeersCount: number;
  rtcSupported: boolean;
}
