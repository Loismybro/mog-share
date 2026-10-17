import {
  TRANSFER_JOURNAL_DEBOUNCE_MS,
  TRANSFER_JOURNAL_EXPIRY_MS,
} from '@shareapp/shared';

export interface TransferJournalRecord {
  transferId: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  blockSize: number;
  totalBlocks: number;
  bitmapBase64: string;
  direction: 'sending' | 'receiving';
  peerDeviceId: string;
  peerPublicKey?: string;
  updatedAt: number;
}

export class TransferJournal {
  private dbName = 'shareapp_transfers';
  private storeName = 'transfers';
  private db: IDBDatabase | null = null;
  private memoryFallback = new Map<string, TransferJournalRecord>();
  private pendingWrites = new Map<string, TransferJournalRecord>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.initDb();
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flushNow());
    }
  }

  private async initDb(): Promise<IDBDatabase | null> {
    if (this.db) return this.db;
    if (typeof indexedDB === 'undefined') return null;

    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'transferId' });
          }
        };
        req.onsuccess = () => {
          this.db = req.result;
          resolve(this.db);
        };
        req.onerror = () => {
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
  }

  public recordProgress(record: TransferJournalRecord) {
    record.updatedAt = Date.now();
    this.pendingWrites.set(record.transferId, record);
    this.memoryFallback.set(record.transferId, record);

    if (!this.debounceTimer) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.flushNow();
      }, TRANSFER_JOURNAL_DEBOUNCE_MS);
    }
  }

  public async flushNow(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.pendingWrites.size === 0) return;
    const records = Array.from(this.pendingWrites.values());
    this.pendingWrites.clear();

    const db = await this.initDb();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        for (const rec of records) {
          store.put(rec);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  public async getRecord(transferId: string): Promise<TransferJournalRecord | undefined> {
    const mem = this.memoryFallback.get(transferId);
    if (mem) return mem;

    const db = await this.initDb();
    if (!db) return undefined;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.get(transferId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  public async removeRecord(transferId: string): Promise<void> {
    this.memoryFallback.delete(transferId);
    this.pendingWrites.delete(transferId);

    const db = await this.initDb();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.delete(transferId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  public async pruneExpired(): Promise<void> {
    const cutoff = Date.now() - TRANSFER_JOURNAL_EXPIRY_MS;
    for (const [id, rec] of this.memoryFallback) {
      if (rec.updatedAt < cutoff) this.memoryFallback.delete(id);
    }

    const db = await this.initDb();
    if (!db) return;

    try {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const rec = cursor.value as TransferJournalRecord;
          if (rec.updatedAt < cutoff) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
    } catch { /* ignore */ }
  }
}
