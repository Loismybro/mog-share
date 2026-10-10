import {
  DEFAULT_BLOCK_SIZE,
  MAX_BLOCK_RETRIES,
  DEFAULT_CREDIT_WINDOW_BLOCKS,
} from '@shareapp/shared';
import {
  BinaryFrameType,
  decodeBinaryFrame,
  type BlockEndPayload,
  type BlockAckPayload,
  type CreditGrantPayload,
} from '../protocol/index.js';
import type { BlockWriter } from '../storage/index.js';

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

  // Active in-flight chunks for current blocks: blockIndex -> Map<chunkIndex, Uint8Array>
  private blockChunks = new Map<number, Map<number, Uint8Array>>();
  private blockEndPayloads = new Map<number, BlockEndPayload>();
  private verifiedBlocks = new Set<number>();
  private blockRetryCounts = new Map<number, number>();
  private verifiedBytes = 0;

  constructor(
    transferId: string,
    totalBytes: number,
    writer: BlockWriter,
    callbacks: FileReceiverCallbacks,
    blockSize = DEFAULT_BLOCK_SIZE
  ) {
    this.transferId = transferId;
    this.totalBytes = totalBytes;
    this.writer = writer;
    this.callbacks = callbacks;
    this.blockSize = blockSize;
    this.totalBlocks = Math.max(1, Math.ceil(totalBytes / blockSize));
  }

  public handleDataFrame(rawFrame: Uint8Array) {
    try {
      const { header, payload } = decodeBinaryFrame(rawFrame);
      if (header.type === BinaryFrameType.DATA) {
        let chunksMap = this.blockChunks.get(header.blockIndex);
        if (!chunksMap) {
          chunksMap = new Map();
          this.blockChunks.set(header.blockIndex, chunksMap);
        }
        chunksMap.set(header.chunkIndex, payload);

        // Check if we already received BLOCK_END and can verify this block
        if (this.blockEndPayloads.has(header.blockIndex)) {
          void this.tryVerifyBlock(header.blockIndex);
        }
      }
    } catch (err: unknown) {
      this.callbacks.onError(err as Error);
    }
  }

  public handleBlockEnd(payload: BlockEndPayload) {
    this.blockEndPayloads.set(payload.blockIndex, payload);
    void this.tryVerifyBlock(payload.blockIndex);
  }

  private async tryVerifyBlock(blockIndex: number) {
    const endMeta = this.blockEndPayloads.get(blockIndex);
    const chunksMap = this.blockChunks.get(blockIndex);
    if (!endMeta || !chunksMap) return;

    // Check if total received bytes for this block match byteLength
    let totalReceived = 0;
    const sortedIndices = Array.from(chunksMap.keys()).sort((a, b) => a - b);
    for (const idx of sortedIndices) {
      totalReceived += chunksMap.get(idx)!.byteLength;
    }

    if (totalReceived < endMeta.byteLength) {
      return; // Still waiting for more chunks
    }

    // Assemble block buffer for hashing and writing
    const assembledBlock = new Uint8Array(endMeta.byteLength);
    let offset = 0;
    for (const idx of sortedIndices) {
      const chunk = chunksMap.get(idx)!;
      assembledBlock.set(chunk, offset);
      offset += chunk.byteLength;
    }

    // Integrity Check (Section 4.7)
    const digest = await crypto.subtle.digest('SHA-256', assembledBlock);
    const hashHex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    if (hashHex !== endMeta.blockHash) {
      const retries = (this.blockRetryCounts.get(blockIndex) || 0) + 1;
      this.blockRetryCounts.set(blockIndex, retries);

      if (retries > MAX_BLOCK_RETRIES) {
        this.callbacks.onError(
          new Error(`Integrity mismatch on block ${blockIndex} after ${MAX_BLOCK_RETRIES} retries`)
        );
        return;
      }

      // Request retransmission of this block
      this.blockChunks.delete(blockIndex);
      this.blockEndPayloads.delete(blockIndex);
      this.callbacks.sendCtlMessage({
        type: 'block-retry',
        payload: { transferId: this.transferId, blockIndex },
      });
      return;
    }

    // Hash matches! Write durably to disk/storage strategy (Section 4.6)
    await this.writer.writeBlock(blockIndex, this.blockSize, assembledBlock);

    // Free memory immediately
    this.blockChunks.delete(blockIndex);
    this.blockEndPayloads.delete(blockIndex);

    this.verifiedBlocks.add(blockIndex);
    this.verifiedBytes += endMeta.byteLength;

    // Send ACK to sender (Section 4.4)
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

    // Return 1 block credit to replenish sender window (Section 4.4)
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

    // If all blocks are verified, finalize
    if (this.verifiedBlocks.size >= this.totalBlocks) {
      const output = await this.writer.finalize();
      this.callbacks.onFileComplete(output);
    }
  }
}
