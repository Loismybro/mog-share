import {
  MEMORY_WRITER_MAX_BYTES,
  MEMORY_WRITER_WARN_BYTES,
  STORAGE_QUOTA_SAFETY_MARGIN_PERCENT,
  OPFS_TEMP_FILE_EXPIRY_MS,
} from '@shareapp/shared';

export type StorageStrategy = 'fsa' | 'opfs' | 'sw-stream' | 'memory';

export interface StorageCapabilities {
  hasFSA: boolean;
  hasOPFS: boolean;
  hasServiceWorker: boolean;
  canPersist: boolean;
}

export function detectStorageCapabilities(): StorageCapabilities {
  const hasFSA = typeof window !== 'undefined' && 'showSaveFilePicker' in window;
  const hasOPFS =
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof navigator.storage.getDirectory === 'function';
  const hasServiceWorker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const canPersist =
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof navigator.storage.persist === 'function';

  return { hasFSA, hasOPFS, hasServiceWorker, canPersist };
}

/**
 * Checks storage quota before accepting transfer (Section 4.6).
 * Refuses if free quota < file size + 10%.
 */
export async function checkStorageQuota(fileSize: number): Promise<{
  sufficient: boolean;
  freeBytes?: number;
  error?: string;
}> {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) {
    return { sufficient: true };
  }

  try {
    const estimate = await navigator.storage.estimate();
    const quota = estimate.quota || 0;
    const usage = estimate.usage || 0;
    const freeBytes = quota - usage;
    const requiredBytes = fileSize * (1 + STORAGE_QUOTA_SAFETY_MARGIN_PERCENT / 100);

    if (freeBytes < requiredBytes) {
      return {
        sufficient: false,
        freeBytes,
        error: `Insufficient disk quota. Need ${(requiredBytes / 1024 / 1024).toFixed(0)} MB, but only ${(freeBytes / 1024 / 1024).toFixed(0)} MB available.`,
      };
    }

    return { sufficient: true, freeBytes };
  } catch {
    return { sufficient: true };
  }
}

/**
 * Selects the optimal writer strategy according to Section 4.6 precedence:
 * 1) FSA (Desktop Chromium)
 * 2) OPFS (Android Chrome, Firefox, Safari iOS/Desktop)
 * 3) Service Worker Stream
 * 4) Memory (last resort < 200 MB)
 */
export function pickStorageStrategy(fileSize: number): {
  strategy: StorageStrategy;
  warning?: string;
} {
  const caps = detectStorageCapabilities();

  if (caps.hasFSA) {
    return { strategy: 'fsa' };
  }

  if (caps.hasOPFS) {
    return { strategy: 'opfs' };
  }

  if (caps.hasServiceWorker) {
    return { strategy: 'sw-stream' };
  }

  if (fileSize > MEMORY_WRITER_MAX_BYTES) {
    throw new Error(
      `File size (${(fileSize / 1024 / 1024).toFixed(0)} MB) exceeds 200 MB memory ceiling and disk writer is unavailable in this browser.`
    );
  }

  let warning: string | undefined;
  if (fileSize > MEMORY_WRITER_WARN_BYTES) {
    warning = 'High memory usage: Browser storage API is not available; file will be assembled in memory.';
  }

  return { strategy: 'memory', warning };
}

export interface BlockWriter {
  writeBlock(blockIndex: number, blockSize: number, data: Uint8Array): Promise<void>;
  finalize(): Promise<Blob | File | null>;
  abort(): Promise<void>;
}

export class MemoryBlockWriter implements BlockWriter {
  private blocks = new Map<number, Uint8Array>();
  private mimeType: string;

  constructor(mimeType = 'application/octet-stream') {
    this.mimeType = mimeType;
  }

  async writeBlock(blockIndex: number, _blockSize: number, data: Uint8Array): Promise<void> {
    this.blocks.set(blockIndex, data);
  }

  async finalize(): Promise<Blob> {
    const sortedIndices = Array.from(this.blocks.keys()).sort((a, b) => a - b);
    const parts: Uint8Array[] = [];
    for (const idx of sortedIndices) {
      parts.push(this.blocks.get(idx)!);
    }
    return new Blob(parts as unknown as BlobPart[], { type: this.mimeType });
  }

  async abort(): Promise<void> {
    this.blocks.clear();
  }
}

export class FSABlockWriter implements BlockWriter {
  private writable: any;

