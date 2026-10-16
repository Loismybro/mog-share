export type SoundType =
  | 'devicePaired'
  | 'messageReceived'
  | 'incomingRequest'
  | 'transferStart'
  | 'transferComplete'
  | 'error';

class SoundEffectsManager {
  private enabled: boolean;
  private ctx: AudioContext | null = null;

  constructor() {
    this.enabled =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('mog_sound_enabled') !== 'false'
        : true;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('mog_sound_enabled', enabled ? 'true' : 'false');
      }
    } catch {
      // ignore storage errors
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public play(type: SoundType): void {
    if (!this.enabled) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      switch (type) {
        case 'devicePaired': {
          // Cheerful ascending chime (C5 -> E5 -> G5)
          this.playToneSequence(ctx, [
            { freq: 523.25, start: 0, duration: 0.1, gain: 0.12 },
            { freq: 659.25, start: 0.08, duration: 0.12, gain: 0.14 },
            { freq: 783.99, start: 0.18, duration: 0.25, gain: 0.15 },
          ]);
          break;
        }
        case 'messageReceived': {
          // Subtle soft pop / ping
          this.playToneSequence(ctx, [
            { freq: 880, start: 0, duration: 0.08, gain: 0.1 },
            { freq: 1174.66, start: 0.06, duration: 0.14, gain: 0.12 },
          ]);
          break;
        }
        case 'incomingRequest': {
          // Notification ping
          this.playToneSequence(ctx, [
            { freq: 587.33, start: 0, duration: 0.12, gain: 0.15 },
            { freq: 880.0, start: 0.12, duration: 0.22, gain: 0.18 },
          ]);
          break;
        }
        case 'transferStart': {
          // Ascending transition tone
          this.playToneSequence(ctx, [
            { freq: 440, start: 0, duration: 0.1, gain: 0.1 },
            { freq: 554.37, start: 0.08, duration: 0.12, gain: 0.12 },
            { freq: 659.25, start: 0.16, duration: 0.2, gain: 0.14 },
          ]);
          break;
        }
        case 'transferComplete': {
          // Triumphant chord (C5 -> E5 -> G5 -> C6)
          this.playToneSequence(ctx, [
            { freq: 523.25, start: 0, duration: 0.1, gain: 0.12 },
            { freq: 659.25, start: 0.09, duration: 0.12, gain: 0.14 },
            { freq: 783.99, start: 0.18, duration: 0.12, gain: 0.15 },
            { freq: 1046.5, start: 0.26, duration: 0.35, gain: 0.18 },
          ]);
          break;
        }
        case 'error': {
          // Low descending double buzz
          this.playToneSequence(ctx, [
            { freq: 329.63, start: 0, duration: 0.14, gain: 0.15, type: 'triangle' },
            { freq: 220.0, start: 0.12, duration: 0.25, gain: 0.18, type: 'triangle' },
          ]);
          break;
        }
      }
    } catch {
      // Audio playback errors are non-fatal
    }
  }

  private playToneSequence(
    ctx: AudioContext,
    tones: Array<{
      freq: number;
      start: number;
      duration: number;
      gain: number;
      type?: OscillatorType;
    }>
  ) {
    const baseTime = ctx.currentTime;
    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = tone.type || 'sine';
      osc.frequency.setValueAtTime(tone.freq, baseTime + tone.start);

      const startTime = baseTime + tone.start;
      const endTime = startTime + tone.duration;

      gainNode.gain.setValueAtTime(0.001, startTime);
      gainNode.gain.exponentialRampToValueAtTime(tone.gain, startTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(endTime);
    }
  }
}

export const soundEffects = new SoundEffectsManager();
