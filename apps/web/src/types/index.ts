export type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'web';

export type DeviceType = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'web';

export type ConnState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'reconnecting'
  | 'offline'
  | 'error'
  | 'disconnected';

export interface Device {
  id: string;
  name: string;
  platform: Platform;
  model?: string;
  os?: string;
  browser?: string;
  deviceType?: DeviceType | string;
  batteryLevel?: number;
  isCharging?: boolean;
  isLocal?: boolean;
  isSimulated?: boolean;
  status?: 'online' | 'busy' | 'offline';
  connType?: string;
  rttMs?: number;
  availableBitrateBps?: number;
}

export type TransferStatus =
  | 'waiting'
  | 'connecting'
  | 'transferring'
  | 'in_progress'
  | 'pending'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'declined'
  | 'expired'
  | 'cancelled';

export interface FileMeta {
  name: string;
  size: number;
  type: string;
  totalChunks?: number;
  sha256?: string;
  lastModified?: number;
}

export interface TransferFile {
  id: string;
  name: string;
  size: number;
  type: string;
  progress: number; // 0..100
  speedBytesPerSec: number;
  speed?: number;
  etaSeconds: number;
  status: TransferStatus;
  direction: 'sending' | 'receiving';
  peerId: string;
  peerName: string;
  channel?: 'direct' | 'relay';
  error?: string;
  blobUrl?: string;
  fileBlob?: Blob | File;
  savedToDisk?: boolean;
  createdAt: number;
  bytesTransferred?: number;
}

export interface IncomingRequest {
  id?: string;
  transferId: string;
  fromId: string;
  fromName: string;
  fromPlatform?: Platform;
  fromModel?: string;
  meta: FileMeta;
  receivedAt: number;
  sasNumeric?: string;
  sasEmoji?: string;
  isTrusted?: boolean;
  senderPubKey?: string;
}

export interface ClipboardItem {
  id: string;
  content: string;
  fromDevice: string;
  fromId?: string;
  toDevice?: string;
  isOutgoing?: boolean;
  isDirect?: boolean;
  timestamp: number;
}

export interface Settings {
  serverUrl: string;
  publicUrl: string;
  showTabs: boolean;
  soundOn: boolean;
  autoAcceptFrom: string[];
}
