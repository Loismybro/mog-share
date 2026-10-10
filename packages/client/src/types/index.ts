export type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'web';

export type ConnState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'offline';

export interface Device {
  id: string;
  name: string;
  platform: Platform;
  isLocal: boolean;
  status: 'online' | 'busy' | 'offline';
}

/** T9: real transfer lifecycle statuses. */
export type TransferStatus =
  | 'waiting'
  | 'connecting'
  | 'transferring'
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
}

export interface TransferFile {
  id: string;
  name: string;
  size: number;
  type: string;
  progress: number; // 0..100
  speedBytesPerSec: number;
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
}

export interface IncomingRequest {
  transferId: string;
  fromId: string;
  fromName: string;
  meta: FileMeta;
  receivedAt: number;
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
