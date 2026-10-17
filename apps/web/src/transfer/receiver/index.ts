import {
  DEFAULT_BLOCK_SIZE,
  MAX_BLOCK_RETRIES,
} from '@shareapp/shared';
import {
  BinaryFrameType,
  decodeBinaryFrame,
  transferIdToNum,
  type BinaryFrameHeader,
  type BlockEndPayload,
  type BlockAckPayload,
  type CreditGrantPayload,
} from '../protocol/index.js';
import type { BlockWriter } from '../storage/index.js';
import { transferWorkerPool } from '../worker/workerPool.js';

export interface FileReceiverCallbacks {
  sendCtlMessage: (message: unknown) => void;
  onProgress: (verifiedBytes: number, totalBytes: number) => void;
  onBlockVerified: (blockIndex: number) => void;
  onFileComplete: (output: Blob | File | null) => void;
  onError: (error: Error) => void;
}

const textDecoder = new TextDecoder();

export class FileReceiverPipeline {
  private transferId: string;
  private totalBytes: number;
  private blockSize: number;
  private totalBlocks: number;
  private writer: BlockWriter;
  private callbacks: FileReceiverCallbacks;

  private blockChunks = new Map<number, Map<number, Uint8Array>>();
  private blockReceivedBytes = new Map<number, number>();
  private blockEndPayloads = new Map<number, BlockEndPayload>();
  private blockStallTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private verifiedBlocks = new Set<number>();
  private blockRetryCounts = new Map<number, number>();
  private verifiedBytes = 0;
  private transferIdNum = 0;
  private verifying = new Set<number>();
  private finalized = false;
  private lastProgressEmitTime = 0;

  constructor(
    transferId: string,
    totalBytes: number,
    writer: BlockWriter,
    callbacks: FileReceiverCallbacks,
    blockSize = DEFAULT_BLOCK_SIZE,
    initialVerifiedBlocks?: number[]
  ) {
    this.transferId = transferId;
    this.transferIdNum = transferIdToNum(transferId);
    this.totalBytes = totalBytes;
    this.writer = writer;
    this.callbacks = callbacks;
    this.blockSize = blockSize;
    this.totalBlocks = Math.max(1, Math.ceil(totalBytes / blockSize));

    if (initialVerifiedBlocks) {
      for (const b of initialVerifiedBlocks) {
        this.verifiedBlocks.add(b);
        const bStart = b * this.blockSize;
        const bEnd = Math.min(this.totalBytes, (b + 1) * this.blockSize);
        this.verifiedBytes += bEnd - bStart;
      }
    }
  }

  public getTransferIdNum(): number {
    return this.transferIdNum;
  }

  private clearStallTimer(blockIndex: number) {
    const t = this.blockStallTimers.get(blockIndex);
    if (t) {
      clearTimeout(t);
      this.blockStallTimers.delete(blockIndex);
    }
  }

  private resetStallTimer(blockIndex: number) {
    this.clearStallTimer(blockIndex);
    if (typeof window === 'undefined' || this.verifiedBlocks.has(blockIndex) || this.finalized) {
      return;
    }
    const timer = setTimeout(() => {
      if (!this.verifiedBlocks.has(blockIndex) && !this.finalized) {
        this.callbacks.sendCtlMessage({
          type: 'block-retry',
          payload: { transferId: this.transferId, blockIndex },
        });
      }
    }, 5500);
    this.blockStallTimers.set(blockIndex, timer);
  }

  public getVerifiedBlocks(): Set<number> {
    return new Set(this.verifiedBlocks);
  }

  public isVerified(blockIndex: number): boolean {
    return this.verifiedBlocks.has(blockIndex);
  }

  public handleDataFrame(rawFrame: Uint8Array) {
    let decoded: ReturnType<typeof decodeBinaryFrame>;
    try {
      decoded = decodeBinaryFrame(rawFrame);
    } catch {
      return;
    }
    this.handleDecodedDataFrame(decoded.header, decoded.payload);
  }

  public handleDecodedDataFrame(header: BinaryFrameHeader, payload: Uint8Array) {
    try {
      if (header.transferIdNum !== this.transferIdNum) return;

      if (header.type === BinaryFrameType.BLOCK_END) {
        try {
          const endPayload = JSON.parse(textDecoder.decode(payload)) as BlockEndPayload;
          if (endPayload && typeof endPayload.blockIndex === 'number') {
            this.handleBlockEnd(endPayload);
          }
        } catch {}
        return;
      }

      if (header.type === BinaryFrameType.DATA) {
        if (this.verifiedBlocks.has(header.blockIndex)) return;

        let chunksMap = this.blockChunks.get(header.blockIndex);
        if (!chunksMap) {
          chunksMap = new Map();
          this.blockChunks.set(header.blockIndex, chunksMap);
        }

        // Copy payload slice so underlying buffer reuse never mutates stored chunk
        const chunkCopy = new Uint8Array(payload.byteLength);
        chunkCopy.set(payload);

        const prevChunk = chunksMap.get(header.chunkIndex);
        chunksMap.set(header.chunkIndex, chunkCopy);

        const prevBlockBytes = this.blockReceivedBytes.get(header.blockIndex) || 0;
        const delta = chunkCopy.byteLength - (prevChunk ? prevChunk.byteLength : 0);
        const nextBlockBytes = prevBlockBytes + delta;
        this.blockReceivedBytes.set(header.blockIndex, nextBlockBytes);

        if (this.blockEndPayloads.has(header.blockIndex)) {
          this.resetStallTimer(header.blockIndex);
        }

        const now = Date.now();
        if (now - this.lastProgressEmitTime >= 100) {
          this.lastProgressEmitTime = now;
          let inFlightBytes = 0;
          for (const [bIdx, bBytes] of this.blockReceivedBytes.entries()) {
            if (!this.verifiedBlocks.has(bIdx)) inFlightBytes += bBytes;
          }
          this.callbacks.onProgress(
            Math.min(this.totalBytes, this.verifiedBytes + inFlightBytes),
            this.totalBytes
          );
        }

        if (this.blockEndPayloads.has(header.blockIndex)) {
          void this.tryVerifyBlock(header.blockIndex);
        }
      }
    } catch (err: unknown) {
      this.callbacks.onError(err as Error);
    }
  }

