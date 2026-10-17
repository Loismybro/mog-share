import * as React from 'react';
import { useEffect, useRef } from 'react';

const MAX_DPR = 2;
const MONO_FONT = '"JetBrains Mono", "Fira Code", monospace';
const DISPLAY_FONT = '"Space Grotesk", "Plus Jakarta Sans", system-ui, sans-serif';
const CHARS = '01X>$#+-•:*=@%';

interface Pt {
  x: number; // normalized -0.5 .. 0.5
  y: number; // normalized -0.5 .. 0.5
  edge: boolean;
}

export interface MorphingGlyphCloudProps {
  phrases?: string[];
  baseColor?: string;
  accentColor?: string;
  background?: string;
  autoMorphMs?: number;
  className?: string;
  style?: React.CSSProperties;
}

const DEFAULT_PHRASES = ['MOGSHARE', 'ZERO DATA', 'DIRECT P2P', 'ENCRYPTED'];

function samplePhrasePoints(text: string): Pt[] {
  if (typeof document === 'undefined') return [];
  const W = 720;
  const H = 160;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Fit bold text cleanly across the wide banner
  let fontSize = 112;
  ctx.font = `800 ${fontSize}px ${DISPLAY_FONT}`;
  const measured = ctx.measureText(text).width;
  const maxW = W * 0.88;
  if (measured > maxW && measured > 0) {
    fontSize = Math.max(42, Math.floor((fontSize * maxW) / measured));
    ctx.font = `800 ${fontSize}px ${DISPLAY_FONT}`;
  }

  ctx.fillText(text, W / 2, H / 2);

  const img = ctx.getImageData(0, 0, W, H).data;
  const isFilled = (x: number, y: number): boolean => {
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    return img[(y * W + x) * 4 + 3] > 110;
  };

  // Find bounding box to normalize tightly
  let minX = W;
  let maxX = 0;
  let minY = H;
  let maxY = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (isFilled(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX <= minX || maxY <= minY) return [];

  const points: Pt[] = [];
  // Crisp uniform grid step so letterforms are unmistakable and legible
  const stepX = 6;
  const stepY = 6;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  for (let y = minY; y <= maxY; y += stepY) {
    for (let x = minX; x <= maxX; x += stepX) {
      if (!isFilled(x, y)) continue;
      const edge =
        !isFilled(x - stepX, y) ||
        !isFilled(x + stepX, y) ||
        !isFilled(x, y - stepY) ||
        !isFilled(x, y + stepY);
      points.push({
        x: (x - cx) / W,
        y: (y - cy) / H,
        edge,
      });
    }
  }

  // Sort left-to-right then top-to-bottom for smooth coherent morphing
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  return points;
}

export default function MorphingGlyphCloud({
  phrases = DEFAULT_PHRASES,
  baseColor = '#F8FAFC',
  accentColor = '#38BDF8',
  background = 'transparent',
  autoMorphMs = 3600,
  className,
  style,
}: MorphingGlyphCloudProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ptrRef = useRef({ active: false, x: -9999, y: -9999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const validPhrases = phrases.length > 0 ? phrases : DEFAULT_PHRASES;
    // Pre-compute point clouds once so morphing never stalls the main thread
    const clouds: Pt[][] = validPhrases.map((p) => samplePhrasePoints(p));
    const maxCount = Math.max(1, ...clouds.map((c) => c.length));

    if (maxCount <= 1) return;

    // Normalize all clouds to equal length `maxCount`
    const normalizedClouds: Pt[][] = clouds.map((cloud) => {
      if (cloud.length === 0) {
        return Array.from({ length: maxCount }, () => ({ x: 0, y: 0, edge: false }));
      }
      const out: Pt[] = new Array(maxCount);
      for (let i = 0; i < maxCount; i++) {
        const srcIdx = Math.floor((i * cloud.length) / maxCount);
        out[i] = cloud[srcIdx];
      }
      return out;
    });

    // Particle state
    const particles = Array.from({ length: maxCount }, (_, i) => ({
      char: CHARS[i % CHARS.length],
      phase: (i * 1.37) % (Math.PI * 2),
      vx: 0,
      vy: 0,
      dx: 0,
      dy: 0,
    }));

    let currentIdx = 0;
    let nextIdx = 1 % normalizedClouds.length;
    let morphProgress = 1; // 1 = settled on currentIdx
    let lastSwitchTime = performance.now();
    let rafId = 0;
    let lastTime = performance.now();

    const triggerNextPhrase = (now: number) => {
      if (normalizedClouds.length <= 1) return;
      currentIdx = nextIdx;
      nextIdx = (currentIdx + 1) % normalizedClouds.length;
      morphProgress = 0;
      lastSwitchTime = now;
    };

    // Start settled on phrase 0, then morph every autoMorphMs
    currentIdx = 0;
    nextIdx = 0;
    morphProgress = 1;

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (autoMorphMs > 0 && now - lastSwitchTime >= autoMorphMs) {
        currentIdx = nextIdx;
        nextIdx = (currentIdx + 1) % normalizedClouds.length;
        morphProgress = 0;
        lastSwitchTime = now;
      }

      if (morphProgress < 1) {
        morphProgress = Math.min(1, morphProgress + dt * 1.85);
      }

      // Smooth cubic ease-in-out
      const t =
        morphProgress < 0.5
          ? 4 * morphProgress * morphProgress * morphProgress
          : 1 - Math.pow(-2 * morphProgress + 2, 3) / 2;

      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const cw = canvas.clientWidth || 640;
      const ch = canvas.clientHeight || 110;
      const bw = Math.max(1, Math.round(cw * dpr));
      const bh = Math.max(1, Math.round(ch * dpr));

      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      const cloudA = normalizedClouds[currentIdx];
      const cloudB = normalizedClouds[nextIdx];

      const scaleX = Math.min(cw * 0.94, ch * 4.5);
      const scaleY = Math.min(ch * 0.88, scaleX * 0.24);
      const centerX = cw / 2;
      const centerY = ch / 2;

      const glyphPx = Math.max(7, Math.min(11, Math.round(scaleX * 0.0155)));
      ctx.font = `700 ${glyphPx}px ${MONO_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const ptr = ptrRef.current;
      const repelRadius = 68;
      const repelRadiusSq = repelRadius * repelRadius;
      const transitScatter = 4 * t * (1 - t); // peaks at 1.0 mid-morph

      // Draw interior glyphs first, then edge glyphs for crisp contrast
      for (let pass = 0; pass < 2; pass++) {
        const isEdgePass = pass === 1;
        ctx.fillStyle = isEdgePass ? accentColor : baseColor;
        ctx.globalAlpha = isEdgePass ? 0.96 : 0.92;

        for (let i = 0; i < maxCount; i++) {
          const pA = cloudA[i];
          const pB = cloudB[i];
          const isEdge = t < 0.5 ? pA.edge : pB.edge;
          if (isEdge !== isEdgePass) continue;

          const pt = particles[i];
          const baseX = centerX + (pA.x + (pB.x - pA.x) * t) * scaleX;
          const baseY = centerY + (pA.y + (pB.y - pA.y) * t) * scaleY;

          // Subtle wave during morph transition only
          const waveY =
            transitScatter * Math.sin(pt.phase + t * Math.PI * 2) * (scaleY * 0.16);

          // Cursor repulsion spring
          if (ptr.active) {
            const rx = baseX - ptr.x;
            const ry = baseY - ptr.y;
            const dSq = rx * rx + ry * ry;
            if (dSq < repelRadiusSq && dSq > 0.01) {
              const d = Math.sqrt(dSq);
              const force = (1 - d / repelRadius) * 18;
              pt.vx += (rx / d) * force;
              pt.vy += (ry / d) * force;
            }
          }

          // Spring back to 0 offset
          pt.vx = (pt.vx - pt.dx * 0.22) * 0.78;
          pt.vy = (pt.vy - pt.dy * 0.22) * 0.78;
          pt.dx += pt.vx;
          pt.dy += pt.vy;

          const drawX = baseX + pt.dx;
          const drawY = baseY + waveY + pt.dy;

          ctx.fillText(pt.char, drawX, drawY);
        }
      }

      ctx.globalAlpha = 1;
      rafId = requestAnimationFrame(render);
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      ptrRef.current.x = e.clientX - rect.left;
      ptrRef.current.y = e.clientY - rect.top;
      ptrRef.current.active = true;
    };

    const onPointerLeave = () => {
      ptrRef.current.active = false;
    };

    const onPointerDown = () => {
      triggerNextPhrase(performance.now());
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerdown', onPointerDown);
    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phrases, baseColor, accentColor, autoMorphMs]);

  return (
    <div
      className={className}
      title="Click or hover to morph"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background,
        cursor: 'pointer',
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
    </div>
  );
}
