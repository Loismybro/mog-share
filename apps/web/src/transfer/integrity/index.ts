/**
 * Transfer Integrity (Section 4.7)
 * - Computes per-block SHA-256 hash
 * - Computes root hash-of-hashes over ordered list of block hashes for whole-file integrity
 */

export async function computeBlockHash(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function computeRootHash(blockHashes: string[]): Promise<string> {
  const concatenated = blockHashes.join(':');
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(concatenated));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyRootHash(
  blockHashes: string[],
  expectedRootHash: string
): Promise<boolean> {
  const actual = await computeRootHash(blockHashes);
  return actual.toLowerCase() === expectedRootHash.toLowerCase();
}
