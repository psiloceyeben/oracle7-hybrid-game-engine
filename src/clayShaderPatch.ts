// clayShaderPatch.ts — fake SSS / wax-fresnel rim for clay materials.
//
// A WHISPER-subtle in-shader material patch (no extra passes) that brightens
// grazing angles toward a warm cream, so clay reads with a faint waxy
// translucency at thin edges — the way real wax/clay catches a hair of light
// where a form turns away from the eye. This is the cheap, matte-safe stand-in
// for subsurface scattering: it is emphatically NOT MeshPhysical transmission
// (too expensive, and reads as glass), NOT a bloom/glow, NOT a glass Fresnel.
//
// It sits alongside the existing clay recipe (materialRegistry.applyClaySurface:
// MeshStandard, roughness ~0.9, metalness 0, thumbprint normalMap) and is fully
// independent of clayGrade's SSAO/grade/bloom post-stack — it's a per-material
// fragment tweak that runs in the object's own shading, so it composites under
// AO/grade correctly with no coordination needed.
//
// HOW SUBTLE (the whole point — err weaker):
//   - Default rim tint  = 0xffe9c8  (warm cream, close to the terracotta world).
//   - Default strength  = 0.06      (max added luminance at a pure grazing edge,
//                                     in linear light, BEFORE tone-map + grade).
//   - Default power     = 3.5       (Fresnel falloff; high power ⇒ the lift is
//                                     confined to a thin sliver at the silhouette
//                                     and is ~0 across the lit face).
//   With these numbers the face of a clay object is visually unchanged; only the
//   last few degrees before the silhouette pick up a barely-perceptible warm
//   sheen. If in doubt on a real GPU, LOWER strength (0.03–0.04) before anything.
//   The effect is ADDED after the material's own lighting, so it never darkens,
//   never tints the body colour, and cannot invert to a dark edge.
//
// Robustness:
//   - Idempotent: a flag stashed on the material (`__clayRimPatched`) guards
//     against double-injection (re-patching would stack onBeforeCompile hooks
//     and double the anchor replacement → shader compile error).
//   - Chains any pre-existing onBeforeCompile the material already had.
//   - Anchors on the stock three.js token `#include <opaque_fragment>` so the
//     rim joins linear outgoingLight BEFORE tone mapping, output colour-space
//     conversion, fog and alpha processing. If that token is absent (a material
//     type without it), we no-op that material rather than throw.
//   - `customProgramCacheKey` is set so three doesn't share a cached program
//     between rim-patched and un-patched materials of the same type.
//
// TUNING NOTE: every number here needs Ben's real-GPU eye — the Box C
// swiftshader probe cannot judge rim amplitude. Live handles are exposed on
// `window._wanderClayRim` for A/B without a rebuild.

import * as THREE from "three";

// ── Tunables (start conservative; real-GPU tune) ────────────────────────────
// Warm cream the grazing edge is lifted toward. Kept close to the world palette
// so the rim reads as "wax catching light", not a coloured outline.
const RIM_COLOR = new THREE.Color(0xffe9c8);
// Max added LINEAR luminance at a pure grazing angle. 0.06 is a whisper; the
// tone-map + clayGrade curve compress it further on screen. Lower, never raise,
// if it reads as a glow.
const RIM_STRENGTH = 0.06;
// Fresnel exponent. Higher ⇒ the lift is squeezed into a thinner silhouette
// sliver and the lit face stays untouched. 3.5 keeps it edge-only.
const RIM_POWER = 3.5;

/** Live-tunable global config (mutated via window handle; read at compile). */
const _cfg = {
  color: RIM_COLOR.clone(),
  strength: RIM_STRENGTH,
  power: RIM_POWER,
};

// Materials patched so far, so a live config change can force-recompile them.
const _patched = new Set<THREE.Material>();
// Only hooks installed over Three's untouched default are known to be safe
// for static render sharing. A public flag or a matching cache-key string is
// not evidence that an arbitrary custom shader can be copied or instanced.
const _reviewed = new WeakMap<THREE.Material, {compile: THREE.Material['onBeforeCompile']; key: THREE.Material['customProgramCacheKey']}>();
export function isReviewedClayShaderPatch(material: THREE.Material): boolean {
  const record = _reviewed.get(material);
  return !!record && material.onBeforeCompile === record.compile && material.customProgramCacheKey === record.key;
}

/**
 * Inject the warm wax-Fresnel rim into a material via onBeforeCompile.
 *
 * Safe to call on any lit three.js material (Standard/Phong/Lambert/Toon —
 * anything whose fragment shader exposes outgoingLight at opaque_fragment).
 * Idempotent: a second call on the same material is a no-op. Does NOT change
 * roughness, colour, normalMap, or any other clay recipe field — it only adds a
 * thin additive warm term at grazing angles.
 *
 * @param material the clay MeshStandardMaterial (or compatible lit material).
 */
