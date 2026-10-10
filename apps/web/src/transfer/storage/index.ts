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
    return new Blob(parts, { type: this.mimeType });
  }

  async abort(): Promise<void> {
    this.blocks.clear();
  }
}
