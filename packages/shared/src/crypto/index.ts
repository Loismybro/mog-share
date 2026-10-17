import { TURN_CREDENTIAL_TTL_SEC } from '../constants/index.js';

// Emoji dictionary for 3-emoji Short Authentication String (SAS)
export const SAS_EMOJI_LIST: readonly string[] = [
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
  '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔',
  '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺',
  '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞',
];

/**
 * Generates coturn REST-style ephemeral credentials (Section 3.7).
 * username = "<expiryUnix>:<randomId>", credential = base64(HMAC-SHA1(secret, username))
 */
export async function generateTurnCredentials(
  sharedSecret: string,
  ttlSeconds = TURN_CREDENTIAL_TTL_SEC,
  randomId?: string
): Promise<{ username: string; credential: string; ttl: number; expiryUnix: number }> {
  const expiryUnix = Math.floor(Date.now() / 1000) + ttlSeconds;
  const rand = randomId || Math.random().toString(36).slice(2, 10);
  const username = `${expiryUnix}:${rand}`;

  let credential = '';
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const enc = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      enc.encode(sharedSecret),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );
    const signature = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(username));
    const bytes = new Uint8Array(signature);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    credential = btoa(binary);
  } else {
    throw new Error('No Web Crypto subtle provider available');
  }

  return { username, credential, ttl: ttlSeconds, expiryUnix };
}

/**
 * Truncated SHA-256 hash for privacy-safe logging (Section 0, 3.2, 3.3).
 * Never logs raw IPs, usernames, or filenames in plaintext.
 */
export async function hashTruncated(value: string, salt = '', length = 12): Promise<string> {
  const input = `${salt}:${value}`;
  const enc = new TextEncoder();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(input));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, length);
}

/**
 * Computes Short Authentication String (SAS) for anti-MITM verification (Section 3.10).
 * Produces both a 4-digit numeric code and 3 emoji.
 */
export async function computeSAS(
  fingerprintA: string,
  fingerprintB: string,
  ecdhPubA: string,
  ecdhPubB: string
): Promise<{ numeric: string; emoji: string }> {
  // Sort inputs lexicographically so both peers compute the exact same hash regardless of order
  const [f1, f2] = [fingerprintA, fingerprintB].sort();
  const [k1, k2] = [ecdhPubA, ecdhPubB].sort();
  const combined = `SAS:${f1}:${f2}:${k1}:${k2}`;

  const enc = new TextEncoder();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(combined));
  const digestBytes = new Uint8Array(digest);

  // 4-digit code: (uint32 modulo 10000)
  const view = new DataView(digestBytes.buffer, digestBytes.byteOffset, 4);
  const numVal = view.getUint32(0, false) % 10000;
  const numeric = numVal.toString().padStart(4, '0');

  // 3 emoji: select 3 indices from 32-emoji list (5 bits each)
  const e1 = SAS_EMOJI_LIST[digestBytes[4] % SAS_EMOJI_LIST.length];
  const e2 = SAS_EMOJI_LIST[digestBytes[5] % SAS_EMOJI_LIST.length];
  const e3 = SAS_EMOJI_LIST[digestBytes[6] % SAS_EMOJI_LIST.length];
  const emoji = `${e1} ${e2} ${e3}`;

  return { numeric, emoji };
}
