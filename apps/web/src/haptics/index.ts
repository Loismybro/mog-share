import { HAPTIC_RATE_LIMIT_MS } from '@shareapp/shared';

export type HapticEvent =
  | 'tap'
  | 'select'
  | 'deviceFound'
  | 'connected'
  | 'incomingRequest'
  | 'accepted'
  | 'progressMilestone'
  | 'complete'
  | 'warning'
  | 'error'
  | 'cancel';

export type HapticIntensity = 'off' | 'light' | 'normal';

// Exact pattern library from Section 6 (milliseconds, alternating vibrate on and off)
export const HAPTIC_PATTERNS: Record<HapticEvent, number[]> = {
  tap: [10],
  select: [8],
  deviceFound: [12, 30, 12],
  connected: [12, 30, 18],
  incomingRequest: [25, 80, 25, 80, 45],
  accepted: [15, 40, 25],
  progressMilestone: [6],
  complete: [20, 50, 20, 50, 70],
  warning: [35, 60, 35],
  error: [70, 40, 70, 40, 110],
  cancel: [20, 40, 20],
};

class HapticEngine {
  private intensity: HapticIntensity = 'normal';
  private lastPlayedTime = 0;
  private queuedHapticForNextGesture: HapticEvent | null = null;
  private hiddenSwitchLabel: HTMLLabelElement | null = null;

  constructor() {
    this.detectDefaults();
    this.initIosSwitch();
    this.attachGestureListener();
  }

  private detectDefaults() {
    if (typeof window === 'undefined') return;
    // Section 6: Respect prefers-reduced-motion by defaulting to off
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReducedMotion) {
      this.intensity = 'off';
    }
  }

  private initIosSwitch() {
    if (typeof document === 'undefined') return;
    try {
      // Hidden-switch trick for iOS Safari 17.4+ (Section 6)
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIos) {
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:-100px;left:-100px;opacity:0;pointer-events:none;';
        container.innerHTML = `
          <input type="checkbox" id="__haptic_switch" switch style="display:none;" />
          <label for="__haptic_switch" id="__haptic_label"></label>
        `;
        document.body.appendChild(container);
        this.hiddenSwitchLabel = document.getElementById('__haptic_label') as HTMLLabelElement;
      }
    } catch { /* unsupported */ }
  }

  private attachGestureListener() {
    if (typeof window === 'undefined') return;
    const triggerQueued = () => {
      if (this.queuedHapticForNextGesture) {
        const evt = this.queuedHapticForNextGesture;
        this.queuedHapticForNextGesture = null;
        this.play(evt);
      }
    };
    window.addEventListener('pointerdown', triggerQueued, { passive: true });
    window.addEventListener('keydown', triggerQueued, { passive: true });
  }

  public setIntensity(intensity: HapticIntensity) {
    this.intensity = intensity;
  }

  public getIntensity(): HapticIntensity {
    return this.intensity;
  }

  public play(eventName: HapticEvent) {
    if (this.intensity === 'off') return;

    // Never vibrate while page is hidden (Section 6)
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    // Rate-limit to one pattern per 150 ms (Section 6)
    const now = Date.now();
    if (now - this.lastPlayedTime < HAPTIC_RATE_LIMIT_MS) {
      return;
    }
    this.lastPlayedTime = now;

    let pattern = HAPTIC_PATTERNS[eventName];
    if (!pattern) return;

    // Light intensity halves duration
    if (this.intensity === 'light') {
      pattern = pattern.map((ms) => Math.max(1, Math.round(ms / 2)));
    }

    // Engine a: navigator.vibrate (only after user interaction)
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      const hasActivation = (navigator as any).userActivation
        ? Boolean((navigator as any).userActivation.hasBeenActive)
        : false;
      if (hasActivation) {
        try {
          navigator.vibrate(0);
          navigator.vibrate(pattern);
          return;
        } catch {
          /* ignored */
        }
      }
    }

    // Engine b: iOS Safari hidden switch (works during user gesture)
    if (this.hiddenSwitchLabel) {
      try {
        this.hiddenSwitchLabel.click();
        return;
      } catch {
        // If not in a user gesture (e.g. incoming network request), queue for next tap
        this.queuedHapticForNextGesture = eventName;
      }
    }
  }
}

export const haptics = new HapticEngine();
