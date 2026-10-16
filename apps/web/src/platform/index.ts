export interface PlatformLifecycleCallbacks {
  onFlushJournal?: () => Promise<void> | void;
  onProbeChannels?: () => Promise<void> | void;
}

export class PlatformLifecycleManager {
  private wakeLockSentinel: any = null;
  private isTransferActive = false;
  private silentVideo: HTMLVideoElement | null = null;
  private callbacks: PlatformLifecycleCallbacks;

  constructor(callbacks: PlatformLifecycleCallbacks = {}) {
    this.callbacks = callbacks;
    this.setupListeners();
  }

  private setupListeners() {
    if (typeof window === 'undefined') return;

    // Visibility change handling (Section 5 & 3.6)
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        // Re-acquire Wake Lock if transfer is active (Section 5, fixes A20)
        if (this.isTransferActive) {
          await this.acquireWakeLock();
        }
        // Probe connection health when returning to tab
        await this.callbacks.onProbeChannels?.();
      }
    });

    // Pagehide / freeze handling (Section 5, fixes A14, A20)
    window.addEventListener('pagehide', () => {
      void this.callbacks.onFlushJournal?.();
    });

    window.addEventListener('freeze', () => {
      void this.callbacks.onFlushJournal?.();
    });

    window.addEventListener('resume', () => {
      void this.callbacks.onProbeChannels?.();
    });
  }

  public async onTransferStart() {
    this.isTransferActive = true;
    await this.acquireWakeLock();
  }

  public async onTransferEnd() {
    this.isTransferActive = false;
    await this.releaseWakeLock();
  }

  private async acquireWakeLock() {
    // 1. Screen Wake Lock API
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      try {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        this.wakeLockSentinel.addEventListener('release', () => {
          this.wakeLockSentinel = null;
        });
        return;
      } catch { /* unsupported or battery saving mode */ }
    }

    // 2. iOS Safari silent-looping video keep-awake trick (Section 5)
    if (typeof document !== 'undefined' && !this.silentVideo) {
      try {
        const video = document.createElement('video');
        video.setAttribute('playsinline', '');
        video.setAttribute('loop', '');
        video.muted = true;
        // 1x1 blank webm data uri
        video.src = 'data:video/webm;base64,GkXfo0AgQoaBAUL3gQFC8oEEQvOBCEKCQAR3ZWJtQoeBAkKFgQIYUkoAkE33gQI8oEEQvOBCEKCQAR3ZWJtQoeBAkKFgQIYUkoAkE33gQI=';
        video.style.cssText = 'position:fixed;top:-100px;left:-100px;opacity:0;pointer-events:none;';
        document.body.appendChild(video);
        void video.play().catch(() => {});
        this.silentVideo = video;
      } catch { /* fallback ignored */ }
    }
  }

  private async releaseWakeLock() {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch { /* ignore */ }
      this.wakeLockSentinel = null;
    }

    if (this.silentVideo) {
      try {
        this.silentVideo.pause();
        this.silentVideo.remove();
      } catch { /* ignore */ }
      this.silentVideo = null;
    }
  }

  public shouldShowMobileWarningBanner(customUserAgent?: string): boolean {
    const ua = customUserAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : '');
    const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
    return isMobile && this.isTransferActive;
  }
}
