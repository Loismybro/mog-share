import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_BLOCK_SIZE,
  BUFFERED_AMOUNT_HIGH_WATERMARK,
  DEFAULT_CREDIT_WINDOW_BLOCKS,
  MAX_CREDIT_WINDOW_BLOCKS,
} from '@shareapp/shared';
import { sha256Hex } from '../../utils/sha256.js';
import {
  BinaryFrameType,
  encodeBinaryFrame,
  type BlockEndPayload,
} from '../protocol/index.js';

export interface FileSenderCallbacks {
  sendDataChannel: (frame: Uint8Array) => Promise<void> | void;
  sendCtlMessage: (message: unknown) => void;
  getBufferedAmount: () => number;
  waitForBufferedAmountLow: () => Promise<void>;
  onAckedProgress: (acknowledgedBytes: number, totalBytes: number, speedBps: number) => void;
  onChunkProgress?: (sentBytes: number, totalBytes: number, speedBps: number) => void;
  onBlockCompleted: (blockIndex: number) => void;
  onFileCompleted: () => void;
  onError: (error: Error) => void;
}

export class FileSenderPipeline {
  private file: File;
  private transferId: string;
  private transferIdNum: number;
  private fileIndex: number;
  private chunkSize: number;
  private blockSize: number;

  private availableCredits = DEFAULT_CREDIT_WINDOW_BLOCKS;
  private acknowledgedBlocks = new Set<number>();
  private totalBlocks: number;
  private pendingBlocks: number[] = [];
  private blockAckTimers = new Map<number, ReturnType<typeof setTimeout>>();

  private isPaused = false;
  private isCancelled = false;
  private isCompleted = false;
  private inFlight = false;

  private startTime = Date.now();
  private lastSpeedSampleTime = Date.now();
  private lastAckedBytes = 0;
  private acknowledgedBytes = 0;
  private rawBytesSent = 0;

  private callbacks: FileSenderCallbacks;

  constructor(
    file: File,
    transferId: string,
    fileIndex = 0,
    callbacks: FileSenderCallbacks,
    options?: { chunkSize?: number; blockSize?: number; resumeMissingBlocks?: number[] }
  ) {
    this.file = file;
    this.transferId = transferId;
    this.transferIdNum = this.hashTransferId(transferId);
    this.fileIndex = fileIndex;
    this.callbacks = callbacks;
    this.chunkSize = options?.chunkSize || DEFAULT_CHUNK_SIZE;
    this.blockSize = options?.blockSize || DEFAULT_BLOCK_SIZE;
    this.totalBlocks = Math.max(1, Math.ceil(file.size / this.blockSize));

    if (options?.resumeMissingBlocks) {
      this.pendingBlocks = [...options.resumeMissingBlocks];
      for (let b = 0; b < this.totalBlocks; b++) {
        if (!options.resumeMissingBlocks.includes(b)) {
          this.acknowledgedBlocks.add(b);
          const blockStart = b * this.blockSize;
          const blockEnd = Math.min(this.file.size, (b + 1) * this.blockSize);
          this.acknowledgedBytes += blockEnd - blockStart;
          this.rawBytesSent += blockEnd - blockStart;
        }
      }
    } else {
      for (let b = 0; b < this.totalBlocks; b++) {
        this.pendingBlocks.push(b);
      }
    }
  }

  private hashTransferId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (Math.imul(31, hash) + id.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
  }

  private clearBlockTimer(blockIndex: number) {
    const t = this.blockAckTimers.get(blockIndex);
    if (t) {
      clearTimeout(t);
      this.blockAckTimers.delete(blockIndex);
    }
  }

  private clearAllBlockTimers() {
    for (const t of this.blockAckTimers.values()) {
      clearTimeout(t);
    }
    this.blockAckTimers.clear();
  }

  public grantCredits(credits: number) {
    this.availableCredits = Math.min(
      this.availableCredits + credits,
      MAX_CREDIT_WINDOW_BLOCKS
    );
    if (!this.inFlight && this.pendingBlocks.length > 0 && !this.isPaused && !this.isCancelled) {
      void this.pump();
    }
  }

  public resumeWithMissingBlocks(missingBlocks: number[]) {
    this.pendingBlocks = [...missingBlocks];
    this.isPaused = false;
    this.isCancelled = false;
    void this.pump();
  }

  public retryBlock(blockIndex: number) {
    this.clearBlockTimer(blockIndex);
    if (this.acknowledgedBlocks.has(blockIndex) || this.isCompleted || this.isCancelled) return;
    if (!this.pendingBlocks.includes(blockIndex)) {
      this.pendingBlocks.unshift(blockIndex);
    }
    this.availableCredits = Math.max(1, this.availableCredits);
    this.isPaused = false;
    if (!this.inFlight) {
      void this.pump();
    }
  }

