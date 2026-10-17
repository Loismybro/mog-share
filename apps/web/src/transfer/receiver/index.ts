import {
  DEFAULT_BLOCK_SIZE,
  MAX_BLOCK_RETRIES,
} from '@shareapp/shared';
import {
  BinaryFrameType,
  decodeBinaryFrame,
  transferIdToNum,
  type BlockEndPayload,
  type BlockAckPayload,
  type CreditGrantPayload,
} from '../protocol/index.js';
import type { BlockWriter } from '../storage/index.js';
import { sha256Hex } from '../../utils/sha256.js';

export interface FileReceiverCallbacks {
  sendCtlMessage: (message: unknown) => void;
  onProgress: (verifiedBytes: number, totalBytes: number) => void;
  onBlockVerified: (blockIndex: number) => void;
  onFileComplete: (output: Blob | File | null) => void;
  onError: (error: Error) => void;
}

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

  private clearStallTimer(blockIndex: number) {
    const t = this.blockStallTimers.get(blockIndex);
    if (t) {
      clearTimeout(t);
      this.blockStallTimers.delete(blockIndex);
    }
  }

  public getVerifiedBlocks(): Set<number> {
    return new Set(this.verifiedBlocks);
  }

  public isVerified(blockIndex: number): boolean {
    return this.verifiedBlocks.has(blockIndex);
  }

  public handleDataFrame(rawFrame: Uint8Array) {
    try {
      const { header, payload } = decodeBinaryFrame(rawFrame);
      if (header.transferIdNum !== this.transferIdNum) return;
      if (header.type === BinaryFrameType.DATA) {
        if (this.verifiedBlocks.has(header.blockIndex)) return;

        let chunksMap = this.blockChunks.get(header.blockIndex);
        if (!chunksMap) {
          chunksMap = new Map();
          this.blockChunks.set(header.blockIndex, chunksMap);
        }
        const prevChunk = chunksMap.get(header.chunkIndex);
        chunksMap.set(header.chunkIndex, payload);

        const prevBlockBytes = this.blockReceivedBytes.get(header.blockIndex) || 0;
        const delta = payload.byteLength - (prevChunk ? prevChunk.byteLength : 0);
        const nextBlockBytes = prevBlockBytes + delta;
        this.blockReceivedBytes.set(header.blockIndex, nextBlockBytes);

        if (header.chunkIndex % 6 === 0) {
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
      // Re-acknowledge if sender missed previous ACK
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

    // If chunks are still missing 1.8s after block-end, request block retry so receiver never stalls at 99%
    if (typeof window !== 'undefined' && !this.verifiedBlocks.has(payload.blockIndex)) {
      this.clearStallTimer(payload.blockIndex);
      const timer = setTimeout(() => {
        if (!this.verifiedBlocks.has(payload.blockIndex) && !this.finalized) {
          this.blockChunks.delete(payload.blockIndex);
          this.blockReceivedBytes.delete(payload.blockIndex);
          this.blockEndPayloads.delete(payload.blockIndex);
          this.callbacks.sendCtlMessage({
            type: 'block-retry',
            payload: { transferId: this.transferId, blockIndex: payload.blockIndex },
          });
        }
      }, 1800);
      this.blockStallTimers.set(payload.blockIndex, timer);
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
      // Corrupted or mismatched chunk sizing — request clean block retry
      this.blockChunks.delete(blockIndex);
      this.blockReceivedBytes.delete(blockIndex);
      this.blockEndPayloads.delete(blockIndex);
      this.callbacks.sendCtlMessage({
        type: 'block-retry',
        payload: { transferId: this.transferId, blockIndex },
      });
      return;
    }

    const assembledBlock = new Uint8Array(endMeta.byteLength);
    let offset = 0;
    for (const idx of sortedIndices) {
      const chunk = chunksMap.get(idx)!;
      assembledBlock.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const hashHex = await sha256Hex(assembledBlock);

    if (hashHex !== endMeta.blockHash) {
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
