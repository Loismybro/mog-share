// hash.worker.ts (Section 4.5 & 4.7)
// Computes SHA-256 digests of 4 MiB blocks off the main UI thread

self.onmessage = async (e: MessageEvent) => {
  const { transferId, blockIndex, buffer } = e.data;
  try {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const hashHex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    self.postMessage({
      transferId,
      blockIndex,
      hashHex,
      success: true,
    });
  } catch (err: unknown) {
    self.postMessage({
      transferId,
      blockIndex,
      error: (err as Error).message,
      success: false,
    });
  }
};
