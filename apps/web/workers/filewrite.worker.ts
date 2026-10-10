// filewrite.worker.ts (Section 4.6)
// Writes received file blocks off the main UI thread with zero memory leaks

let activeSyncHandle: any = null;

self.onmessage = async (e: MessageEvent) => {
  const { action, transferId, blockIndex, blockSize, buffer, opfsFileName } = e.data;

  try {
    if (action === 'init-opfs') {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(opfsFileName, { create: true });
      // Create fast synchronous access handle in worker
      if (typeof (fileHandle as any).createSyncAccessHandle === 'function') {
        activeSyncHandle = await (fileHandle as any).createSyncAccessHandle();
      }
      self.postMessage({ action: 'init-opfs', success: true });
      return;
    }

    if (action === 'write-block') {
      const offset = blockIndex * blockSize;
      const u8 = new Uint8Array(buffer);

      if (activeSyncHandle) {
        // Fast random access write at block offset (Section 4.6)
        activeSyncHandle.write(u8, { at: offset });
        if (typeof activeSyncHandle.flush === 'function') {
          activeSyncHandle.flush();
        }
      }

      self.postMessage({
        action: 'write-block',
        transferId,
        blockIndex,
        bytesWritten: u8.byteLength,
        success: true,
      });
      return;
    }

    if (action === 'close') {
      if (activeSyncHandle) {
        try { activeSyncHandle.close(); } catch {}
        activeSyncHandle = null;
      }
      self.postMessage({ action: 'close', success: true });
      return;
    }
  } catch (err: unknown) {
    self.postMessage({
      action,
      transferId,
      blockIndex,
      error: (err as Error).message,
      success: false,
    });
  }
};
