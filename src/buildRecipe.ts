// v7.0.0 — BuildRecipe contract.
//
// THE INTERMEDIATE LAYER between natural language and Three.js.
//
// Every spawnable thing in the world — buildings, items, NPCs, mobs, props,
// biome chunks, world layers — passes through this contract. A recipe carries
// everything four downstream subsystems need:
//   1. visual mesh projection (Three.js Object3D)
//   2. collider projection (per-shape collision data with tags)
//   3. editable handles (sockets, part graph, modifiers, transform anchors)
//   4. behavior hooks (state machines, perception, dialogue, schedule)
//
// One canonical input. Four parallel projections. Generators stop producing
// Three.js objects directly; they produce recipes, which the projector
// converts. This is the architectural correction Codex's audit identified
// as the root of every "system works in isolation but features don't compose"
// failure mode in the game's history.
//
// SUBSTRATE NOTE (implicit in code, explicit in docs): each BuildRecipe is
// an HRR-bindable composition. The metabolism daemon on Box C can address
// recipes via FFT-routing; recipes are what the substrate paradigm treats
// as "the noumenon" of an entity, while the Three.js projection is "the
// phenomenon." This connection is not surfaced in the type signature
// because it's implementation-mechanical, not interface-relevant.

// ── Aesthetic register identifier ─────────────────────────────────────────
//
// Every recipe defaults to the WANDER_TOON_PHYSICAL register:
//   - Toy Story plastic-shell materiality (AO baked into vertex colors at
//     projection time; subtle environment reflection on smooth surfaces;
//     micro-detail noise on rough surfaces)
//   - TFT-class silhouette emphasis (exaggerated proportions on characters;
//     color zones not gradients; thumbnail-readable shapes)
//   - Looney Tunes outlines (already via depth-edge shader; recipe can
//     override outline weight per-part)
//   - Stick War depth staging (warm sun, cool shadows, fog parallax)
//   - Jetpack Joyride motion warmth (spawn particles, walk dust, pickup
//     sparkles — wired by the behavior projection)
export type AestheticRegister = "WANDER_TOON_PHYSICAL" | "CLASSIC_DEMO" | "WATERCOLOR" | "VOXEL";

// ── Collider tags ─────────────────────────────────────────────────────────
export type ColliderTag =
  | "solid"        // hard wall: player can't pass
  | "walkable"     // top surface of a floor / step: player walks on
  | "pass_through" // foliage, particles, decorative: ignored by collision
  | "climbable"    // ladders, rough walls: player can climb
  | "interior"    // hollow space inside structures: pass through to enter
  | "portal"      // doorway transit volume
  | "trigger";    // fires a behavior on contact (chest, switch, etc.)

// ── Socket types ─────────────────────────────────────────────────────────
//
// Socket = a labeled attachment point. The placement system reads sockets
// to determine "where does this thing attach to what." A column's top
// advertises "column_top, weight class 4, accepts: entablature_anchor."
// A roof's footprint advertises "entablature_anchor, requires: 4x column_top
// or 1x wall_top." Match → snap. No match → freeform place.
export type SocketKind =
  | "column_top"           // top of a column shaft; accepts entablature/lintel
  | "column_base"          // bottom of a column shaft; attaches to plinth/floor
  | "wall_top"             // top of a wall; accepts roof/parapet
  | "wall_side"            // side of a wall; accepts attached fixtures
  | "floor_surface"        // walkable floor; accepts any standing object
  | "plinth_top"           // top of a plinth/foundation; accepts columns
  | "entablature_anchor"   // bottom of roof; needs column tops or wall top
  | "ground_anchor"        // generic ground attachment
  | "hand_grip"            // graspable handle (sword pommel, lantern hook)
  | "wear_head" | "wear_torso" | "wear_back" | "wear_feet" | "wear_hands"
                           // wearable equipment slots
  | "tool_use"             // tool interaction point
  | "doorway_threshold"    // doorway entry/exit point
  // v1.1.3-beta Phase 2: synthesized-from-AABB sockets. Generated on the
  // fly by socketPlacement.synthesizeAabbSockets() for entities that lack
  // authored sockets, so user-built creations participate in snap behavior.
  | "auto_corner"          // synthesized AABB corner — 8 per entity
  | "auto_face"            // synthesized AABB face center — 6 per entity
  | "generic";

export interface SocketSpec {
  kind: SocketKind;
  /** Local position relative to part origin. */
  offset: [number, number, number];
  /** Local normal direction (which way "out" points). */
  normal: [number, number, number];
  /** What this socket can connect to. */
  accepts?: SocketKind[];
  /** Weight class — only sockets within this class can connect. */
  weight_class?: number;
  /** Free or in-use? Set at placement time. */
  attached_to?: string | null;
}

