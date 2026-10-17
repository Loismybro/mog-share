export type Platform =
  | 'ios'
  | 'android'
  | 'macos'
  | 'windows'
  | 'linux'
  | 'web'
  | 'iOS'
  | 'Android'
  | 'macOS'
  | 'Windows'
  | 'Linux';

export type DeviceType = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'web' | 'mobile';

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
  discoveryMethod?: string;
  rttMs?: number;
  availableBitrateBps?: number;
}

export type TransferStatus =
  | 'queued'
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
  transferId?: string;
  fileIndex?: number;
}

export interface TransferFile {
  id: string;
  name: string;
  size: number;
  type: string;
  progress: number; // 0..100
  speedBytesPerSec: number;
  speed?: number | string;
  etaSeconds: number;
  status: TransferStatus;
  direction: 'sending' | 'receiving' | 'send' | 'receive';
  peerId: string;
  peerName: string;
  channel?: 'direct' | 'relay';
  error?: string;
  blobUrl?: string;
  fileBlob?: Blob | File;
  blob?: Blob | File;
  savedToDisk?: boolean;
  createdAt: number;
  bytesTransferred?: number;
  sessionId?: string;
  batchIndex?: number;
  batchTotal?: number;
}

export interface IncomingRequest {
  id?: string;
  transferId: string;
  sessionId?: string;
  fromId: string;
  fromName: string;
  fromPlatform?: Platform;
  fromModel?: string;
  from?: { name: string; platform: Platform };
  meta: FileMeta;
  files?: FileMeta[];
  totalSize?: number;
  receivedAt: number;
  sasNumeric?: string;
  sasEmoji?: string;
  isTrusted?: boolean;
  senderPubKey?: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isSelf: boolean;
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
