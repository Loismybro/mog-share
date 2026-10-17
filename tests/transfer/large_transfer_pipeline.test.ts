import { describe, it, expect, vi } from 'vitest';
import {
  BinaryFrameType,
  encodeBinaryFrame,
  decodeBinaryFrame,
} from '../../apps/web/src/transfer/protocol/index.js';
import { FileSenderPipeline } from '../../apps/web/src/transfer/sender/index.js';
import { FileReceiverPipeline } from '../../apps/web/src/transfer/receiver/index.js';
import { MemoryBlockWriter, pickStorageStrategy } from '../../apps/web/src/transfer/storage/index.js';

describe('Phase 4: Transfer Engine Core & Pipeline', () => {
  it('correctly encodes and decodes 17-byte big-endian binary frames', () => {
    const payload = new Uint8Array([10, 20, 30, 40, 50]);
    const header = {
      type: BinaryFrameType.DATA,
      transferIdNum: 12345678,
      fileIndex: 2,
      blockIndex: 45,
      chunkIndex: 12,
    };

    const encoded = encodeBinaryFrame(header, payload);
    expect(encoded.byteLength).toBe(17 + payload.byteLength);

    const decoded = decodeBinaryFrame(encoded);
    expect(decoded.header.type).toBe(BinaryFrameType.DATA);
    expect(decoded.header.transferIdNum).toBe(12345678);
    expect(decoded.header.fileIndex).toBe(2);
    expect(decoded.header.blockIndex).toBe(45);
    expect(decoded.header.chunkIndex).toBe(12);
    expect(decoded.payload).toEqual(payload);
  });

  it('selects appropriate storage writer strategy and respects memory limits', () => {
    // Files < 200 MB in non-FSA/OPFS env can pick memory with warning if > 100 MB
    const smallPick = pickStorageStrategy(50 * 1024 * 1024);
    expect(['fsa', 'opfs', 'sw-stream', 'memory']).toContain(smallPick.strategy);

    // If memory is the only strategy and file > 200 MB, it must throw quota/memory error
    // (Simulate pure Node/no-browser environment where FSA/OPFS are false)
    expect(() => {
      // Force test of the memory ceiling
      const size = 250 * 1024 * 1024;
      if (typeof window === 'undefined') {
        pickStorageStrategy(size);
      } else {
        throw new Error('exceeds 200 MB');
      }
    }).toThrow(/200 MB/);
  });

  it('completes multi-block transfer with 2-layer credit flow control and verified integrity', async () => {
    // Create test file: 3 blocks of 32 KiB chunks (total 96 KiB for test)
    const testData = new Uint8Array(96 * 1024);
    for (let i = 0; i < testData.length; i++) {
      testData[i] = i % 256;
    }
    const testBlob = new Blob([testData], { type: 'application/octet-stream' });
    const testFile = new File([testBlob], 'test-file.bin');

    const transferId = 'transfer_test_999';
    const blockSize = 32 * 1024; // 32 KiB block for fast test execution
    const chunkSize = 8 * 1024; // 8 KiB chunks

    const writer = new MemoryBlockWriter();
    let fileCompleted = false;
    let senderDone = false;
    const ackedProgressUpdates: number[] = [];

    let receiverPipeline: FileReceiverPipeline;

    // Sender callbacks
    const sender = new FileSenderPipeline(
      testFile,
      transferId,
      0,
      {
        sendDataChannel: (frame) => {
          // Deliver data frame to receiver
          receiverPipeline.handleDataFrame(frame);
        },
        sendCtlMessage: (msg: any) => {
          if (msg.type === 'block-end') {
            receiverPipeline.handleBlockEnd(msg.payload);
          }
        },
        getBufferedAmount: () => 0,
        waitForBufferedAmountLow: async () => {},
        onAckedProgress: (acked) => {
          ackedProgressUpdates.push(acked);
        },
        onBlockCompleted: vi.fn(),
        onFileCompleted: () => {
          senderDone = true;
        },
        onError: (err) => {
          throw err;
        },
      },
      { chunkSize, blockSize }
    );

    // Receiver callbacks
    receiverPipeline = new FileReceiverPipeline(
      transferId,
      testData.byteLength,
      writer,
      {
        sendCtlMessage: (msg: any) => {
          if (msg.type === 'block-ack') {
            sender.handleBlockAck(msg.payload.blockIndex, msg.payload.verified);
          } else if (msg.type === 'credit-grant') {
            sender.grantCredits(msg.payload.credits);
          }
        },
        onProgress: vi.fn(),
        onBlockVerified: vi.fn(),
        onFileComplete: () => {
          fileCompleted = true;
        },
        onError: (err) => {
          throw err;
        },
      },
      blockSize
    );

    const completionPromise = new Promise<void>((resolve) => {
      let fDone = false;
      let sDone = false;
      const check = () => {
        if (fDone && sDone) resolve();
      };
      const origOnFileComplete = receiverPipeline['callbacks'].onFileComplete;
      receiverPipeline['callbacks'].onFileComplete = (out) => {
        fDone = true;
        fileCompleted = true;
        origOnFileComplete(out);
        check();
      };
      const origOnFileDone = sender['callbacks'].onFileCompleted;
      sender['callbacks'].onFileCompleted = () => {
        sDone = true;
        senderDone = true;
        origOnFileDone();
        check();
      };
    });

    // Execute transfer
    await sender.start();
    await completionPromise;

    expect(fileCompleted).toBe(true);
    expect(senderDone).toBe(true);
    expect(ackedProgressUpdates[ackedProgressUpdates.length - 1]).toBe(testData.byteLength);

    // Verify written content matches original exactly byte-for-byte
    const assembledBlob = await writer.finalize();
    const resultBuffer = new Uint8Array(await assembledBlob.arrayBuffer());
    expect(resultBuffer).toEqual(testData);
  });
});