  constructor(writableStream: any) {
    this.writable = writableStream;
  }

  async writeBlock(blockIndex: number, blockSize: number, data: Uint8Array): Promise<void> {
    const offset = blockIndex * blockSize;
    if (typeof this.writable.seek === 'function') {
      await this.writable.seek(offset);
      await this.writable.write(data);
    } else {
      await this.writable.write({ type: 'write', position: offset, data });
    }
  }

  async finalize(): Promise<Blob | File | null> {
    await this.writable.close();
    return null;
  }

  async abort(): Promise<void> {
    if (typeof this.writable.abort === 'function') {
      await this.writable.abort();
    }
  }
}

export class OPFSBlockWriter implements BlockWriter {
  private opfsFileName: string;
  private fileHandle: any = null;
  private syncHandle: any = null;
  private writableStream: any = null;
  private mimeType: string;

  constructor(fileName: string, transferId = 'transfer', mimeType = 'application/octet-stream') {
    this.opfsFileName = `shareapp_${transferId}_${fileName.replace(/[^\w.-]/g, '_')}`;
    this.mimeType = mimeType;
  }

  async init(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      this.fileHandle = await root.getFileHandle(this.opfsFileName, { create: true });
      if (typeof (this.fileHandle as any).createSyncAccessHandle === 'function') {
        try {
          this.syncHandle = await (this.fileHandle as any).createSyncAccessHandle();
        } catch {
          this.writableStream = await this.fileHandle.createWritable();
        }
      } else if (typeof this.fileHandle.createWritable === 'function') {
        this.writableStream = await this.fileHandle.createWritable();
      }
    }
  }

  async writeBlock(blockIndex: number, blockSize: number, data: Uint8Array): Promise<void> {
    if (!this.fileHandle) {
      await this.init();
    }
    const offset = blockIndex * blockSize;
    if (this.syncHandle) {
      this.syncHandle.write(data, { at: offset });
      if (typeof this.syncHandle.flush === 'function') {
        this.syncHandle.flush();
      }
    } else if (this.writableStream) {
      if (typeof this.writableStream.seek === 'function') {
        await this.writableStream.seek(offset);
        await this.writableStream.write(data);
      } else {
        await this.writableStream.write({ type: 'write', position: offset, data });
      }
    }
  }

  async finalize(): Promise<File | Blob | null> {
    if (this.syncHandle) {
      try { this.syncHandle.close(); } catch {}
      this.syncHandle = null;
    }
    if (this.writableStream) {
      try { await this.writableStream.close(); } catch {}
      this.writableStream = null;
    }
    if (this.fileHandle) {
      const rawFile = await this.fileHandle.getFile();
      const file = this.mimeType ? new File([rawFile], rawFile.name, { type: this.mimeType }) : rawFile;
      setTimeout(async () => {
        try {
          const root = await navigator.storage.getDirectory();
          await root.removeEntry(this.opfsFileName);
        } catch {}
      }, OPFS_TEMP_FILE_EXPIRY_MS);
      return file;
    }
    return null;
  }

  async abort(): Promise<void> {
    if (this.syncHandle) {
      try { this.syncHandle.close(); } catch {}
      this.syncHandle = null;
    }
    if (this.writableStream) {
      try { await this.writableStream.abort(); } catch {}
      this.writableStream = null;
    }
    if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(this.opfsFileName);
      } catch {}
    }
  }
}

export async function createBlockWriter(options: {
  strategy?: StorageStrategy;
  fileName: string;
  fileSize: number;
  mimeType?: string;
  transferId?: string;
  writableStream?: any;
}): Promise<BlockWriter> {
  const caps = detectStorageCapabilities();
  let strategy = options.strategy || pickStorageStrategy(options.fileSize).strategy;

  if (strategy === 'fsa') {
    if (options.writableStream) {
      return new FSABlockWriter(options.writableStream);
    }
    // No writableStream provided (e.g. background/automated receive); fallback to OPFS if available
    strategy = caps.hasOPFS ? 'opfs' : 'memory';
  }

  if (strategy === 'opfs') {
    const writer = new OPFSBlockWriter(
      options.fileName,
      options.transferId,
      options.mimeType
    );
    try {
      await writer.init();
      return writer;
    } catch {
      return new MemoryBlockWriter(options.mimeType);
    }
  }

  return new MemoryBlockWriter(options.mimeType);
}
