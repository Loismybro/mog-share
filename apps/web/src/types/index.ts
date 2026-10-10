export type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'web';

export type ConnState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'offline' | 'error' | 'disconnected';

export interface Device {
  id: string;
  name: string;
  platform: Platform;
  isLocal: boolean;
  status: 'online' | 'busy' | 'offline';
  connType?: 'direct' | 'relay';
  rttMs?: number;
  availableBitrateBps?: number;
}

/** T9: real transfer lifecycle statuses. */
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
  totalChunks: number;
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
  channel?: 'direct' | 'relay'; // F1: Direct (WebRTC) vs Relayed badge
  error?: string;
  blobUrl?: string;
  savedToDisk?: boolean; // T6: streamed straight to disk, no blob in memory
  createdAt: number;
  bytesTransferred?: number;
}

export interface IncomingRequest {
  id?: string;
  transferId: string;
  fromId: string;
  fromName: string;
  fromPlatform?: Platform;
  meta: FileMeta;
  receivedAt: number;
  sasNumeric?: string;
  sasEmoji?: string;
  isTrusted?: boolean;
}

export interface ClipboardItem {
  id: string;
  content: string;
  fromDevice: string;
  timestamp: number;
}

export interface Settings {
  serverUrl: string; // optional remote WS server
  publicUrl: string; // R6: used for QR / magic links
  showTabs: boolean; // D8: show same-browser tabs (testing)
  soundOn: boolean; // off by default
  autoAcceptFrom: string[]; // F6: trusted device ids
}
