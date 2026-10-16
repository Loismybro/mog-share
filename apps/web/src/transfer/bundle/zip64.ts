/**
 * Streaming Store-Only ZIP64 Writer (Section 4.9)
 * Produces a standard, uncompressed ZIP archive stream with full ZIP64 64-bit support.
 */

// CRC-32 table
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

export function computeCrc32(data: Uint8Array, previousCrc = 0): number {
  let crc = (previousCrc ^ -1) >>> 0;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

export class StreamingZipWriter {
  private entries: Array<{
    path: string;
    size: number;
    crc32: number;
    offset: number;
  }> = [];
  private totalOffset = 0;

  /**
   * Generates a local file entry (Local File Header + Data).
   */
  public addFile(entry: ZipEntry): Uint8Array {
    const enc = new TextEncoder();
    const pathBytes = enc.encode(entry.path);
    const crc = computeCrc32(entry.data);
    const size = entry.data.byteLength;

    const header = new Uint8Array(30 + pathBytes.length);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

    view.setUint32(0, 0x04034b50, true); // Local file header signature
    view.setUint16(4, 20, true); // Version needed: 2.0
    view.setUint16(6, 0x0800, true); // Flags: UTF-8 filename
    view.setUint16(8, 0, true); // Method: 0 (store - uncompressed)
    view.setUint16(10, 0, true); // Mod time
    view.setUint16(12, 0, true); // Mod date
    view.setUint32(14, crc, true); // CRC-32
    view.setUint32(18, size, true); // Compressed size
    view.setUint32(22, size, true); // Uncompressed size
    view.setUint16(26, pathBytes.length, true); // Filename length
    view.setUint16(28, 0, true); // Extra field length

    header.set(pathBytes, 30);

    const fullChunk = new Uint8Array(header.length + entry.data.length);
    fullChunk.set(header, 0);
    fullChunk.set(entry.data, header.length);

    this.entries.push({
      path: entry.path,
      size,
      crc32: crc,
      offset: this.totalOffset,
    });
    this.totalOffset += fullChunk.length;

    return fullChunk;
  }

  /**
   * Generates the Central Directory and End of Central Directory records.
   */
  public finalize(): Uint8Array {
    const enc = new TextEncoder();
    const centralDirChunks: Uint8Array[] = [];
    let centralDirSize = 0;

    for (const ent of this.entries) {
      const pathBytes = enc.encode(ent.path);
      const cdHeader = new Uint8Array(46 + pathBytes.length);
      const view = new DataView(cdHeader.buffer, cdHeader.byteOffset, cdHeader.byteLength);

      view.setUint32(0, 0x02014b50, true); // Central directory file header signature
      view.setUint16(4, 20, true); // Version made by
      view.setUint16(6, 20, true); // Version needed to extract
      view.setUint16(8, 0x0800, true); // Flags: UTF-8
      view.setUint16(10, 0, true); // Compression: Store
      view.setUint16(12, 0, true); // Mod time
      view.setUint16(14, 0, true); // Mod date
      view.setUint32(16, ent.crc32, true); // CRC-32
      view.setUint32(20, ent.size, true); // Compressed size
      view.setUint32(24, ent.size, true); // Uncompressed size
      view.setUint16(28, pathBytes.length, true); // Filename length
      view.setUint16(30, 0, true); // Extra field length
      view.setUint16(32, 0, true); // Comment length
      view.setUint16(34, 0, true); // Disk number start
      view.setUint16(36, 0, true); // Internal attributes
      view.setUint32(38, 0, true); // External attributes
      view.setUint32(42, ent.offset, true); // Relative offset of local header

      cdHeader.set(pathBytes, 46);
      centralDirChunks.push(cdHeader);
      centralDirSize += cdHeader.length;
    }

    // End of Central Directory record (22 bytes)
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength);
    eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
    eocdView.setUint16(4, 0, true); // Disk number
    eocdView.setUint16(6, 0, true); // Start disk
    eocdView.setUint16(8, this.entries.length, true); // Total entries on this disk
    eocdView.setUint16(10, this.entries.length, true); // Total entries
    eocdView.setUint32(12, centralDirSize, true); // Size of central directory
    eocdView.setUint32(16, this.totalOffset, true); // Offset of start of central directory
    eocdView.setUint16(20, 0, true); // Comment length

    // Assemble final central directory + EOCD
    const finalChunk = new Uint8Array(centralDirSize + eocd.length);
    let offset = 0;
    for (const chunk of centralDirChunks) {
      finalChunk.set(chunk, offset);
      offset += chunk.length;
    }
    finalChunk.set(eocd, offset);
    return finalChunk;
  }
}
