import { PROTOCOL_VERSION } from '../constants/index.js';

// ---------------------------------------------------------------------------
// Binary Framing Layout (Section 4.2)
// Fixed header (17 bytes) big-endian:
// 1 byte  frame type (DATA=1, BLOCK_END=2, EOF=3)
// 4 bytes transferId (uint32 numeric hash or ID)
// 4 bytes fileIndex (uint32)
// 4 bytes blockIndex (uint32)
// 4 bytes chunkIndex (uint32 within block)
// payload...
// ---------------------------------------------------------------------------

export const BinaryFrameType = {
  DATA: 1,
  BLOCK_END: 2,
  EOF: 3,
} as const;

export type BinaryFrameType = (typeof BinaryFrameType)[keyof typeof BinaryFrameType];

export const BINARY_HEADER_SIZE = 17;

export interface BinaryFrameHeader {
  type: BinaryFrameType;
  transferIdNum: number;
  fileIndex: number;
  blockIndex: number;
  chunkIndex: number;
}

export function encodeBinaryFrame(header: BinaryFrameHeader, payload: Uint8Array): Uint8Array {
  const buffer = new Uint8Array(BINARY_HEADER_SIZE + payload.byteLength);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  view.setUint8(0, header.type);
  view.setUint32(1, header.transferIdNum, false); // big-endian
  view.setUint32(5, header.fileIndex, false);
  view.setUint32(9, header.blockIndex, false);
  view.setUint32(13, header.chunkIndex, false);

  buffer.set(payload, BINARY_HEADER_SIZE);
  return buffer;
}

export function decodeBinaryFrame(data: ArrayBuffer | Uint8Array): {
  header: BinaryFrameHeader;
  payload: Uint8Array;
} {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < BINARY_HEADER_SIZE) {
    throw new Error(`Binary frame too small: ${bytes.byteLength} < ${BINARY_HEADER_SIZE}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const typeVal = view.getUint8(0);
  if (typeVal !== BinaryFrameType.DATA && typeVal !== BinaryFrameType.BLOCK_END && typeVal !== BinaryFrameType.EOF) {
    throw new Error(`Invalid binary frame type: ${typeVal}`);
  }

  const header: BinaryFrameHeader = {
    type: typeVal,
    transferIdNum: view.getUint32(1, false),
    fileIndex: view.getUint32(5, false),
    blockIndex: view.getUint32(9, false),
    chunkIndex: view.getUint32(13, false),
  };

  const payload = bytes.slice(BINARY_HEADER_SIZE);
  return { header, payload };
}

// ---------------------------------------------------------------------------
// Signaling Envelope (Section 3.5)
// Envelope: { v, type, id, from, to, seq, payload }
// ---------------------------------------------------------------------------

export interface SignalingEnvelope<T = Record<string, unknown>> {
  v: number; // protocol version
  type: string; // message type
  id: string; // unique message id
  from?: string; // sender deviceId
  to?: string; // target deviceId or '*'
  seq?: number; // monotonic sequence counter
  payload: T;
}

export function createEnvelope<T = Record<string, unknown>>(
  type: string,
  payload: T,
  options?: { id?: string; from?: string; to?: string; seq?: number }
): SignalingEnvelope<T> {
  return {
    v: PROTOCOL_VERSION,
    type,
    id: options?.id || Math.random().toString(36).slice(2, 11),
    from: options?.from,
    to: options?.to,
    seq: options?.seq,
    payload,
  };
}

export function validateEnvelope(data: unknown): SignalingEnvelope {
  if (!data || typeof data !== 'object') {
    throw new Error('Message is not a JSON object');
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.v !== 'number') {
    throw new Error('Missing or invalid protocol version "v"');
  }
  if (Math.floor(obj.v) !== PROTOCOL_VERSION) {
    throw new Error(`Protocol version mismatch: expected ${PROTOCOL_VERSION}, received ${obj.v}`);
  }
  if (typeof obj.type !== 'string' || !obj.type) {
    throw new Error('Missing message "type"');
  }
  if (typeof obj.id !== 'string' || !obj.id) {
    throw new Error('Missing message "id"');
  }
  if (!obj.payload || typeof obj.payload !== 'object') {
    throw new Error('Missing or invalid "payload"');
  }

  return obj as unknown as SignalingEnvelope;
}

// ---------------------------------------------------------------------------
// Control Protocol on ctl Channel (Section 4.1, 4.4, 4.7, 4.8)
// ---------------------------------------------------------------------------

export interface HelloPayload {
  protocolVersion: number;
  appVersion: string;
  engine: 'chromium' | 'gecko' | 'webkit' | 'unknown';
  platform: 'android' | 'ios' | 'macos' | 'windows' | 'linux' | 'unknown';
  ecdhPublicKey: string; // Anti-MITM key exchange
  capabilities: {
    maxMessageSize: number;
    fsa: boolean;
    opfs: boolean;
    swStream: boolean;
    wakeLock: boolean;
    hashAlgos: string[];
    maxParallelChannels: number;
  };
}

export interface ManifestFileEntry {
  path: string;
  size: number;
  lastModified: number;
  sha256?: string; // root hash-of-hashes for the file
}

export interface ManifestPayload {
  transferId: string;
  files: ManifestFileEntry[];
  totalBytes: number;
  blockSize: number;
  chunkSize: number;
}

export interface BlockEndPayload {
  transferId: string;
  fileIndex: number;
  blockIndex: number;
  blockHash: string; // SHA-256 of the 4 MiB block
  byteLength: number;
}

export interface BlockAckPayload {
  transferId: string;
  fileIndex: number;
  blockIndex: number;
  verified: boolean;
}

export interface CreditGrantPayload {
  transferId: string;
  credits: number; // additional blocks permitted to send
}

export interface ResumeRequestPayload {
  transferId: string;
  fileIndex: number;
  bitmap: string; // base64 representation of verified block bitset
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

