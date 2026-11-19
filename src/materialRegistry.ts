import { materialCanvasColor } from "./materialCanvasColor.js";
import { CATALOGUE_MATERIAL_PALETTE } from './catalogueMaterialPalette.js';
// v7.0.0 — Material registry.
//
// Single source of truth for material resolution. The BuildRecipe projector
// calls resolveMaterial({ base, style, tint, ao }) and gets back a properly
// configured Three.js Material that respects the WANDER_TOON_PHYSICAL
// aesthetic register.
//
// Aesthetic synthesis:
//   Toy Story plastic-shell  → toon shading + soft AO baked into vertex colors
//                              + subtle environment specular on smooth surfaces
//   TFT silhouette emphasis  → strong color zones, no gradient shading
//   Looney Tunes outlines    → handled by the depth-edge post-process shader
//   Stick War readability    → palette saturation +12-18%, warm against cool
//
// Procedural texture generation: where useful (wood grain, stone speckle,
// brick mortar), we generate a tiny CanvasTexture procedurally at first use,
// cache it, and reuse. Atlas-friendly sizes (128×128 max) so VR perf stays
// healthy.

import * as THREE from "three";
import type { MaterialSpec } from "./buildRecipe.js";
import { facetRef } from "./textureToVector.js";
import { innerProductReal } from "./resolver/substrate.js";
import type { ComplexVec } from "./resolver/substrate.js";
import { applyClayShaderPatch } from "./clayShaderPatch.js";   // wax-fresnel rim (2026-07-09)

// ── Base material palette ───────────────────────────────────────────────

interface PaletteEntry {
  color: number;
  roughness: number;
  metalness: number;
  /** If true, use MeshToonMaterial; false → MeshStandardMaterial (metals/glass). */
  toon: boolean;
  /** If true, gets a procedural texture overlay. */
  procedural?: "wood" | "stone" | "brick" | "marble" | "metal_brushed" | "fabric" | "leather" | "plaster";
}

const PALETTE: Record<string, PaletteEntry> = {
  ...CATALOGUE_MATERIAL_PALETTE,
  marble:     { color: 0xefe8cc, roughness: 0.30, metalness: 0.00, toon: true,  procedural: "marble" },
  concrete:   { color: 0xa6a298, roughness: 0.85, metalness: 0.05, toon: true,  procedural: "stone" },
  wood:       { color: 0x8a5a32, roughness: 0.70, metalness: 0.00, toon: true,  procedural: "wood" },
  brick:      { color: 0xb86346, roughness: 0.80, metalness: 0.00, toon: true,  procedural: "brick" },
  stone:      { color: 0x968d7c, roughness: 0.75, metalness: 0.00, toon: true,  procedural: "stone" },
  bark:       { color: 0x836250, roughness: 0.92, metalness: 0.00, toon: true,  procedural: "wood" },
  cloth:      { color: 0xc4b294, roughness: 0.95, metalness: 0.00, toon: true,  procedural: "fabric" },
  leather:    { color: 0x7a4a28, roughness: 0.78, metalness: 0.00, toon: true,  procedural: "leather" },
  fur:        { color: 0xa68868, roughness: 0.98, metalness: 0.00, toon: true,  procedural: "fabric" },
  skin:       { color: 0xe6c4a0, roughness: 0.65, metalness: 0.00, toon: true },
  grass:      { color: 0x96bc84, roughness: 0.92, metalness: 0.00, toon: true },
  crystal:    { color: 0xb8d8e8, roughness: 0.20, metalness: 0.10, toon: true },
  plaster:    { color: 0xeae0c8, roughness: 0.88, metalness: 0.00, toon: true, procedural: "plaster" },
  rune_glow:  { color: 0xc8e6ff, roughness: 0.10, metalness: 0.00, toon: true },
  glass:      { color: 0xc8e6f0, roughness: 0.05, metalness: 0.00, toon: false },
  steel:      { color: 0xb6b9be, roughness: 0.30, metalness: 0.90, toon: false, procedural: "metal_brushed" },
  gold:       { color: 0xe2bc6a, roughness: 0.25, metalness: 0.95, toon: false },
  copper:     { color: 0xd28858, roughness: 0.45, metalness: 0.85, toon: false },
  water:      { color: 0x6a9ec4, roughness: 0.10, metalness: 0.00, toon: false },
  _default:   { color: 0xc6b294, roughness: 0.60, metalness: 0.05, toon: true },
};

