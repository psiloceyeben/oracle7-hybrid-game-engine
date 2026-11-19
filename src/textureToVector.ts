// textureToVector.ts — encode a wrapped, multifaceted surface texture into an
// HRR vector in the SAME substrate space as the Oracle (§7c of
// WANDER_CANONICAL_SPEC.md). The returned vector IS the item's parameter set:
// `texture -> parameters`, the inverse of the old `params -> texture` path.
//
// Deterministic from the pixels in, so the same texture always embeds to the
// same vector. Runs once at item creation (the result is cached in opTree
// params), never per frame.
//
// "Multifaceted" = the texture is decomposed into a small set of named FACETS
// (hue, luminance, variance, colour bucket, edge density); each facet is bound
// (role ⊛ value) and the facets are bundled. Quantizing to labels (not raw
// floats) is what lets visually-similar textures resonate: same bucket -> same
// osub-seed -> high similarity. The facet table is exported + tunable.

import { ComplexVec, DIM, osubSeedSync, centroid } from "./resolver/substrate.js";
import { circularConv } from "./resolver/relational.js";

export interface Facet { name: string; value: string; weight: number; }

/** The facets read off a wrapped texture. Tune here to change how finely items
 *  are distinguished (too few -> all items collapse together; too many -> every
 *  item is unique and nothing resonates). DEFAULT pending user confirm (§7c #2). */
export const TEXTURE_FACETS = ["hue", "luminance", "lumaVariance", "colorBucket", "edgeDensity", "materialKind"] as const;

/** Extra context the caller (which has the op-tree) can fold in beyond the
 *  pixels — currently the material kind, so same-material items resonate
 *  strongly regardless of colour (user choice, §7c facet #3). */
export interface TextureContext { kind?: string; fallbackLabel?: string; }

const SAMPLE = 16; // downsample grid (16x16 = 256 px): cheap + stable

/** Pull a 16x16 RGBA sample from a canvas / THREE texture / image. Returns null
 *  if pixels are unreadable (e.g. a tainted cross-origin canvas). */
function samplePixels(src: any): Uint8ClampedArray | null {
  try {
    const img: any =
      (src && src.image) ? src.image :
      (src && src.source && src.source.data) ? src.source.data :
      src;
    if (!img) return null;
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = SAMPLE; c.height = SAMPLE;
    const ctx = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
    return ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
  } catch { return null; }
}

/** 0..11 hue bucket (30° each); 12 = achromatic. */
function rgbToHueBucket(r: number, g: number, b: number): number {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 1e-6) return 12;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return Math.floor(h / 30);
}

/** Reduce raw pixels to the weighted, quantized facets. */
function pixelsToFacets(px: Uint8ClampedArray): Facet[] {
  const n = px.length / 4;
  let rS = 0, gS = 0, bS = 0, lS = 0, lSq = 0, edges = 0, prevL = -1;
  for (let i = 0; i < n; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    rS += r; gS += g; bS += b;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    lS += l; lSq += l * l;
    if (prevL >= 0 && Math.abs(l - prevL) > 28) edges++;
    prevL = l;
  }
  const rM = rS / n, gM = gS / n, bM = bS / n, lM = lS / n;
  const lVar = Math.max(0, lSq / n - lM * lM);
  const hue = rgbToHueBucket(rM, gM, bM);
  const lumBand = Math.min(7, Math.floor(lM / 32));
  const varBand = Math.min(4, Math.floor(Math.sqrt(lVar) / 16));
  const colorBucket = `${Math.floor(rM / 64)}_${Math.floor(gM / 64)}_${Math.floor(bM / 64)}`;
  const edgeBand = Math.min(4, Math.floor((edges / n) * 10));
  return [
    { name: "hue", value: "h" + hue, weight: 1.0 },
    { name: "luminance", value: "l" + lumBand, weight: 0.8 },
    { name: "lumaVariance", value: "v" + varBand, weight: 0.6 },
    { name: "colorBucket", value: "c" + colorBucket, weight: 0.9 },
    { name: "edgeDensity", value: "e" + edgeBand, weight: 0.5 },
  ];
}

const _facetRefCache = new Map<string, ComplexVec>();
/** Reference vector for a facet (role ⊛ value), unweighted + cached. Exported so
 *  the readout (vectorToParams) can recover which facets a vector contains by
 *  comparing against these references. Do NOT mutate the returned vector. */
export function facetRef(name: string, value: string): ComplexVec {
  const k = name + "" + value;
  let v = _facetRefCache.get(k);
  if (!v) {
    v = circularConv(osubSeedSync("facet:" + name), osubSeedSync("facetval:" + name + ":" + value));
    _facetRefCache.set(k, v);
  }
  return v;
}

/** Bind one facet, scaled by its weight (pre-bundle). Copies before scaling so
 *  the cached facetRef is never mutated. */
function bindFacet(f: Facet): ComplexVec {
  const ref = facetRef(f.name, f.value);
  if (f.weight === 1) return ref;  // centroid() reads without mutating — safe
  const re = new Float32Array(DIM), im = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) { re[i] = ref.re[i] * f.weight; im[i] = ref.im[i] * f.weight; }
  return { re, im };
}

/**
 * Encode a wrapped texture into its HRR embedding (= the item's params).
 * If the pixels are unreadable, falls back to a deterministic seed from
 * `fallbackLabel` so the item still gets a stable, in-space vector.
 */
export function textureToVector(src: any, ctx: TextureContext = {}): ComplexVec {
  const px = samplePixels(src);
  const facets: Facet[] = px ? pixelsToFacets(px) : [];
  // material-kind facet (user choice): same kind -> strong resonance, any colour.
  if (ctx.kind) facets.push({ name: "materialKind", value: "k:" + ctx.kind, weight: 1.2 });
  if (facets.length === 0) return osubSeedSync(ctx.fallbackLabel || "texture:unknown");
  // Untextured (no pixels): fold a small instance facet so same-kind items aren't
  // bit-identical (which would make react a no-op + combine degenerate).
  if (!px && ctx.fallbackLabel) facets.push({ name: "instance", value: ctx.fallbackLabel, weight: 0.3 });
  return centroid(facets.map(bindFacet));
}
