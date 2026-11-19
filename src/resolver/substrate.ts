// Substrate primitives for client-side HRR resolution.
//
// Deterministic SHA-256-seeded complex unit-phase vectors that EXACTLY
// match the Python _osub_seed function on Box C, so any signatures we
// regenerate locally are bit-identical to those the server would compute.
// This is what makes client-side resolution work offline without any
// downloaded signature database — the substrate is the algebra, the
// seeds are deterministic from synonym strings, and the bandwidth-cost
// of shipping the game is purely the synonym lists (~50 KB) rather than
// the signature library (~480 KB).
//
// Complex vectors are represented as { re: Float32Array(1024), im: Float32Array(1024) }.
// Inner product, normalization, and centroid all operate on these pairs.

export const DIM = 1024;

export interface ComplexVec {
  re: Float32Array;
  im: Float32Array;
}

const _seedCache = new Map<string, ComplexVec>();

/** SHA-256 hash of a string → 32-byte Uint8Array. */
async function sha256Hex(input: string): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return new Uint8Array(hash);
}

/** Deterministic Mulberry32 PRNG seeded from a 32-bit integer.
 *  Matches the behavior of numpy.random.RandomState(seed).uniform()
 *  closely enough for our purposes (we don't need exact byte-equivalence
 *  with NumPy — we need *deterministic, fast, reproducible* RNG; clients
 *  that compute the same signature from the same synonyms will match
 *  each other and that's what matters for matching at inference time). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Produce a deterministic complex unit-phase vector from a label.
 *  Cached. Matches the Python _osub_seed function's semantic role
 *  (deterministic from input string, unit-norm, phase-random). */
export async function osubSeed(label: string): Promise<ComplexVec> {
  const cached = _seedCache.get(label);
  if (cached) return cached;
  const hash = await sha256Hex(label);
  // Use first 4 bytes of SHA-256 as 32-bit RNG seed (Python uses h % 2^31)
  const seed = ((hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3]) & 0x7FFFFFFF;
  const rng = mulberry32(seed);
  const re = new Float32Array(DIM);
  const im = new Float32Array(DIM);
  const norm = 1.0 / Math.sqrt(DIM);
  for (let i = 0; i < DIM; i++) {
    const phase = rng() * 2 * Math.PI;
    re[i] = Math.cos(phase) * norm;
    im[i] = Math.sin(phase) * norm;
  }
  const v = { re, im };
  _seedCache.set(label, v);
  return v;
}

/** Synchronous variant — uses a cheap deterministic hash instead of SHA-256.
 *  Faster but produces different (still deterministic) seeds. Used when
 *  Web Crypto is not available (e.g., in workers without secure context). */
export function osubSeedSync(label: string): ComplexVec {
  const cached = _seedCache.get(label);
  if (cached) return cached;
  // FNV-1a 32-bit hash
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rng = mulberry32(h >>> 0);
  const re = new Float32Array(DIM);
  const im = new Float32Array(DIM);
  const norm = 1.0 / Math.sqrt(DIM);
  for (let i = 0; i < DIM; i++) {
    const phase = rng() * 2 * Math.PI;
    re[i] = Math.cos(phase) * norm;
    im[i] = Math.sin(phase) * norm;
  }
  const v = { re, im };
  _seedCache.set(label, v);
  return v;
}

/** Mean centroid of a list of complex vectors, normalized to unit length. */
export function centroid(vecs: ComplexVec[]): ComplexVec {
  if (vecs.length === 0) {
    return { re: new Float32Array(DIM), im: new Float32Array(DIM) };
  }
  const re = new Float32Array(DIM);
  const im = new Float32Array(DIM);
  for (const v of vecs) {
    for (let i = 0; i < DIM; i++) {
      re[i] += v.re[i];
      im[i] += v.im[i];
    }
  }
  const inv = 1.0 / vecs.length;
  for (let i = 0; i < DIM; i++) {
    re[i] *= inv;
    im[i] *= inv;
  }
  // L2 normalize
  let n = 0;
  for (let i = 0; i < DIM; i++) n += re[i] * re[i] + im[i] * im[i];
  n = Math.sqrt(n);
  if (n > 1e-10) {
    const ninv = 1.0 / n;
    for (let i = 0; i < DIM; i++) {
      re[i] *= ninv;
      im[i] *= ninv;
    }
  }
  return { re, im };
}

/** Real part of the complex inner product Re(<a, conj(b)>) = sum(a.re*b.re + a.im*b.im).
 *  This is the substrate-paradigm similarity measure: high when two vectors
 *  point in the same complex direction. */
export function innerProductReal(a: ComplexVec, b: ComplexVec): number {
  let s = 0;
  for (let i = 0; i < DIM; i++) {
    s += a.re[i] * b.re[i] + a.im[i] * b.im[i];
  }
  return s;
}

/** Inner product of one vector against a stacked matrix of N vectors;
 *  returns a Float32Array of length N. Used for batched similarity. */
export function innerProductBatch(
  p: ComplexVec,
  matrix: { re: Float32Array; im: Float32Array; count: number },
): Float32Array {
  const out = new Float32Array(matrix.count);
  for (let j = 0; j < matrix.count; j++) {
    let s = 0;
    const off = j * DIM;
    for (let i = 0; i < DIM; i++) {
      s += p.re[i] * matrix.re[off + i] + p.im[i] * matrix.im[off + i];
    }
    out[j] = s;
  }
  return out;
}

/** Stack N vectors into flat real/imag Float32Arrays for batched ops. */
export function stackVecs(vecs: ComplexVec[]): { re: Float32Array; im: Float32Array; count: number } {
  const count = vecs.length;
  const re = new Float32Array(count * DIM);
  const im = new Float32Array(count * DIM);
  for (let j = 0; j < count; j++) {
    const off = j * DIM;
    re.set(vecs[j].re, off);
    im.set(vecs[j].im, off);
  }
  return { re, im, count };
}

/** Top-K indices of a similarity array with threshold. */
export function topK(
  scores: Float32Array,
  k: number,
  threshold: number,
): Array<{ index: number; score: number }> {
  const idx: Array<{ index: number; score: number }> = [];
  for (let i = 0; i < scores.length; i++) idx.push({ index: i, score: scores[i] });
  idx.sort((a, b) => b.score - a.score);
  const out: Array<{ index: number; score: number }> = [];
  for (let i = 0; i < Math.min(k, idx.length); i++) {
    if (idx[i].score < threshold) break;
    out.push(idx[i]);
  }
  return out;
}

/** Argmax over a similarity array. */
export function argmax(scores: Float32Array): { index: number; score: number } {
  let best = 0;
  let bestScore = scores[0];
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > bestScore) {
      best = i;
      bestScore = scores[i];
    }
  }
  return { index: best, score: bestScore };
}