export function applyClayShaderPatch(material: THREE.Material): void {
  if (!material) return;
  const m = material as THREE.Material & {
    __clayRimPatched?: boolean;
    onBeforeCompile?: (shader: any, renderer: any) => void;
    customProgramCacheKey?: () => string;
  };
  if (m.__clayRimPatched) {
    // Explicit reuse after dispose needs live tuning again, not another hook.
    _patched.add(m);
    return;
  }
  m.__clayRimPatched = true;
  // The live-tuning registry must not retain every preview/world ever made.
  // Register once: reusing a disposed material keeps the same cleanup hook.
  m.addEventListener("dispose", () => { _patched.delete(m); });

  const prevOBC = m.onBeforeCompile;
  const prevCacheKey = m.customProgramCacheKey;

  m.onBeforeCompile = (shader: any, renderer: any) => {
    // chain any existing hook first (e.g. a future patch), then add the rim
    if (typeof prevOBC === "function") {
      try { prevOBC.call(m, shader, renderer); } catch {}
    }

    const anchor = "#include <opaque_fragment>";
    if (typeof shader.fragmentShader !== "string" ||
        shader.fragmentShader.indexOf(anchor) === -1) {
      // Material type without the expected token — leave it untouched rather
      // than corrupt the shader. (No throw: never risk a black screen.)
      return;
    }

    // Uniforms driving the rim. Kept as uniforms (not #defines) so the live
    // window handle can nudge them without a shader recompile where possible.
    shader.uniforms.uClayRimColor    = { value: _cfg.color };
    shader.uniforms.uClayRimStrength = { value: _cfg.strength };
    shader.uniforms.uClayRimPower    = { value: _cfg.power };

    // Declare uniforms + a varying for the view-space normal/position. The
    // standard/phong fragment shaders already compute `normal` and
    // `vViewPosition` in view space, so we reuse those directly — no new
    // varyings, no vertex-shader edit needed.
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      /* glsl */`
        uniform vec3  uClayRimColor;
        uniform float uClayRimStrength;
        uniform float uClayRimPower;
        void main() {
      `,
    );

    // Add the rim to linear outgoing radiance, not display-encoded RGB.
    // This lets exposure, tone mapping, fog and alpha affect the whole surface
    // consistently. `normal` and `vViewPosition` are the stock
    // view-space fragment normal and (negated) view position in these shaders.
    //   viewDir = normalize(vViewPosition)   [points fragment→camera]
    //   fres    = pow(1 - saturate(N·V), power)
    // Then add color * strength * fres to the lit RGB. Purely additive: cannot
    // darken, cannot tint the body, confined to the silhouette by `power`.
    shader.fragmentShader = shader.fragmentShader.replace(
      anchor,
      /* glsl */`
        {
          vec3  clayN = normalize( normal );
          vec3  clayV = normalize( vViewPosition );
          float clayNdV = clamp( dot( clayN, clayV ), 0.0, 1.0 );
          float clayFres = pow( 1.0 - clayNdV, uClayRimPower );
          outgoingLight += uClayRimColor * ( uClayRimStrength * clayFres );
        }
        ${anchor}
      `,
    );
  };

  // Distinguish rim-patched programs in three's cache so an un-patched material
  // of the same type doesn't accidentally reuse this compiled program.
  m.customProgramCacheKey = () => {
    const base = typeof prevCacheKey === "function" ? prevCacheKey.call(m) : "";
    return base + "|clayRim2Linear";
  };

  m.needsUpdate = true;
  _patched.add(m);
  if (prevOBC === THREE.Material.prototype.onBeforeCompile && prevCacheKey === THREE.Material.prototype.customProgramCacheKey) {
    _reviewed.set(m, {compile: m.onBeforeCompile, key: m.customProgramCacheKey});
  }
}

// ── Live tuning handle (A/B on /mp-staging, no rebuild) ──────────────────────
// Note: color/strength/power are read into uniforms at COMPILE time. Changing
// _cfg.color mutates the shared Color object in place, so it updates live for
// all patched materials. Changing strength/power updates newly compiled
// materials immediately; to push a value onto already-compiled materials, we
// flip needsUpdate so three recompiles them with the new uniform defaults.
if (typeof window !== "undefined") {
  (window as any)._wanderClayRim = {
    setStrength: (v: number) => {
      _cfg.strength = v;
      _patched.forEach((mm) => { (mm as any).needsUpdate = true; });
    },
    setPower: (v: number) => {
      _cfg.power = v;
      _patched.forEach((mm) => { (mm as any).needsUpdate = true; });
    },
    setColor: (hex: number) => {
      // mutate in place so the shared uniform value object updates live
      _cfg.color.setHex(hex);
    },
    get config() { return { strength: _cfg.strength, power: _cfg.power, color: "#" + _cfg.color.getHexString() }; },
    patchedCount: () => _patched.size,
  };
}
