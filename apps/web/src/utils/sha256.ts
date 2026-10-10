/**
 * SHA-256 with a pure-JS fallback.
 * crypto.subtle only exists in secure contexts (HTTPS or localhost). When two phones
 * test over plain http://192.168.x.x, crypto.subtle is undefined and every block hash
 * would throw, so the transfer fails. This falls back to a JS implementation.
 */
const K = new Uint32Array(64);
const H0 = new Uint32Array(8);
(() => {
  const primes: number[] = [];
  for (let n = 2; primes.length < 64; n++) {
    if (primes.every((p) => n % p !== 0)) primes.push(n);
  }
  const frac = (x: number) => Math.floor((x - Math.floor(x)) * 4294967296) >>> 0;
  for (let i = 0; i < 64; i++) K[i] = frac(Math.cbrt(primes[i]));
  for (let i = 0; i < 8; i++) H0[i] = frac(Math.sqrt(primes[i]));
})();

export function sha256Js(data: Uint8Array): Uint8Array {
  const len = data.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor((len * 8) / 4294967296), false);
  dv.setUint32(padded.length - 4, (len * 8) >>> 0, false);

  const h = new Uint32Array(H0);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i], false);
  return out;
}

export async function sha256Bytes(data: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const subtle = (globalThis as any).crypto?.subtle as SubtleCrypto | undefined;
  if (subtle) {
    try {
      return new Uint8Array(await subtle.digest('SHA-256', bytes as unknown as BufferSource));
    } catch {
      /* fall through to JS implementation */
    }
  }
  return sha256Js(bytes);
}

export async function sha256Hex(data: Uint8Array | ArrayBuffer): Promise<string> {
  const d = await sha256Bytes(data);
  let s = '';
  for (let i = 0; i < d.length; i++) s += d[i].toString(16).padStart(2, '0');
  return s;
}