  public handleBlockAck(blockIndex: number, verified: boolean) {
    this.clearBlockTimer(blockIndex);

    if (!verified) {
      this.retryBlock(blockIndex);
      return;
    }

    if (!this.acknowledgedBlocks.has(blockIndex)) {
      this.acknowledgedBlocks.add(blockIndex);

      const blockStart = blockIndex * this.blockSize;
      const blockEnd = Math.min(this.file.size, (blockIndex + 1) * this.blockSize);
      const blockSizeActual = blockEnd - blockStart;
      this.acknowledgedBytes += blockSizeActual;

      const now = Date.now();
      const dt = Math.max(0.05, (now - this.lastSpeedSampleTime) / 1000);
      const elapsedTotal = Math.max(0.05, (now - this.startTime) / 1000);
      let speedBps = (this.acknowledgedBytes - this.lastAckedBytes) / dt;
      if (dt >= 0.2) {
        this.lastSpeedSampleTime = now;
        this.lastAckedBytes = this.acknowledgedBytes;
      } else {
        speedBps = this.acknowledgedBytes / elapsedTotal;
      }

      this.callbacks.onAckedProgress(this.acknowledgedBytes, this.file.size, speedBps);
      this.callbacks.onBlockCompleted(blockIndex);

      if (this.acknowledgedBlocks.size >= this.totalBlocks && !this.isCompleted) {
        this.isCompleted = true;
        this.clearAllBlockTimers();
        this.callbacks.onFileCompleted();
      }
    }
  }

  public async start() {
    this.isPaused = false;
    this.isCancelled = false;
    this.startTime = Date.now();
    this.lastSpeedSampleTime = Date.now();
    await this.pump();
  }

  public pause() {
    this.isPaused = true;
  }

  public resume() {
    if (this.isPaused) {
      this.isPaused = false;
      void this.pump();
    }
  }

  public cancel() {
    this.isCancelled = true;
    this.isPaused = false;
    this.clearAllBlockTimers();
  }

  private async pump() {
    if (this.inFlight || this.isPaused || this.isCancelled || this.isCompleted) return;
    this.inFlight = true;

    try {
      while (
        this.pendingBlocks.length > 0 &&
        this.availableCredits > 0 &&
        !this.isPaused &&
        !this.isCancelled &&
        !this.isCompleted
      ) {
        const blockIdx = this.pendingBlocks.shift()!;
        if (this.acknowledgedBlocks.has(blockIdx)) continue;
        this.availableCredits--;

        await this.sendBlock(blockIdx);
      }
    } catch (err: unknown) {
      this.callbacks.onError(err as Error);
    } finally {
      this.inFlight = false;
    }
  }

  private async sendBlock(blockIndex: number) {
    const startByte = blockIndex * this.blockSize;
    const endByte = Math.min(this.file.size, (blockIndex + 1) * this.blockSize);
    const slice = this.file.slice(startByte, endByte);
    const blockBuffer = await slice.arrayBuffer();

    const blockHash = await sha256Hex(blockBuffer);

    const totalBlockBytes = blockBuffer.byteLength;
    const numChunks = Math.max(1, Math.ceil(totalBlockBytes / this.chunkSize));

    for (let c = 0; c < numChunks; c++) {
      if (this.isCancelled || this.isCompleted) return;
      while (this.isPaused && !this.isCancelled) {
        await new Promise((r) => setTimeout(r, 80));
      }
      if (this.isCancelled || this.isCompleted) return;

      if (this.callbacks.getBufferedAmount() > BUFFERED_AMOUNT_HIGH_WATERMARK) {
        await this.callbacks.waitForBufferedAmountLow();
      }

      const cStart = c * this.chunkSize;
      const cEnd = Math.min(totalBlockBytes, (c + 1) * this.chunkSize);
      const chunkBytes = new Uint8Array(blockBuffer, cStart, cEnd - cStart);

      const frame = encodeBinaryFrame(
        {
          type: BinaryFrameType.DATA,
          transferIdNum: this.transferIdNum,
          fileIndex: this.fileIndex,
          blockIndex,
          chunkIndex: c,
        },
        chunkBytes
      );

      const maybePromise = this.callbacks.sendDataChannel(frame);
      if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
        await maybePromise;
      } else if (c % 16 === 15) {
        await new Promise((r) => setTimeout(r, 0));
      }

      const currentInFlight = startByte + cEnd;
      if (currentInFlight > this.rawBytesSent) {
        this.rawBytesSent = Math.min(this.file.size, currentInFlight);
      }

      if (this.callbacks.onChunkProgress && (c % 8 === 0 || c === numChunks - 1)) {
        const elapsed = Math.max(0.05, (Date.now() - this.startTime) / 1000);
        const honestBytes = Math.min(
          this.rawBytesSent,
          this.acknowledgedBytes + this.blockSize * 3
        );
        this.callbacks.onChunkProgress(
          honestBytes,
          this.file.size,
          honestBytes / elapsed
        );
      }
    }

    const blockEndPayload: BlockEndPayload = {
      transferId: this.transferId,
      fileIndex: this.fileIndex,
      blockIndex,
      blockHash,
      byteLength: totalBlockBytes,
    };
    this.callbacks.sendCtlMessage({
      type: 'block-end',
      payload: blockEndPayload,
    });

    // Watchdog: if block-ack does not arrive within 3.5s, re-send block-end or retransmit block
    this.clearBlockTimer(blockIndex);
    if (typeof window !== 'undefined') {
      const timer = setTimeout(() => {
        if (
          !this.acknowledgedBlocks.has(blockIndex) &&
          !this.isCancelled &&
          !this.isPaused &&
          !this.isCompleted
        ) {
          this.retryBlock(blockIndex);
        }
      }, 3500);
      this.blockAckTimers.set(blockIndex, timer);
    }
  }
}