  public handleBlockEnd(payload: BlockEndPayload) {
    if (this.verifiedBlocks.has(payload.blockIndex)) {
      this.callbacks.sendCtlMessage({
        type: 'block-ack',
        payload: {
          transferId: this.transferId,
          fileIndex: payload.fileIndex,
          blockIndex: payload.blockIndex,
          verified: true,
        },
      });
      return;
    }

    this.blockEndPayloads.set(payload.blockIndex, payload);
    void this.tryVerifyBlock(payload.blockIndex);

    if (!this.verifiedBlocks.has(payload.blockIndex)) {
      this.resetStallTimer(payload.blockIndex);
    }
  }

  private async tryVerifyBlock(blockIndex: number) {
    if (this.verifying.has(blockIndex) || this.verifiedBlocks.has(blockIndex) || this.finalized) return;
    this.verifying.add(blockIndex);
    try {
      await this.tryVerifyBlockInner(blockIndex);
    } catch (err: unknown) {
      this.callbacks.onError(err as Error);
    } finally {
      this.verifying.delete(blockIndex);
      if (
        !this.verifiedBlocks.has(blockIndex) &&
        !this.finalized &&
        this.blockEndPayloads.has(blockIndex) &&
        this.blockChunks.has(blockIndex)
      ) {
        const endMeta = this.blockEndPayloads.get(blockIndex)!;
        const recBytes = this.blockReceivedBytes.get(blockIndex) || 0;
        if (recBytes >= endMeta.byteLength) {
          void this.tryVerifyBlock(blockIndex);
        }
      }
    }
  }

  private async tryVerifyBlockInner(blockIndex: number) {
    const endMeta = this.blockEndPayloads.get(blockIndex);
    const chunksMap = this.blockChunks.get(blockIndex);
    if (!endMeta || !chunksMap) return;

    let totalReceived = 0;
    const sortedIndices = Array.from(chunksMap.keys()).sort((a, b) => a - b);

    // Ensure contiguous chunk sequence 0 .. N-1 with no gaps
    for (let i = 0; i < sortedIndices.length; i++) {
      if (sortedIndices[i] !== i) {
        return;
      }
      totalReceived += chunksMap.get(i)!.byteLength;
    }

    if (totalReceived < endMeta.byteLength) {
      return;
    }

    this.clearStallTimer(blockIndex);

    if (totalReceived !== endMeta.byteLength) {
      this.blockChunks.delete(blockIndex);
      this.blockReceivedBytes.delete(blockIndex);
      this.blockEndPayloads.delete(blockIndex);
      this.callbacks.sendCtlMessage({
        type: 'block-retry',
        payload: { transferId: this.transferId, blockIndex },
      });
      return;
    }

    const sortedChunks: Uint8Array[] = [];
    for (const idx of sortedIndices) {
      sortedChunks.push(chunksMap.get(idx)!);
    }

    const { verified, assembledBlock } = await transferWorkerPool.assembleAndVerifyBlock(
      sortedChunks,
      endMeta.byteLength,
      endMeta.blockHash
    );

    if (!verified || !assembledBlock) {
      const retries = (this.blockRetryCounts.get(blockIndex) || 0) + 1;
      this.blockRetryCounts.set(blockIndex, retries);

      if (retries > MAX_BLOCK_RETRIES) {
        this.callbacks.onError(
          new Error(`Integrity mismatch on block ${blockIndex} after ${MAX_BLOCK_RETRIES} retries`)
        );
        return;
      }

      this.blockChunks.delete(blockIndex);
      this.blockReceivedBytes.delete(blockIndex);
      this.blockEndPayloads.delete(blockIndex);
      this.callbacks.sendCtlMessage({
        type: 'block-retry',
        payload: { transferId: this.transferId, blockIndex },
      });
      return;
    }

    await this.writer.writeBlock(blockIndex, this.blockSize, assembledBlock);

    this.blockChunks.delete(blockIndex);
    this.blockReceivedBytes.delete(blockIndex);
    this.blockEndPayloads.delete(blockIndex);

    this.verifiedBlocks.add(blockIndex);
    this.verifiedBytes += endMeta.byteLength;

    const ack: BlockAckPayload = {
      transferId: this.transferId,
      fileIndex: endMeta.fileIndex,
      blockIndex,
      verified: true,
    };
    this.callbacks.sendCtlMessage({
      type: 'block-ack',
      payload: ack,
    });

    const creditGrant: CreditGrantPayload = {
      transferId: this.transferId,
      credits: 1,
    };
    this.callbacks.sendCtlMessage({
      type: 'credit-grant',
      payload: creditGrant,
    });

    this.lastProgressEmitTime = Date.now();
    this.callbacks.onProgress(this.verifiedBytes, this.totalBytes);
    this.callbacks.onBlockVerified(blockIndex);

    if (this.verifiedBlocks.size >= this.totalBlocks && !this.finalized) {
      this.finalized = true;
      for (const t of this.blockStallTimers.values()) clearTimeout(t);
      this.blockStallTimers.clear();
      const output = await this.writer.finalize();
      this.callbacks.onFileComplete(output);
    }
  }
}
