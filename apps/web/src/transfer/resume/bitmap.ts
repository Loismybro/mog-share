/**
 * Verified blocks bitmap encoder/decoder (Section 4.8)
 * Compresses an arbitrary set of verified block indices into compact base64 representation.
 */

export class BlockBitmap {
  private bits: Uint8Array;
  public readonly totalBlocks: number;

  constructor(totalBlocks: number, initialBitset?: Uint8Array) {
    this.totalBlocks = totalBlocks;
    const byteLength = Math.ceil(totalBlocks / 8);
    this.bits = initialBitset ? new Uint8Array(initialBitset) : new Uint8Array(byteLength);
  }

  public markVerified(blockIndex: number) {
    if (blockIndex < 0 || blockIndex >= this.totalBlocks) return;
    const byteIdx = Math.floor(blockIndex / 8);
    const bitOffset = blockIndex % 8;
    this.bits[byteIdx] |= 1 << bitOffset;
  }

  public isVerified(blockIndex: number): boolean {
    if (blockIndex < 0 || blockIndex >= this.totalBlocks) return false;
    const byteIdx = Math.floor(blockIndex / 8);
    const bitOffset = blockIndex % 8;
    return (this.bits[byteIdx] & (1 << bitOffset)) !== 0;
  }

  public getMissingBlocks(): number[] {
    const missing: number[] = [];
    for (let i = 0; i < this.totalBlocks; i++) {
      if (!this.isVerified(i)) {
        missing.push(i);
      }
    }
    return missing;
  }

  public getVerifiedCount(): number {
    let count = 0;
    for (let i = 0; i < this.totalBlocks; i++) {
      if (this.isVerified(i)) count++;
    }
    return count;
  }

  public toBase64(): string {
    let binary = '';
    for (let i = 0; i < this.bits.byteLength; i++) {
      binary += String.fromCharCode(this.bits[i]);
    }
    return btoa(binary);
  }

  public static fromBase64(base64: string, totalBlocks: number): BlockBitmap {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new BlockBitmap(totalBlocks, bytes);
  }
}
