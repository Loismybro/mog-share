import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_BLOCK_SIZE,
  BUFFERED_AMOUNT_LOW_THRESHOLD,
  BUFFERED_AMOUNT_HIGH_WATERMARK,
  DEFAULT_CREDIT_WINDOW_BLOCKS,
  MIN_CREDIT_WINDOW_BLOCKS,
  MAX_CREDIT_WINDOW_BLOCKS,
} from '@shareapp/shared';
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

  private isPaused = false;
  private isCancelled = false;
  private inFlight = false;

  private lastSpeedSampleTime = Date.now();
  private lastAckedBytes = 0;
  private acknowledgedBytes = 0;

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

  public handleBlockAck(blockIndex: number, verified: boolean) {
    if (!verified) {
      this.callbacks.onError(new Error(`Block ${blockIndex} failed verification on receiver`));
      return;
    }

    if (!this.acknowledgedBlocks.has(blockIndex)) {
      this.acknowledgedBlocks.add(blockIndex);

      const blockStart = blockIndex * this.blockSize;
      const blockEnd = Math.min(this.file.size, (blockIndex + 1) * this.blockSize);
      const blockSizeActual = blockEnd - blockStart;
      this.acknowledgedBytes += blockSizeActual;

      // Calculate speed based on verified acked bytes (Section 4.4, fixes A18)
      const now = Date.now();
      const dt = (now - this.lastSpeedSampleTime) / 1000;
      let speedBps = 0;
      if (dt >= 0.5) {
        speedBps = (this.acknowledgedBytes - this.lastAckedBytes) / dt;
        this.lastSpeedSampleTime = now;
        this.lastAckedBytes = this.acknowledgedBytes;
      }

      this.callbacks.onAckedProgress(this.acknowledgedBytes, this.file.size, speedBps);
      this.callbacks.onBlockCompleted(blockIndex);

      if (this.acknowledgedBlocks.size >= this.totalBlocks) {
        this.callbacks.onFileCompleted();
      }
    }
  }

  public async start() {
    this.isPaused = false;
    this.isCancelled = false;
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
  }

  /**
   * Main pumping loop: respects Layer 1 transport backpressure and Layer 2 application credits.
   */
  private async pump() {
    if (this.inFlight || this.isPaused || this.isCancelled) return;
    this.inFlight = true;

    try {
      while (
        this.pendingBlocks.length > 0 &&
        this.availableCredits > 0 &&
        !this.isPaused &&
        !this.isCancelled
      ) {
        const blockIdx = this.pendingBlocks.shift()!;
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

    // Compute block hash for BLOCK_END integrity manifest (Section 4.5 & 4.7)
    const digest = await crypto.subtle.digest('SHA-256', blockBuffer);
    const blockHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const totalBlockBytes = blockBuffer.byteLength;
    const numChunks = Math.ceil(totalBlockBytes / this.chunkSize);

    for (let c = 0; c < numChunks; c++) {
      if (this.isCancelled) return;

      // Layer 1 (Transport backpressure): check bufferedAmount against high-water mark (1 MiB)
      if (this.callbacks.getBufferedAmount() > BUFFERED_AMOUNT_HIGH_WATERMARK) {
        await this.callbacks.waitForBufferedAmountLow();
      }

      const cStart = c * this.chunkSize;
      const cEnd = Math.min(totalBlockBytes, (c + 1) * this.chunkSize);
      const chunkBytes = new Uint8Array(blockBuffer.slice(cStart, cEnd));

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

      await this.callbacks.sendDataChannel(frame);
    }

    // Send BLOCK_END control message on ctl channel (Section 4.2 & 4.5)
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
  }
}