// ── Part graph ────────────────────────────────────────────────────────────
//
// A recipe is built from one or more parts. Each part has a stable id,
// its own mesh/material/colliders, child parts (nested composition), and
// a transform relative to the recipe's origin.
//
// Per-part addressability falls out of this naturally: pickup walks the
// part graph to find what was aimed at; detachAtPath operates on part ids.
// The previous "every leaf mesh tagged with the parent entity" pattern is
// replaced — now every leaf mesh is tagged with its part_id, and the part
// graph carries the structural relationship.
export interface PartSpec {
  /** Stable identifier within the recipe (e.g. "shaft", "capital", "column_3"). */
  id: string;
  /** What kind of thing this is — drives the renderer dispatch. */
  kind: string;
  /** Optional modifiers (style + condition + material hints). */
  modifiers?: string[];
  /** Per-part parameters (radius, height, color, etc.). */
  params?: Record<string, unknown>;
  /** Transform relative to the recipe's origin. */
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number] | number;
  /** Material slot — references a key in the recipe's materialSlots map. */
  material_slot?: string;
  /** Colliders this part contributes. Empty → no collision (visual-only). */
  colliders?: ColliderSpec[];
  /** Sockets this part exposes. */
  sockets?: SocketSpec[];
  /** Nested parts (for composite parts: column = shaft + capital + base). */
  children?: PartSpec[];
  /** Behavior hooks attached to this part (clickable, interactable, etc.). */
  behavior?: BehaviorHook[];
}

// ── Colliders ─────────────────────────────────────────────────────────────
//
// Colliders are SEPARATE from visual meshes. A temple's wall is rendered as
// detailed geometry but collides as a 4x4x12m AABB. A tree's canopy is
// rendered as a sphere but has no collider (pass_through tag implicit via
// no collider). A bridge has multiple colliders: walkable surface on top,
// pass_through underneath.
export interface ColliderSpec {
  shape: "aabb" | "cylinder" | "sphere" | "capsule" | "cone";
  tag: ColliderTag;
  /** AABB: [width, height, depth]. Cylinder: [radius, height]. Sphere: [radius]. Cone: [radius, height]. */
  size: number[];
  offset?: [number, number, number];
  /** If the player can stand on this surface, the Y of the walkable top. */
  surface_y?: number;
}

// ── Materials ────────────────────────────────────────────────────────────
//
// Material slots are referenced by parts via material_slot key. The slot
// resolves at projection time against the global material registry, with
// the recipe's style + modifiers driving the resolution.
//
// e.g. a column part has material_slot = "shaft_stone"; the recipe declares
// materialSlots.shaft_stone = { base: "marble", style: "polished" }; at
// projection the material registry returns a MeshToonMaterial with the
// marble preset + polished condition tints.
export interface MaterialSpec {
  /** Base material name from registry: marble, wood, stone, brick, etc. */
  base: string;
  /** Optional style hint: polished, weathered, ruined, painted_red, etc. */
  style?: string;
  /** Optional tint color (multiplied with base palette). */
  tint?: number;
  /** AO strength (0..1). Baked into vertex colors at projection. */
  ao?: number;
}

// ── Editable handles ─────────────────────────────────────────────────────
//
// Handles drive the editor-grade UX. Each handle is a parameter the player
// can manipulate via gizmos (scale handle, position handle, rotate handle,
// color picker, modifier toggle). Handles point at recipe paths.
export interface EditableHandle {
  /** Path into the recipe / part graph. */
  path: string;
  /** What kind of editor control to surface. */
  control: "scale" | "rotate" | "translate" | "color" | "enum" | "number" | "boolean" | "text";
  /** Display label. */
  label: string;
  /** For number/scale: min, max, step. */
  range?: { min: number; max: number; step?: number };
  /** For enum: list of options. */
  options?: string[];
}

// ── Behavior hooks ──────────────────────────────────────────────────────
//
// State machines + interactions + dialogue + perception. Hooks are
// addressed by their kind; the runtime registers handlers per kind.
export interface BehaviorHook {
  kind: "interact" | "tick" | "spawn" | "destroy" | "dialogue" | "perception" | "state_machine" | "schedule" | "trade";
  /** Hook-specific configuration. */
  config?: Record<string, unknown>;
}

// ── LOD ──────────────────────────────────────────────────────────────────
export interface LODSpec {
  /** Distance bands: [near, mid, far] in meters. */
  bands: [number, number, number];
  /** Strategy: "instanced" (use InstancedMesh for far), "merged" (merge geometry),
   *  "billboard" (replace with sprite), "none" (full detail always). */
  far_strategy?: "instanced" | "merged" | "billboard" | "none";
}

