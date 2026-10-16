/** 32-bit id derived from the string transfer id (same algorithm the sender uses). */
export function transferIdToNum(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (Math.imul(31, hash) + id.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export {
  BinaryFrameType,
  BINARY_HEADER_SIZE,
  type BinaryFrameHeader,
  encodeBinaryFrame,
  decodeBinaryFrame,
  type HelloPayload,
  type ManifestPayload,
  type ManifestFileEntry,
  type BlockEndPayload,
  type BlockAckPayload,
  type CreditGrantPayload,
  type ResumeRequestPayload,
} from '@shareapp/shared';
