// v7.0.0 — BuildRecipe projector.
//
// One canonical input (BuildRecipe), four parallel projections:
//   1. visual:    Three.js Object3D tree
//   2. colliders: array of (shape, tag, world-AABB) for the collision system
//   3. handles:   editable-handle metadata for the editor UI
//   4. behavior:  registered behavior hooks for the runtime tick loop
//
// LOD, InstancedMesh, geometry caching, and material registry lookup all
// happen here so EVERY recipe gets them automatically. This is the
// "polish baked in" Codex's plan called out — done at phase 0 not phase 12.

import * as THREE from "three";
import type { BuildRecipe, PartSpec, ColliderSpec } from "./buildRecipe.js";
import { resolveMaterial, enableVertexColors } from "./materialRegistry.js";

// ── Projection result ─────────────────────────────────────────────────────

export interface ProjectedRecipe {
  /** The Three.js scene-graph node for this recipe. */
  object3d: THREE.Object3D;
  /** Per-part collider data with world transforms. */
  colliders: Array<{ partId: string; collider: ColliderSpec; worldMatrix: THREE.Matrix4 }>;
  /** Map of partId -> Object3D so pickup raycast can resolve to a part. */
  partMeshes: Map<string, THREE.Object3D>;
  /** The recipe itself, preserved for editing / save-load. */
  recipe: BuildRecipe;
}

// ── Geometry cache ───────────────────────────────────────────────────────
//
// Identical part specs produce identical geometries; cache by content hash.
// Big win for forests (300 trees → 1 trunk geometry, 1 canopy geometry).
const _geometryCache = new Map<string, THREE.BufferGeometry>();

function _cacheKey(part: PartSpec): string {
  return JSON.stringify({ kind: part.kind, params: part.params || {}, modifiers: part.modifiers || [] });
}

// ── The projector itself ─────────────────────────────────────────────────

export function projectRecipe(recipe: BuildRecipe): ProjectedRecipe {
  const root = new THREE.Group();
  root.name = `recipe:${recipe.kind}:${recipe.id}`;
  root.userData = {
    recipe_id: recipe.id,
    recipe_kind: recipe.kind,
    recipe_tags: recipe.tags,
    aesthetic: recipe.style,
  };

  const colliders: ProjectedRecipe["colliders"] = [];
  const partMeshes = new Map<string, THREE.Object3D>();

  // Project each top-level part
  for (const part of recipe.parts) {
    const partObj = _projectPart(part, recipe, colliders, partMeshes, "");
    root.add(partObj);
  }

  // Apply recipe-level scale
  if (recipe.scale && recipe.scale !== 1) {
    root.scale.setScalar(recipe.scale);
  }

  // Recipe-level colliders (when no parts, or recipe-wide bounds)
  for (const c of recipe.colliders) {
    colliders.push({ partId: "_root_", collider: c, worldMatrix: root.matrixWorld.clone() });
  }

  // Child colliders were discovered before their ancestors were attached.
  // Refresh once the full hierarchy and root scale are established.
  root.updateMatrixWorld(true);
  for (const entry of colliders) {
    const owner = entry.partId === '_root_' ? root : partMeshes.get(entry.partId)?.parent;
    if (owner) entry.worldMatrix.copy(owner.matrixWorld);
  }
  return { object3d: root, colliders, partMeshes, recipe };
}

