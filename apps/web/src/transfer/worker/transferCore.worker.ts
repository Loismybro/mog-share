import { sha256Hex } from '../../utils/sha256.js';

export interface WorkerSliceBlockRequest {
  type: 'slice-block';
  id: number;
  file: Blob;
  startByte: number;
  endByte: number;
}

export interface WorkerSliceBlockResponse {
  type: 'slice-block-result';
  id: number;
  ok: boolean;
  blockBuffer?: ArrayBuffer;
  blockHash?: string;
  error?: string;
}

export interface WorkerVerifyBlockRequest {
  type: 'verify-block';
  id: number;
  chunks: ArrayBuffer[];
  expectedByteLength: number;
  expectedHash: string;
}

export interface WorkerVerifyBlockResponse {
  type: 'verify-block-result';
  id: number;
  ok: boolean;
  verified?: boolean;
  hashHex?: string;
  assembledBuffer?: ArrayBuffer;
  error?: string;
}

type WorkerRequest = WorkerSliceBlockRequest | WorkerVerifyBlockRequest;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'slice-block') {
    try {
      const slice = msg.file.slice(msg.startByte, msg.endByte);
      const blockBuffer = await slice.arrayBuffer();
      const blockHash = await sha256Hex(blockBuffer);
      const res: WorkerSliceBlockResponse = {
        type: 'slice-block-result',
        id: msg.id,
        ok: true,
        blockBuffer,
        blockHash,
      };
      ctx.postMessage(res, [blockBuffer]);
    } catch (err: unknown) {
      const res: WorkerSliceBlockResponse = {
        type: 'slice-block-result',
        id: msg.id,
        ok: false,
        error: (err as Error)?.message || 'Worker slice-block failed',
      };
      ctx.postMessage(res);
    }
    return;
  }

  if (msg.type === 'verify-block') {
    try {
      const assembled = new Uint8Array(msg.expectedByteLength);
      let offset = 0;
      for (let i = 0; i < msg.chunks.length; i++) {
        const chunkView = new Uint8Array(msg.chunks[i]);
        assembled.set(chunkView, offset);
        offset += chunkView.byteLength;
      }

      const hashHex = await sha256Hex(assembled);
      const verified = hashHex === msg.expectedHash;

      const res: WorkerVerifyBlockResponse = {
        type: 'verify-block-result',
        id: msg.id,
        ok: true,
        verified,
        hashHex,
        assembledBuffer: verified ? assembled.buffer : undefined,
      };
      if (verified) {
        ctx.postMessage(res, [assembled.buffer]);
      } else {
        ctx.postMessage(res);
      }
    } catch (err: unknown) {
      const res: WorkerVerifyBlockResponse = {
        type: 'verify-block-result',
        id: msg.id,
        ok: false,
        error: (err as Error)?.message || 'Worker verify-block failed',
      };
      ctx.postMessage(res);
    }
  }
};
