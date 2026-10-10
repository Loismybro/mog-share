// F7: transfer history persisted in IndexedDB.

export interface HistoryEntry {
  id: string;
  name: string;
  size: number;
  direction: 'sending' | 'receiving';
  peerName: string;
  status: string;
  channel?: string;
  finishedAt: number;
}

const DB_NAME = 'mog-share';
const STORE = 'history';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function addHistory(entry: HistoryEntry): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
  } catch { /* quota / private mode */ }
}

export async function getHistory(limit = 200): Promise<HistoryEntry[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const all = (req.result as HistoryEntry[]) || [];
        all.sort((a, b) => b.finishedAt - a.finishedAt);
        resolve(all.slice(0, limit));
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function clearHistory(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
  } catch { /* ignore */ }
}