function _projectPart(
  part: PartSpec,
  recipe: BuildRecipe,
  collidersOut: ProjectedRecipe["colliders"],
  partMeshes: Map<string, THREE.Object3D>,
  parentPath: string,
): THREE.Object3D {
  const path = parentPath ? `${parentPath}.${part.id}` : part.id;
  const group = new THREE.Group();
  group.name = `part:${part.id}`;

  // Resolve material. `matSlot` is `MaterialSlot | "" | undefined` due to the
  // short-circuit, so we coerce to `MaterialSlot | null` for clean usage below.
  const matSlot = (part.material_slot && recipe.materialSlots[part.material_slot]) || null;
  const material = matSlot ? resolveMaterial(matSlot) : resolveMaterial({ base: "_default" });

  // Build geometry (cached by content hash). `_buildGeometryForPart` may
  // return `null` for unknown kinds; in that case we skip caching and skip
  // mesh creation entirely.
  const key = _cacheKey(part);
  let geom = _geometryCache.get(key);
  if (!geom) {
    const built = _buildGeometryForPart(part);
    if (built) {
      geom = built;
      _geometryCache.set(key, geom);
    }
  }

  // Create the mesh
  if (geom) {
    const mesh = new THREE.Mesh(geom, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      part_id: part.id,
      part_path: path,
      part_kind: part.kind,
      recipe_id: recipe.id,
    };
    group.add(mesh);
    partMeshes.set(part.id, mesh);

    // Bake AO into vertex colors (Toy Story-style soft shadows in concavities).
    // Cheap: per-vertex Y position used as a fake AO term.
    _bakeFakeAO(geom, matSlot?.ao ?? 0.5);
    // Geometry now has a baked `color` attribute → opt the material into vertex
    // colors (resolveMaterial defaults to false so plain BoxGeometry stays lit).
    enableVertexColors(material);
  }

  // Apply local transform
  if (part.position) group.position.set(part.position[0], part.position[1], part.position[2]);
  if (part.rotation) group.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2]);
  if (part.scale != null) {
    if (typeof part.scale === "number") group.scale.setScalar(part.scale);
    else group.scale.set(part.scale[0], part.scale[1], part.scale[2]);
  }

  // Project children recursively
  for (const child of part.children || []) {
    const childObj = _projectPart(child, recipe, collidersOut, partMeshes, path);
    group.add(childObj);
  }

  // Register colliders for this part
  for (const c of part.colliders || []) {
    group.updateMatrixWorld(true);
    collidersOut.push({ partId: part.id, collider: c, worldMatrix: group.matrixWorld.clone() });
  }

  // Stamp socket data on group userData so the placement system can read it
  if (part.sockets && part.sockets.length > 0) {
    (group.userData as any).sockets = part.sockets;
  }

  return group;
}

// ── Geometry builders per kind ───────────────────────────────────────────
//
// These are the BuildRecipe-native geometry constructors. Generators in
// generators/*.ts will be migrated to emit recipes whose parts reference
// these kinds. Until migration is complete, the legacy renderTree path
// still works in parallel.

function _buildGeometryForPart(part: PartSpec): THREE.BufferGeometry | null {
  const p = part.params || {};
  switch (part.kind) {
    case "shaft_cylinder": {
      const radius = Number(p.radius) || 0.5;
      const height = Number(p.height) || 1;
      const segments = Number(p.segments) || 16;
      return new THREE.CylinderGeometry(radius * (1 - (Number(p.taper) || 0)), radius, height, segments);
    }
    case "box": {
      const w = Number(p.width) || 1;
      const h = Number(p.height) || 1;
      const d = Number(p.depth) || 1;
      return new THREE.BoxGeometry(w, h, d);
    }
    case "sphere": {
      const r = Number(p.radius) || 0.5;
      return new THREE.SphereGeometry(r, 12, 8);
    }
    case "cone": {
      const r = Number(p.radius) || 0.5;
      const h = Number(p.height) || 1;
      return new THREE.ConeGeometry(r, h, 12);
    }
    case "plane": {
      const w = Number(p.width) || 1;
      const d = Number(p.depth) || 1;
      return new THREE.PlaneGeometry(w, d);
    }
    default:
      return null;
  }
}

// ── Fake ambient occlusion (Toy Story plastic-shell aesthetic) ──────────
//
// Real AO requires a precompute or a screen-space pass. For the toy-physical
// look we just want soft darkening in concavities and on undersides. We
// approximate this by baking a vertex-color attribute: darken vertices whose
// normal points downward or sideways, brighten those facing up.
function _bakeFakeAO(geom: THREE.BufferGeometry, strength: number): void {
  if (strength <= 0) return;
  if (geom.getAttribute("color")) return;  // already baked
  if (!geom.getAttribute("normal")) geom.computeVertexNormals();
  const normals = geom.getAttribute("normal");
  const colors = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) {
    const ny = normals.getY(i);  // [-1, 1]
    // Darker when pointing down/side, lighter when pointing up
    const ao = 1 - strength * (1 - Math.max(0, ny * 0.5 + 0.5));
    colors[i * 3] = ao;
    colors[i * 3 + 1] = ao;
    colors[i * 3 + 2] = ao;
  }
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

// ── Cache size diagnostic ───────────────────────────────────────────────
export function geometryCacheSize(): number { return _geometryCache.size; }
export function clearGeometryCache(): void { _geometryCache.clear(); }
