import { sha256Hex } from '../../utils/sha256.js';
import type {
  WorkerSliceBlockResponse,
  WorkerVerifyBlockResponse,
} from './transferCore.worker.js';

type PendingResolver = {
  resolve: (val: any) => void;
  reject: (err: Error) => void;
};

class TransferWorkerPool {
  private workers: Worker[] = [];
  private roundRobin = 0;
  private nextTaskId = 1;
  private pending = new Map<number, PendingResolver>();
  private workerSupported: boolean | null = null;

  private ensureWorkers(): Worker | null {
    if (this.workerSupported === false) return null;
    if (
      typeof window === 'undefined' ||
      typeof Worker === 'undefined' ||
      // Avoid spawning browser module workers inside Vitest/JSDOM unit tests
      (typeof process !== 'undefined' && Boolean((process as any).env?.VITEST))
    ) {
      this.workerSupported = false;
      return null;
    }

    if (this.workers.length === 0) {
      try {
        const poolSize = 2;
        for (let i = 0; i < poolSize; i++) {
          const w = new Worker(new URL('./transferCore.worker.ts', import.meta.url), {
            type: 'module',
          });
          w.onmessage = (ev: MessageEvent<WorkerSliceBlockResponse | WorkerVerifyBlockResponse>) => {
            const data = ev.data;
            if (!data || typeof data.id !== 'number') return;
            const entry = this.pending.get(data.id);
            if (!entry) return;
            this.pending.delete(data.id);
            if (!data.ok) {
              entry.reject(new Error(data.error || 'Worker task error'));
            } else {
              entry.resolve(data);
            }
          };
          w.onerror = () => {
            this.workerSupported = false;
          };
          this.workers.push(w);
        }
        this.workerSupported = true;
      } catch {
        this.workerSupported = false;
        return null;
      }
    }

    if (this.workers.length === 0) return null;
    const worker = this.workers[this.roundRobin % this.workers.length];
    this.roundRobin = (this.roundRobin + 1) % this.workers.length;
    return worker;
  }

  public async sliceAndHashBlock(
    file: Blob,
    startByte: number,
    endByte: number
  ): Promise<{ blockBuffer: ArrayBuffer; blockHash: string }> {
    const worker = this.ensureWorkers();
    if (worker) {
      try {
        const id = this.nextTaskId++;
        const resp = await new Promise<WorkerSliceBlockResponse>((resolve, reject) => {
          this.pending.set(id, { resolve, reject });
          worker.postMessage({
            type: 'slice-block',
            id,
            file,
            startByte,
            endByte,
          });
        });
        if (resp.blockBuffer && resp.blockHash) {
          return { blockBuffer: resp.blockBuffer, blockHash: resp.blockHash };
        }
      } catch {
        // Fallback to direct hardware WebCrypto below
      }
    }

    const slice = file.slice(startByte, endByte);
    const blockBuffer = await slice.arrayBuffer();
    const blockHash = await sha256Hex(blockBuffer);
    return { blockBuffer, blockHash };
  }

  public async assembleAndVerifyBlock(
    sortedChunks: Uint8Array[],
    expectedByteLength: number,
    expectedHash: string
  ): Promise<{ verified: boolean; assembledBlock: Uint8Array | null }> {
    const worker = this.ensureWorkers();
    if (worker && expectedByteLength >= 256 * 1024) {
      try {
        const id = this.nextTaskId++;
        const transferables: ArrayBuffer[] = [];
        for (let i = 0; i < sortedChunks.length; i++) {
          const c = sortedChunks[i];
          const buf =
            c.byteOffset === 0 && c.byteLength === c.buffer.byteLength
              ? (c.buffer as ArrayBuffer)
              : (c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) as ArrayBuffer);
          transferables.push(buf);
        }

        const resp = await new Promise<WorkerVerifyBlockResponse>((resolve, reject) => {
          this.pending.set(id, { resolve, reject });
          worker.postMessage(
            {
              type: 'verify-block',
              id,
              chunks: transferables,
              expectedByteLength,
              expectedHash,
            },
            transferables
          );
        });

        if (resp.verified && resp.assembledBuffer) {
          return {
            verified: true,
            assembledBlock: new Uint8Array(resp.assembledBuffer),
          };
        }
        return { verified: false, assembledBlock: null };
      } catch {
        // Fallback if buffer was detached or worker unavailable
      }
    }

    const assembledBlock = new Uint8Array(expectedByteLength);
    let offset = 0;
    for (let i = 0; i < sortedChunks.length; i++) {
      const chunk = sortedChunks[i];
      assembledBlock.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const hashHex = await sha256Hex(assembledBlock);
    if (hashHex !== expectedHash) {
      return { verified: false, assembledBlock: null };
    }
    return { verified: true, assembledBlock };
  }
}

export const transferWorkerPool = new TransferWorkerPool();
