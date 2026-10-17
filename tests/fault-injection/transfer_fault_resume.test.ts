import { describe, it, expect, vi } from 'vitest';
import { BlockBitmap } from '../../apps/web/src/transfer/resume/bitmap.js';
import { TransferJournal } from '../../apps/web/src/transfer/resume/journal.js';
import { StreamingZipWriter } from '../../apps/web/src/transfer/bundle/zip64.js';
import { MemoryBlockWriter } from '../../apps/web/src/transfer/storage/index.js';
import { FileSenderPipeline } from '../../apps/web/src/transfer/sender/index.js';
import { FileReceiverPipeline } from '../../apps/web/src/transfer/receiver/index.js';

describe('Phase 5: Fault-Injection, Resume Journal & Bundling', () => {
  it('correctly tracks and serializes verified blocks bitmap to base64', () => {
    const totalBlocks = 16;
    const bitmap = new BlockBitmap(totalBlocks);

    // Simulate verifying blocks 0, 1, 4, 15
    bitmap.markVerified(0);
    bitmap.markVerified(1);
    bitmap.markVerified(4);
    bitmap.markVerified(15);

    expect(bitmap.isVerified(0)).toBe(true);
    expect(bitmap.isVerified(2)).toBe(false);
    expect(bitmap.isVerified(15)).toBe(true);
    expect(bitmap.getVerifiedCount()).toBe(4);

    const missing = bitmap.getMissingBlocks();
    expect(missing).toContain(2);
    expect(missing).toContain(3);
    expect(missing).not.toContain(0);
    expect(missing).not.toContain(15);

    // Serialize to Base64 and restore
    const b64 = bitmap.toBase64();
    const restored = BlockBitmap.fromBase64(b64, totalBlocks);

    expect(restored.isVerified(0)).toBe(true);
    expect(restored.isVerified(1)).toBe(true);
    expect(restored.isVerified(4)).toBe(true);
    expect(restored.isVerified(15)).toBe(true);
    expect(restored.isVerified(2)).toBe(false);
    expect(restored.getMissingBlocks()).toEqual(missing);
  });

  it('generates valid streaming store-only ZIP archive for multiple files', async () => {
    const zip = new StreamingZipWriter();

    const file1Data = new TextEncoder().encode('Hello World in file 1');
    const file2Data = new TextEncoder().encode('Second file content in a subfolder');

    const chunk1 = zip.addFile({ path: 'folder/file1.txt', data: file1Data });
    const chunk2 = zip.addFile({ path: 'folder/file2.txt', data: file2Data });
    const footer = zip.finalize();

    const totalZipBytes = new Uint8Array(chunk1.length + chunk2.length + footer.length);
    totalZipBytes.set(chunk1, 0);
    totalZipBytes.set(chunk2, chunk1.length);
    totalZipBytes.set(footer, chunk1.length + chunk2.length);

    expect(totalZipBytes.byteLength).toBeGreaterThan(100);

    // Verify ZIP magic signature at byte 0 (0x04034b50)
    const view = new DataView(totalZipBytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
  });

  it('recovers seamlessly from simulated channel kill at 50% without corrupting data', async () => {
    // 4 blocks file (64 KiB total, 16 KiB blocks, 4 KiB chunks)
    const testData = new Uint8Array(64 * 1024);
    for (let i = 0; i < testData.length; i++) {
      testData[i] = (i * 7) % 256;
    }
    const testBlob = new Blob([testData], { type: 'application/octet-stream' });
    const testFile = new File([testBlob], 'fault-test.bin');

    const transferId = 'fault_transfer_001';
    const blockSize = 16 * 1024;
    const chunkSize = 4 * 1024;
    const totalBlocks = 4;

    const writer = new MemoryBlockWriter();
    const receiverBitmap = new BlockBitmap(totalBlocks);

    let channelKilled = false;

    // --- Session 1: Fails halfway ---
    let sender1: FileSenderPipeline;
    let receiver1: FileReceiverPipeline;

    let block1VerifiedPromise = new Promise<void>((res) => {
      receiver1 = new FileReceiverPipeline(
        transferId,
        testData.byteLength,
        writer,
        {
          sendCtlMessage: (msg: any) => {
            if (msg.type === 'block-ack') {
              sender1.handleBlockAck(msg.payload.blockIndex, msg.payload.verified);
            } else if (msg.type === 'credit-grant') {
              sender1.grantCredits(msg.payload.credits);
            }
          },
          onProgress: vi.fn(),
          onBlockVerified: (blockIdx) => {
            receiverBitmap.markVerified(blockIdx);
            if (blockIdx === 1) res();
          },
          onFileComplete: vi.fn(),
          onError: vi.fn(),
        },
        blockSize
      );
    });

    sender1 = new FileSenderPipeline(
      testFile,
      transferId,
      0,
      {
        sendDataChannel: (frame) => {
          if (channelKilled) return; // Drop frames when killed
          receiver1.handleDataFrame(frame);
        },
        sendCtlMessage: (msg: any) => {
          if (channelKilled) return;
          if (msg.type === 'block-end') {
            receiver1.handleBlockEnd(msg.payload);
            // Simulate sudden channel kill after block 1 is verified (50% progress)
            if (msg.payload.blockIndex === 1) {
              channelKilled = true;
              sender1.cancel();
            }
          }
        },
        getBufferedAmount: () => 0,
        waitForBufferedAmountLow: async () => {},
        onAckedProgress: vi.fn(),
        onBlockCompleted: vi.fn(),
        onFileCompleted: vi.fn(),
        onError: vi.fn(),
      },
      { chunkSize, blockSize }
    );

    await sender1.start();
    await block1VerifiedPromise;

    // Verify partial state: blocks 0 and 1 are verified, 2 and 3 are missing
    expect(receiverBitmap.isVerified(0)).toBe(true);
    expect(receiverBitmap.isVerified(1)).toBe(true);
    expect(receiverBitmap.isVerified(2)).toBe(false);
    expect(receiverBitmap.isVerified(3)).toBe(false);
    expect(receiverBitmap.getMissingBlocks()).toEqual([2, 3]);

    // --- Session 2: Resume with bitmap exchange ---
    // Re-establish session: Sender queries missing blocks from receiver bitmap
    const missingBlocks = receiverBitmap.getMissingBlocks();
    expect(missingBlocks).toEqual([2, 3]);

    let finalComplete = false;

    // Sender resumes: uses real FileSenderPipeline with resumeMissingBlocks
    let sender2: FileSenderPipeline;
    let receiver2: FileReceiverPipeline;

    receiver2 = new FileReceiverPipeline(
      transferId,
      testData.byteLength,
      writer,
      {
        sendCtlMessage: (msg: any) => {
          if (msg.type === 'block-ack') {
            sender2.handleBlockAck(msg.payload.blockIndex, msg.payload.verified);
          } else if (msg.type === 'credit-grant') {
            sender2.grantCredits(msg.payload.credits);
          }
        },
        onProgress: vi.fn(),
        onBlockVerified: (bIdx) => {
          receiverBitmap.markVerified(bIdx);
        },
        onFileComplete: () => {
          finalComplete = true;
        },
        onError: vi.fn(),
      },
      blockSize,
      [0, 1] // Already verified blocks from Session 1
    );

    sender2 = new FileSenderPipeline(
      testFile,
      transferId,
      0,
      {
        sendDataChannel: (frame) => {
          receiver2.handleDataFrame(frame);
        },
        sendCtlMessage: (msg: any) => {
          if (msg.type === 'block-end') {
            receiver2.handleBlockEnd(msg.payload);
          }
        },
        getBufferedAmount: () => 0,
        waitForBufferedAmountLow: async () => {},
        onAckedProgress: vi.fn(),
        onBlockCompleted: vi.fn(),
        onFileCompleted: vi.fn(),
        onError: vi.fn(),
      },
      { chunkSize, blockSize, resumeMissingBlocks: missingBlocks }
    );

    await sender2.start();
    // Wait for async verification
    await new Promise((r) => setTimeout(r, 100));

    expect(finalComplete).toBe(true);
    expect(receiverBitmap.getVerifiedCount()).toBe(4);

    // Verify whole file content
    const finalBlob = await writer.finalize();
    const finalBuffer = new Uint8Array(await finalBlob.arrayBuffer());
    expect(finalBuffer).toEqual(testData);
  });
});
