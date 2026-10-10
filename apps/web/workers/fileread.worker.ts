// fileread.worker.ts (Section 4.5)
// Reads blocks ahead from File off the main UI thread and transfers ArrayBuffers

self.onmessage = async (e: MessageEvent) => {
  const { file, blockIndex, blockSize, chunkSize, transferId } = e.data;
  try {
    const startByte = blockIndex * blockSize;
    const endByte = Math.min(file.size, (blockIndex + 1) * blockSize);
    const slice = file.slice(startByte, endByte);
    const blockBuffer = await slice.arrayBuffer();

    const chunks: ArrayBuffer[] = [];
    const totalBlockBytes = blockBuffer.byteLength;
    const numChunks = Math.ceil(totalBlockBytes / chunkSize);

    for (let c = 0; c < numChunks; c++) {
      const cStart = c * chunkSize;
      const cEnd = Math.min(totalBlockBytes, (c + 1) * chunkSize);
      const chunkBuf = blockBuffer.slice(cStart, cEnd);
      chunks.push(chunkBuf);
    }

    // Post transferable buffers to main thread (zero memory copy)
    (self as any).postMessage(
      {
        transferId,
        blockIndex,
        chunks,
        byteLength: totalBlockBytes,
        isLastBlock: endByte >= file.size,
      },
      chunks
    );
  } catch (err: unknown) {
    self.postMessage({
      transferId,
      blockIndex,
      error: (err as Error).message,
    });
  }
};
