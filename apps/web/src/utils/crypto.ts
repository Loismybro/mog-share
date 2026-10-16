// F8 / T2: Web Crypto helpers — SHA-256 integrity and passphrase-based
// AES-GCM encryption for the relay fallback path and clipboard text.

const subtle = () => window.crypto?.subtle;

/** T2: hex SHA-256 of a buffer (used for files up to the hash cap). */
export async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  try {
    const s = subtle();
    if (!s) return null;
    const digest = await s.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

/** F8: PBKDF2(passphrase, salt=room code) → AES-GCM 256 key. */
export async function deriveRoomKey(passphrase: string, salt: string): Promise<CryptoKey | null> {
  try {
    const s = subtle();
    if (!s || !passphrase) return null;
    const enc = new TextEncoder();
    const base = await s.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return await s.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(`mogshare:${salt}`), iterations: 150_000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  } catch {
    return null;
  }
}

/** Encrypt a binary chunk → iv(12) + ciphertext in one buffer. */
export async function encryptChunk(key: CryptoKey, buf: ArrayBuffer): Promise<ArrayBuffer> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle()!.encrypt({ name: 'AES-GCM', iv }, key, buf);
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return out.buffer;
}

/** Decrypt iv(12)+ciphertext. Throws on wrong key. */
export async function decryptChunk(key: CryptoKey, buf: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(buf);
  const iv = bytes.subarray(0, 12);
  const ct = bytes.subarray(12);
  return subtle()!.decrypt({ name: 'AES-GCM', iv }, key, ct);
}

export async function encryptText(key: CryptoKey, text: string): Promise<string> {
  const buf = await encryptChunk(key, new TextEncoder().encode(text).buffer as ArrayBuffer);
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export async function decryptText(key: CryptoKey, b64: string): Promise<string> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const plain = await decryptChunk(key, bytes.buffer);
  return new TextDecoder().decode(plain);
}