const STYLE_TINT: Record<string, { darken: number; rough_add: number }> = {
  weathered:   { darken: 0.85, rough_add: 0.10 },
  ruined:      { darken: 0.70, rough_add: 0.20 },
  half_ruined: { darken: 0.78, rough_add: 0.15 },
  overgrown:   { darken: 0.80, rough_add: 0.05 },
  abandoned:   { darken: 0.85, rough_add: 0.10 },
  pristine:    { darken: 1.00, rough_add: -0.05 },
  polished:    { darken: 1.05, rough_add: -0.15 },
  painted_red:   { darken: 1.0, rough_add: 0 },
  painted_blue:  { darken: 1.0, rough_add: 0 },
  painted_green: { darken: 1.0, rough_add: 0 },
};

// Override the base color for painted_* styles
const STYLE_COLOR_OVERRIDE: Record<string, number> = {
  painted_red:   0xc04830,
  painted_blue:  0x3a6ec4,
  painted_green: 0x4aa650,
};

// ── Shared toon gradient ramp ───────────────────────────────────────────
let _toonGradient: THREE.DataTexture | null = null;
function getToonGradient(): THREE.DataTexture {
  if (_toonGradient) return _toonGradient;
  // 4-band ramp: shadow / midshadow / lit / hot.
  // Shadows lifted (was 56) + bands compressed toward the light end → soft,
  // low-contrast PASTEL shading instead of near-black shaded sides.
  const data = new Uint8Array([122,122,122,255, 176,176,176,255, 220,220,220,255, 255,255,255,255]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _toonGradient = tex;
  return tex;
}

// ── Procedural textures ────────────────────────────────────────────────
const _procCache = new Map<string, THREE.CanvasTexture>();

// Deterministic seeded RNG so the SAME kind+colour always yields the SAME
// texture (and therefore the SAME HRR embedding) across cold loads. The
// texture-as-params mechanic (§7c) needs reproducible textures, not Math.random.
function _texHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function _mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _getProceduralTexture(kind: string, color: number): THREE.CanvasTexture {
  const cacheKey = `${kind}:${color.toString(16)}`;
  const cached = _procCache.get(cacheKey);
  if (cached) return cached;
  const rand = _mulberry32(_texHash(cacheKey));  // deterministic per kind:colour

  const SIZE = 128;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const base = new THREE.Color(color);
  const baseStr = materialCanvasColor(base);
  ctx.fillStyle = baseStr;
  ctx.fillRect(0, 0, SIZE, SIZE);

  if (kind === "wood") {
    // Quiet continuous grain, not large dark dots repeated on every cabinet.
    // Matching end heights/tangents keep the shared tile continuous in X.
    // Neutral detail maps still multiply the authored material tint only once.
    for (let i = 0; i < 24; i++) {
      const y = 3 + i * 5 + rand() * .7;
      const bend = (rand() - .5) * 1.8;
      const grain = new THREE.Color(color).multiplyScalar(.85 + rand() * .10);
      ctx.strokeStyle = materialCanvasColor(grain, .35);
      ctx.lineWidth = .45 + rand() * .35;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(SIZE / 4, y + bend, SIZE * 3 / 4, y - bend, SIZE, y);
      ctx.stroke();
    }
  } else if (kind === "plaster") {
    // Fine, low-contrast chalk grain; stone-sized dark spots read as dirt on
    // clean apartment partitions. Retain the authored warm wall palette.
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = materialCanvasColor(new THREE.Color(color).multiplyScalar(.94 + rand() * .04), .3);
      ctx.fillRect(rand() * SIZE, rand() * SIZE, .5 + rand() * .5, .5 + rand() * .5);
    }
  } else if (kind === "stone" || kind === "marble") {
    // Speckle (stone) or veining (marble)
    for (let i = 0; i < (kind === "marble" ? 8 : 200); i++) {
      const v = kind === "marble" ? 0.85 : 0.7 + rand() * 0.2;
      const c = new THREE.Color(color).multiplyScalar(v);
      ctx.fillStyle = materialCanvasColor(c,kind === "marble" ? 0.45 : 0.5);
      if (kind === "marble") {
        // Veining: thin curved lines
        ctx.beginPath();
        ctx.moveTo(rand() * SIZE, rand() * SIZE);
        ctx.bezierCurveTo(rand() * SIZE, rand() * SIZE,
                          rand() * SIZE, rand() * SIZE,
                          rand() * SIZE, rand() * SIZE);
        ctx.lineWidth = 1 + rand() * 1.5;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(rand() * SIZE, rand() * SIZE, 1 + rand() * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (kind === "brick") {
    // Brick pattern with mortar
    const ROW_H = 16, COL_W = 32;
    for (let row = 0; row < SIZE / ROW_H; row++) {
      const offset = (row % 2) * (COL_W / 2);
      for (let col = -1; col < SIZE / COL_W + 1; col++) {
        const x = col * COL_W + offset;
        const y = row * ROW_H;
        const variance = 0.8 + rand() * 0.25;
        const c = new THREE.Color(color).multiplyScalar(variance);
        ctx.fillStyle = materialCanvasColor(c);
        ctx.fillRect(x + 1, y + 1, COL_W - 2, ROW_H - 2);
      }
    }
  } else if (kind === "metal_brushed") {
    // Horizontal brush lines
    for (let y = 0; y < SIZE; y += 1) {
      const v = 0.92 + rand() * 0.16;
      const c = new THREE.Color(color).multiplyScalar(v);
      ctx.fillStyle = materialCanvasColor(c,0.35);
      ctx.fillRect(0, y, SIZE, 1);
    }
  } else if (kind === "fabric") {
    // Subtle weave pattern
    for (let y = 0; y < SIZE; y += 4) {
      for (let x = 0; x < SIZE; x += 4) {
        const dark = (x + y) % 8 === 0;
        const v = dark ? 0.92 : 1.02;
        const c = new THREE.Color(color).multiplyScalar(v);
        ctx.fillStyle = materialCanvasColor(c,0.5);
        ctx.fillRect(x, y, 4, 4);
      }
    }
  } else if (kind === "leather") {
    // Pebbled texture
    for (let i = 0; i < 400; i++) {
      const v = 0.85 + rand() * 0.25;
      const c = new THREE.Color(color).multiplyScalar(v);
      ctx.fillStyle = materialCanvasColor(c,0.4);
      ctx.beginPath();
      ctx.arc(rand() * SIZE, rand() * SIZE, 0.8 + rand() * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  _procCache.set(cacheKey, tex);
  return tex;
}

// ── Soft-clay restyle ──────────────────────────────────────────────────────
/** Shared neutral detail for authored/tintable op-tree materials. White is
 * intentional: the material's color remains authoritative, so repainting does
 * not multiply a new tint by an old baked wood/stone color. At most one128px
 * texture per reviewed pattern, never one texture per spawned object/color.
 * Headless geometry workers omit presentation-only maps. */
export function getMaterialDetailMap(base: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const aliases: Record<string,string> = {cotton:'cloth',linen:'cloth',wool:'cloth',silk:'cloth'};
  const entry = PALETTE[aliases[base] || base];
  return entry?.procedural ? _getProceduralTexture(entry.procedural, 0xffffff) : null;
}

// ── Soft-clay restyle ──────────────────────────────────────────────────────
// 2026-07-08 — Ben's chosen art direction. When true, surfaces that used the
// banded MeshToonMaterial render instead as matte, smooth-shaded CLAY:
// MeshStandardMaterial at high roughness, zero metal, gentle image-based fill.
// One reversible switch for the whole game — flip to false to restore toon.
export const CLAY_MODE = true;
const CLAY_ROUGHNESS_FLOOR = 0.9;   // matte, hand-pressed
const CLAY_ENV_INTENSITY = 0.5;     // soft IBL fill (needs scene.environment)

// ── Clay deepening (2026-07-09) ─────────────────────────────────────────────
// Two subtle upgrades that kill the "one flat plastic" read and add the literal
// handmade tell. Both are shared/cached so the 443 clay meshes don't pay per-
// material allocation cost, and both are BEHIND CLAY_MODE only.
//
//   1. Per-material roughness jitter (±CLAY_ROUGH_JITTER around the clay base,
//      clamped to [CLAY_ROUGH_MIN, CLAY_ROUGH_MAX]). Deterministic hash of the
//      material colour so it's stable across frames and cold loads — no flicker,
//      no reflection swim. Just enough variance that no two clay surfaces share
//      the exact same matte response, which is what read as plastic.
//   2. A single shared thumbprint / thumb-drag micro-normal map (soft dimples +
//      faint drag undulations), attached at a VERY low normalScale so it reads
//      as hand-pressed clay, not orange-peel.
const CLAY_ROUGH_JITTER = 0.06;   // ± around the clay base roughness
const CLAY_ROUGH_MIN = 0.82;
const CLAY_ROUGH_MAX = 0.98;
// normalScale + repeat are conservative starting points — TUNE ON A REAL GPU
// (the Box C swiftshader probe can't judge normal-map amplitude). If it reads
// as orange-peel, drop normalScale toward 0.08; if invisible, push toward 0.22.
const CLAY_NORMAL_SCALE = 0.15;
const CLAY_NORMAL_REPEAT = 3;     // looks right on both large walls & small primitives

/**
 * Deterministic per-material clay roughness. Hashes a stable seed (the material
 * colour hex) into a ±CLAY_ROUGH_JITTER offset around `baseRough`, clamped to
 * [CLAY_ROUGH_MIN, CLAY_ROUGH_MAX]. Stable across frames/reloads (same colour →
 * same roughness), so there's no shimmer. Reuses the proc-texture hash idiom.
 */
export function clayRoughness(baseRough: number, seed: number | string): number {
  const s = typeof seed === "number" ? seed.toString(16) : seed;
  // mulberry32(hash) → [0,1); centre to [-1,1) → scale to ±CLAY_ROUGH_JITTER.
  const r = _mulberry32(_texHash("clayrough:" + s))();
  const jittered = baseRough + (r * 2 - 1) * CLAY_ROUGH_JITTER;
  return Math.max(CLAY_ROUGH_MIN, Math.min(CLAY_ROUGH_MAX, jittered));
}

/** Retain authored material differences inside a soft, non-mirror clay range.
 * Unlike character clay, architectural materials should not all hit .9 roughness.
 */
export function stylizedSurfaceRoughness(base: number, seed: number | string): number {
  const finite = Number.isFinite(base) ? base : .8;
  const response = .48 + Math.max(0, Math.min(1, finite)) * .48;
  const variation = clayRoughness(.9, seed) - .9;
  return Math.max(.5, Math.min(.98, response + variation * .3));
}

// Shared thumbprint micro-normal. One CanvasTexture for the whole game; every
// clay factory attaches this same instance as `.normalMap`.
let _clayNormalMap: THREE.CanvasTexture | null = null;

function _buildClayNormalCanvas(): HTMLCanvasElement {
  const SIZE = 128;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SIZE, SIZE);
  const data = img.data;

  // Build a soft height field = a few octaves of smooth value noise (broad
  // undulations = the thumb-drag) plus scattered rounded dimples (thumbprints),
  // then convert to a tangent-space normal map via finite-difference slopes.
  const rand = _mulberry32(_texHash("clay-normal-height"));

  // -- broad undulation field (bilinear-interpolated coarse lattice) --
  const L = 8;                         // coarse lattice cells
  const lattice = new Float32Array((L + 1) * (L + 1));
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const smooth = (t: number) => t * t * (3 - 2 * t);   // smoothstep
  const undulation = (x: number, y: number): number => {
    const gx = (x / SIZE) * L, gy = (y / SIZE) * L;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = smooth(gx - x0), fy = smooth(gy - y0);
    const idx = (xx: number, yy: number) => lattice[(yy % (L + 1)) * (L + 1) + (xx % (L + 1))];
    const a = idx(x0, y0), b = idx(x0 + 1, y0), c = idx(x0, y0 + 1), d = idx(x0 + 1, y0 + 1);
    const top = a + (b - a) * fx, bot = c + (d - c) * fx;
    return top + (bot - top) * fy;   // [0,1]
  };

  // -- scattered soft dimples (thumbprints), radial cosine falloff --
  const DIMPLES = 26;
  const dimples: Array<{ x: number; y: number; r: number; depth: number }> = [];
  for (let i = 0; i < DIMPLES; i++) {
    dimples.push({
      x: rand() * SIZE,
      y: rand() * SIZE,
      r: 8 + rand() * 14,
      depth: (rand() * 2 - 1) * 0.5,   // some pressed in, some pushed out
    });
  }
  const heightAt = (x: number, y: number): number => {
    // wrap so the tile is seamless under RepeatWrapping
    let h = (undulation(x, y) - 0.5) * 0.55;   // broad, low amplitude
    for (const d of dimples) {
      // nearest wrapped delta on each axis
      let dx = x - d.x; if (dx > SIZE / 2) dx -= SIZE; if (dx < -SIZE / 2) dx += SIZE;
      let dy = y - d.y; if (dy > SIZE / 2) dy -= SIZE; if (dy < -SIZE / 2) dy += SIZE;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < d.r) {
        const f = 0.5 * (1 + Math.cos((dist / d.r) * Math.PI));   // 1 centre → 0 edge
        h += d.depth * f;
      }
    }
    return h;
  };

  // -- finite-difference → tangent-space normal (RGB), wrapped sampling --
  const STRENGTH = 1.6;   // slope gain baked into the map; final look ridden by normalScale
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const xl = (x - 1 + SIZE) % SIZE, xr = (x + 1) % SIZE;
      const yu = (y - 1 + SIZE) % SIZE, yd = (y + 1) % SIZE;
      const dhdx = (heightAt(xr, y) - heightAt(xl, y)) * STRENGTH;
      const dhdy = (heightAt(x, yd) - heightAt(x, yu)) * STRENGTH;
      // normal = normalize(-dhdx, -dhdy, 1)
      let nx = -dhdx, ny = -dhdy, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv; nz *= inv;
      const o = (y * SIZE + x) * 4;
      data[o]     = Math.round((nx * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Shared thumbprint / thumb-drag micro-normal map for clay surfaces. Generated
 * once, cached, reused by every clay material factory (registry, generators,
 * player, animals). Linear colour space (it's a normal map, NOT colour) and
 * RepeatWrapping so it tiles across large walls and small primitives alike.
 */
export function getClayNormalMap(): THREE.CanvasTexture | null {
  if (_clayNormalMap) return _clayNormalMap;
  // Headless certification and server-side projection do not provide a DOM.
  // The normal map is presentation-only, so omit it rather than making valid
  // catalogue op-trees impossible to materialise outside a browser.
  if (typeof document === "undefined") return null;
  const tex = new THREE.CanvasTexture(_buildClayNormalCanvas());
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(CLAY_NORMAL_REPEAT, CLAY_NORMAL_REPEAT);
  tex.colorSpace = THREE.NoColorSpace;   // normal data is linear, not sRGB
  tex.needsUpdate = true;
  _clayNormalMap = tex;
  return tex;
}

/** The shared clay normalScale (Vector2). VERY subtle — TUNE ON REAL GPU. */
export function clayNormalScale(): THREE.Vector2 {
  return new THREE.Vector2(CLAY_NORMAL_SCALE, CLAY_NORMAL_SCALE);
}

/**
 * One-stop clay surface tweaks for a MeshStandardMaterial params object: sets a
 * jittered roughness (seeded by colour), attaches the shared thumbprint normal
 * map + its subtle normalScale, and forces metalness 0. Use in every CLAY_MODE
 * MeshStandardMaterial factory so all clay shares the same recipe + texture.
 */
export function applyClaySurface(params: any, baseRough: number, colorHex: number): void {
  params.roughness = clayRoughness(baseRough, colorHex);
  params.metalness = 0;
  const normalMap = getClayNormalMap();
  if (normalMap) {
    params.normalMap = normalMap;
    params.normalScale = clayNormalScale();
  }
}

// ── Resolution ───────────────────────────────────────────────────────────

export function resolveMaterial(spec: MaterialSpec): THREE.Material {
  const palette = PALETTE[spec.base] || PALETTE._default;
  let color = palette.color;
  let roughness = palette.roughness;
  const metalness = palette.metalness;
  const toon = palette.toon;

  // Apply style tint
  if (spec.style) {
    const t = STYLE_TINT[spec.style];
    if (t) {
      const c = new THREE.Color(color);
      c.multiplyScalar(t.darken);
      color = c.getHex();
      roughness = Math.max(0, Math.min(1, roughness + t.rough_add));
    }
    if (STYLE_COLOR_OVERRIDE[spec.style] != null) {
      color = STYLE_COLOR_OVERRIDE[spec.style];
    }
  }

  // Apply explicit tint
  if (spec.tint != null) {
    const c = new THREE.Color(color);
    c.multiply(new THREE.Color(spec.tint));
    color = c.getHex();
  }

  // vertexColors defaults to FALSE. Plain BoxGeometry (terrainStructures walls/
  // floors/roofs) has NO `color` attribute; with vertexColors:true THREE reads
  // the undefined attribute as black → the intermittent BLACK FLOOR glitch.
  // Bake paths that DO write a `color` attribute (biome ground, buildRecipe
  // meshes) opt back in via enableVertexColors(mat) AFTER baking.
  const params: any = { color: new THREE.Color(color), vertexColors: false };

  if (palette.procedural) {
    params.map = _getProceduralTexture(palette.procedural, color);
    // Match texture color to base — set color to white so map shows through
    // unmuddied. The vertex-color AO still darkens concavities.
    params.color = new THREE.Color(0xffffff);
  }

  if (toon) {
    if (CLAY_MODE) {
      // Matte clay: smooth standard shading, no banding, high roughness.
      // Per-material roughness jitter (seeded by the resolved base/tint colour,
      // captured before any white procedural-map override) + shared thumbprint
      // normal map break the uniform-plastic read. metalness forced to 0.
      applyClaySurface(params, Math.max(CLAY_ROUGHNESS_FLOOR, roughness), color);
      params.roughness = stylizedSurfaceRoughness(roughness, color);
      params.envMapIntensity = CLAY_ENV_INTENSITY;
      const _clayM = new THREE.MeshStandardMaterial(params);
      applyClayShaderPatch(_clayM);   // whisper wax-fresnel rim
      return _clayM;
    }
    params.gradientMap = getToonGradient();
    return new THREE.MeshToonMaterial(params);
  } else {
    // Metals / glass: keep their identity but calm the specular so a few shiny
    // accents sit inside an otherwise matte clay world.
    params.roughness = CLAY_MODE ? Math.min(1, roughness + 0.15) : roughness;
    params.metalness = CLAY_MODE ? metalness * 0.85 : metalness;
    params.envMapIntensity = CLAY_ENV_INTENSITY;
    return new THREE.MeshStandardMaterial(params);
  }
}

/**
 * Opt a material INTO vertex-color rendering. Call this AFTER baking a `color`
 * attribute onto the geometry (biome ground fake-AO, buildRecipe _bakeFakeAO).
 * resolveMaterial returns vertexColors:false by default so plain BoxGeometry
 * (which has no color attribute) doesn't render black.
 */
export function enableVertexColors<T extends THREE.Material>(mat: T): T {
  (mat as any).vertexColors = true;
  mat.needsUpdate = true;
  return mat;
}

// ── Registry-level diagnostics ───────────────────────────────────────────
export function knownBaseMaterials(): string[] { return Object.keys(PALETTE).filter((k) => !k.startsWith("_")); }
export function knownStyles(): string[] { return Object.keys(STYLE_TINT); }

// ── §7c readout: texture-embedding → renderable params (the "blend" readout) ──
// A combined/reacted item has no source texture, only a fused HRR vector. We
// recover its dominant hue + luminance by comparing the vector to the facet
// reference vectors, build a representative colour, and pick the nearest PALETTE
// base — "nearest material, tinted by the fused vector" (user choice §7c #3).

function _hslToHex(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

function _hueLumaToHex(hue: number, luma: number): number {
  if (hue >= 12) { const v = Math.round((luma / 7) * 255); return (v << 16) | (v << 8) | v; } // achromatic
  return _hslToHex((hue * 30 + 15) / 360, 0.55, 0.18 + (luma / 7) * 0.62);
}

function _colorDist(a: number, b: number): number {
  const dr = ((a >> 16) & 255) - ((b >> 16) & 255);
  const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
  const db = (a & 255) - (b & 255);
  return dr * dr + dg * dg + db * db;
}

/** Recover renderable params from a (combined/reacted) texture-embedding. */
export function vectorToParams(v: ComplexVec): { base: string; tint: number } {
  let hue = 12, hueS = -Infinity;
  for (let h = 0; h <= 12; h++) {
    const s = innerProductReal(v, facetRef("hue", "h" + h));
    if (s > hueS) { hueS = s; hue = h; }
  }
  let luma = 4, lumaS = -Infinity;
  for (let l = 0; l <= 7; l++) {
    const s = innerProductReal(v, facetRef("luminance", "l" + l));
    if (s > lumaS) { lumaS = s; luma = l; }
  }
  const tint = _hueLumaToHex(hue, luma);
  let base = "_default", bd = Infinity;
  for (const name of Object.keys(PALETTE)) {
    if (name.startsWith("_")) continue;
    const d = _colorDist(PALETTE[name].color, tint);
    if (d < bd) { bd = d; base = name; }
  }
  return { base, tint };
}
