// Personal Space (Vault) storage manager for received files in Mog-Share
// Persists files in IndexedDB with category classification, media playback, and export support.

export type FileCategory =
  | 'images'
  | 'videos'
  | 'audio'
  | 'documents'
  | 'apps'
  | 'archives'
  | 'other';

export interface PersonalSpaceItem {
  id: string;
  transferId?: string;
  name: string;
  size: number;
  type: string;
  category: FileCategory;
  senderName: string;
  senderId?: string;
  receivedAt: number;
  blob?: Blob;
  blobUrl?: string;
  channel?: 'direct' | 'relay';
  sha256?: string;
}

export function detectFileCategory(name: string, mimeType = ''): FileCategory {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const lowerMime = mimeType.toLowerCase();

  if (
    lowerMime.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'avif', 'tiff'].includes(ext)
  ) {
    return 'images';
  }

  if (
    lowerMime.startsWith('video/') ||
    ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', '3gp', 'm4v', 'wmv'].includes(ext)
  ) {
    return 'videos';
  }

  if (
    lowerMime.startsWith('audio/') ||
    ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus', 'wma', 'weba', 'mid', 'midi'].includes(ext)
  ) {
    return 'audio';
  }

  if (['apk', 'xapk', 'aab', 'ipa'].includes(ext) || lowerMime.includes('android.package-archive')) {
    return 'apps';
  }

  if (
    ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'tgz'].includes(ext) ||
    lowerMime.includes('zip') ||
    lowerMime.includes('tar') ||
    lowerMime.includes('compressed') ||
    lowerMime.includes('archive')
  ) {
    return 'archives';
  }

  if (
    lowerMime.startsWith('text/') ||
    lowerMime.includes('pdf') ||
    ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'json', 'md', 'xml', 'html', 'rtf', 'log', 'ts', 'js', 'py', 'java', 'c', 'cpp'].includes(ext)
  ) {
    return 'documents';
  }

  return 'other';
}

const DB_NAME = 'mog_share_personal_vault';
const STORE_NAME = 'files';
const DB_VERSION = 1;

// In-memory fallback if IndexedDB is blocked or in private browsing
const memoryStore = new Map<string, PersonalSpaceItem>();

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('receivedAt', 'receivedAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function notifyChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mog_vault_changed'));
  }
}

export async function saveToPersonalSpace(
  item: Omit<PersonalSpaceItem, 'category'> & { category?: FileCategory }
): Promise<PersonalSpaceItem> {
  const category = item.category || detectFileCategory(item.name, item.type);
  const entry: PersonalSpaceItem = {
    ...item,
    category,
    receivedAt: item.receivedAt || Date.now(),
  };

  memoryStore.set(entry.id, entry);

  const db = await openVaultDb();
  if (db) {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      // Store copy without transient blobUrl
      const { blobUrl: _discard, ...storable } = entry;
      tx.objectStore(STORE_NAME).put(storable);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('Personal Space DB save failed, kept in memory fallback', e);
    }
  }

  notifyChange();
  return entry;
}

export async function getPersonalSpaceItems(): Promise<PersonalSpaceItem[]> {
  const db = await openVaultDb();
  let results: PersonalSpaceItem[] = [];

  if (db) {
    try {
      results = await new Promise<PersonalSpaceItem[]>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve((req.result as PersonalSpaceItem[]) || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      results = [];
    }
  }

  // Merge with memory fallback
  const map = new Map<string, PersonalSpaceItem>();
  for (const item of results) map.set(item.id, item);
  for (const [id, item] of memoryStore.entries()) {
    if (!map.has(id)) map.set(id, item);
    else if (!map.get(id)?.blob && item.blob) {
      map.set(id, { ...map.get(id)!, blob: item.blob });
    }
  }

  const list = Array.from(map.values()).sort((a, b) => b.receivedAt - a.receivedAt);

  // Ensure blobUrls exist where blob is available
  for (const item of list) {
    if (item.blob && !item.blobUrl) {
      try {
        item.blobUrl = URL.createObjectURL(item.blob);
      } catch {
        /* Ignore URL creation errors */
      }
    }
  }

  return list;
}

export async function getPersonalSpaceItem(id: string): Promise<PersonalSpaceItem | null> {
  const items = await getPersonalSpaceItems();
  return items.find((i) => i.id === id) || null;
}

export async function deleteFromPersonalSpace(id: string): Promise<void> {
  memoryStore.delete(id);
  const db = await openVaultDb();
  if (db) {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      /* Ignore */
    }
  }
  notifyChange();
}

export async function clearPersonalSpace(): Promise<void> {
  memoryStore.clear();
  const db = await openVaultDb();
  if (db) {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      /* Ignore */
    }
  }
  notifyChange();
}

export function subscribePersonalSpace(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('mog_vault_changed', callback);
  return () => window.removeEventListener('mog_vault_changed', callback);
}

export async function openFileWithSystemShare(
  fileBlob: Blob,
  fileName: string,
  mimeType: string
): Promise<boolean> {
  try {
    const f = new File([fileBlob], fileName, { type: mimeType || 'application/octet-stream' });
    if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [f] })) {
      await navigator.share({
        files: [f],
        title: fileName,
      });
      return true;
    }
  } catch (err: unknown) {
    if ((err as Error)?.name !== 'AbortError') {
      console.warn('System share invocation error:', err);
    }
  }
  return false;
}