// ── The BuildRecipe itself ──────────────────────────────────────────────
export interface BuildRecipe {
  /** Stable id (entity_id). */
  id: string;
  /** Root kind — "structure.temple", "creature.deer", "item.sword", etc. */
  kind: string;
  /** Tags for classification and routing. */
  tags: string[];
  /** Aesthetic register. */
  style: AestheticRegister;
  /** Global scale multiplier applied at projection. */
  scale: number;
  /** Material slot definitions, referenced by parts. */
  materialSlots: Record<string, MaterialSpec>;
  /** Part graph — the recipe's spatial composition. */
  parts: PartSpec[];
  /** Top-level sockets (for the recipe as a whole — e.g. a building's
   *  ground-anchor socket lets it sit on terrain). */
  sockets: SocketSpec[];
  /** Top-level colliders (for things that aren't decomposed into parts —
   *  a simple rock might just be a single sphere collider, no parts). */
  colliders: ColliderSpec[];
  /** Editable handles. */
  handles: EditableHandle[];
  /** Behavior hooks at recipe level. */
  behavior: BehaviorHook[];
  /** LOD spec. */
  lod?: LODSpec;
  /** Save/load metadata. */
  saveLoad: {
    persist_version: number;
    /** Human-readable description for save UI / catalogs. */
    description?: string;
  };
}

// ── Construction helpers ─────────────────────────────────────────────────

let _recipeIdCounter = 1;
export function genRecipeId(prefix: string = "rcp"): string {
  return `${prefix}-${Date.now().toString(36)}-${(_recipeIdCounter++).toString(36)}`;
}

/** Build a default recipe with minimum required fields. */
export function emptyRecipe(kind: string, opts: Partial<BuildRecipe> = {}): BuildRecipe {
  return {
    id: opts.id ?? genRecipeId(),
    kind,
    tags: opts.tags ?? [],
    style: opts.style ?? "WANDER_TOON_PHYSICAL",
    scale: opts.scale ?? 1.0,
    materialSlots: opts.materialSlots ?? {},
    parts: opts.parts ?? [],
    sockets: opts.sockets ?? [],
    colliders: opts.colliders ?? [],
    handles: opts.handles ?? [],
    behavior: opts.behavior ?? [],
    ...(opts.lod ? { lod: opts.lod } : {}),
    saveLoad: opts.saveLoad ?? { persist_version: 1 },
  };
}

/** Navigate to a part by path within a recipe.
 *  Path: "parts[0]" or "parts[0].children[2]" or "shaft.capital" (id-based).
 *  Returns null if not found. */
export function getPartAtPath(recipe: BuildRecipe, path: string): PartSpec | null {
  // Try id-based path first ("shaft.capital")
  const segments = path.split(".").filter(Boolean);
  if (segments.length > 0 && !segments[0].startsWith("parts[")) {
    let pool = recipe.parts;
    let current: PartSpec | null = null;
    for (const seg of segments) {
      const found: PartSpec | undefined = pool.find((p) => p.id === seg);
      if (!found) return null;
      current = found;
      pool = found.children || [];
    }
    return current;
  }
  // Try index-based path ("parts[0].children[2]")
  let current: any = recipe;
  for (const m of path.matchAll(/(\w+)\[(\d+)\]/g)) {
    const [, key, idxStr] = m;
    const idx = parseInt(idxStr, 10);
    current = current?.[key]?.[idx];
    if (!current) return null;
  }
  return current as PartSpec | null;
}

/** Split a recipe at a part path: returns the parent recipe with that part
 *  removed AND a new standalone recipe whose root is the detached part. */
export function splitRecipeAtPath(recipe: BuildRecipe, path: string): { remainder: BuildRecipe; detached: BuildRecipe } | null {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) return null;
  const cloned: BuildRecipe = JSON.parse(JSON.stringify(recipe));
  // Walk to the parent of the target part
  let pool = cloned.parts;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const found = pool.find((p) => p.id === seg);
    if (!found) return null;
    pool = found.children || [];
  }
  const lastSeg = segments[segments.length - 1];
  const idx = pool.findIndex((p) => p.id === lastSeg);
  if (idx < 0) return null;
  const [detachedPart] = pool.splice(idx, 1);
  // Build a standalone recipe from the detached part
  const detachedRecipe = emptyRecipe(detachedPart.kind, {
    parts: [detachedPart],
    style: cloned.style,
    scale: cloned.scale,
    materialSlots: cloned.materialSlots,  // inherit so materials resolve
  });
  return { remainder: cloned, detached: detachedRecipe };
}
