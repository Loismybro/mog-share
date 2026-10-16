/**
 * Transfer Integrity (Section 4.7), secure-context safe (JS SHA-256 fallback).
 */
import { sha256Hex } from '../../utils/sha256.js';

export async function computeBlockHash(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  return sha256Hex(buffer);
}

export async function computeRootHash(blockHashes: string[]): Promise<string> {
  return sha256Hex(new TextEncoder().encode(blockHashes.join(':')));
}

export async function verifyRootHash(
  blockHashes: string[],
  expectedRootHash: string
): Promise<boolean> {
  const actual = await computeRootHash(blockHashes);
  return actual.toLowerCase() === expectedRootHash.toLowerCase();
}
