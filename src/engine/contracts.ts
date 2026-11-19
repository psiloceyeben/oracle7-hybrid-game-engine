export const ENGINE_CONTRACT_VERSION = "1.0.0" as const;

export type Vec3 = readonly [number, number, number];
export type RuntimeComponentKind = "render" | "physics" | "animation" | "navigation" | "interaction" | "audio";

export interface VersionedSpec {
  version: typeof ENGINE_CONTRACT_VERSION;
  entityId: string;
  enabled: boolean;
}

export type PhysicsBodyKind = "fixed" | "kinematic-position" | "kinematic-velocity" | "dynamic" | "sensor";
export type ColliderShape = "aabb" | "sphere" | "capsule" | "cylinder" | "cone" | "convex-hull" | "trimesh";

export interface PhysicsColliderSpec {
  id: string;
  shape: ColliderShape;
  size: readonly number[];
  offset?: Vec3;
  rotation?: Vec3;
  tags: readonly ("solid" | "walkable" | "pass-through" | "climbable" | "interior" | "portal" | "trigger")[];
  collisionGroup: string;
  queryGroup: string;
  friction?: number;
  restitution?: number;
}

export interface PhysicsSpec extends VersionedSpec {
  kind: "physics";
  body: PhysicsBodyKind;
  mass?: number;
  gravityScale?: number;
  canSleep: boolean;
  ccd: boolean;
  immutable: boolean;
  colliders: readonly PhysicsColliderSpec[];
}

export type AnimationState =
  | "idle" | "walk" | "run" | "jump" | "fall" | "land"
  | "attack" | "hit" | "death" | "interact" | "carry" | "sit" | "drive" | "talk";

export interface AnimationTransitionSpec {
  from: AnimationState | "*";
  to: AnimationState;
  blendSeconds: number;
}

export interface AnimationSpec extends VersionedSpec {
  kind: "animation";
  rigFamily: "biped" | "quadruped" | "bird" | "aquatic" | "dinosaur" | "vehicle" | "procedural";
  initialState: AnimationState;
  states: readonly AnimationState[];
  transitions: readonly AnimationTransitionSpec[];
  locomotionMetersPerCycle?: number;
  gripSockets?: readonly string[];
  networkState: boolean;
}

export interface NavigationSpec extends VersionedSpec {
  kind: "navigation";
  domain: "ground" | "water" | "air" | "rail" | "interior";
  radius: number;
  height: number;
  maxSlopeDegrees: number;
  stepHeight: number;
  allowedLinks: readonly ("door" | "ladder" | "jump" | "portal" | "seat" | "vehicle")[];
  fallback: "hold" | "steer-local" | "schedule-only";
}

export interface AudioSpec extends VersionedSpec {
  kind: "audio";
  bus: "master" | "music" | "ambience" | "effects" | "ui" | "dialogue";
  cue: string;
  loop: boolean;
  spatial: boolean;
  gain: number;
  maxDistance?: number;
  concurrencyGroup?: string;
  maxConcurrent?: number;
  synthesizedVoice: false;
}

export interface QualityProfile extends VersionedSpec {
  kind: "quality";
  profile: "low" | "balanced" | "high";
  maxPixelRatio: number;
  shadowMapSize: 0 | 512 | 1024 | 2048;
  shadowDistance: number;
  postEffects: readonly ("outline" | "ao" | "smaa" | "bloom" | "warm-grade")[];
  maxDynamicBodies: number;
  maxAudioSources: number;
  facadeDistance: number;
  targetFrameMs: number;
}

export type EngineSpec = PhysicsSpec | AnimationSpec | NavigationSpec | AudioSpec | QualityProfile;

export interface ValidationResult<T = unknown> {
  ok: boolean;
  value?: T;
  errors: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function baseErrors(value: unknown, expectedKind: EngineSpec["kind"]): string[] {
  if (!isRecord(value)) return ["spec must be an object"];
  const errors: string[] = [];
  if (value.version !== ENGINE_CONTRACT_VERSION) errors.push(`version must equal ${ENGINE_CONTRACT_VERSION}`);
  if (!nonEmpty(value.entityId)) errors.push("entityId must be a non-empty string");
  if (value.kind !== expectedKind) errors.push(`kind must equal ${expectedKind}`);
  if (typeof value.enabled !== "boolean") errors.push("enabled must be boolean");
  return errors;
}

function finish<T>(value: unknown, errors: string[]): ValidationResult<T> {
  return errors.length ? { ok: false, errors } : { ok: true, value: value as T, errors: [] };
}

export function validatePhysicsSpec(value: unknown): ValidationResult<PhysicsSpec> {
  const errors = baseErrors(value, "physics");
  if (!isRecord(value)) return finish(value, errors);
  if (!["fixed", "kinematic-position", "kinematic-velocity", "dynamic", "sensor"].includes(String(value.body))) errors.push("body is invalid");
  if (typeof value.canSleep !== "boolean") errors.push("canSleep must be boolean");
  if (typeof value.ccd !== "boolean") errors.push("ccd must be boolean");
  if (typeof value.immutable !== "boolean") errors.push("immutable must be boolean");
  if (!Array.isArray(value.colliders) || value.colliders.length === 0) errors.push("colliders must contain at least one collider");
  else value.colliders.forEach((raw, index) => {
    if (!isRecord(raw)) { errors.push(`colliders[${index}] must be an object`); return; }
    if (!nonEmpty(raw.id)) errors.push(`colliders[${index}].id is required`);
    if (!["aabb", "sphere", "capsule", "cylinder", "cone", "convex-hull", "trimesh"].includes(String(raw.shape))) errors.push(`colliders[${index}].shape is invalid`);
    if (!Array.isArray(raw.size) || raw.size.length === 0 || raw.size.some((n) => !finite(n) || n <= 0)) errors.push(`colliders[${index}].size must contain positive finite numbers`);
    if (!Array.isArray(raw.tags) || raw.tags.length === 0) errors.push(`colliders[${index}].tags must not be empty`);
    if (!nonEmpty(raw.collisionGroup) || !nonEmpty(raw.queryGroup)) errors.push(`colliders[${index}] groups are required`);
  });
  if (value.body === "dynamic" && (!finite(value.mass) || value.mass <= 0)) errors.push("dynamic bodies require positive mass");
  if (value.immutable === true && value.body === "dynamic") errors.push("immutable bodies cannot be dynamic");
  return finish(value, errors);
}

export function validateAnimationSpec(value: unknown): ValidationResult<AnimationSpec> {
  const errors = baseErrors(value, "animation");
  if (!isRecord(value)) return finish(value, errors);
  const rigs = ["biped", "quadruped", "bird", "aquatic", "dinosaur", "vehicle", "procedural"];
  if (!rigs.includes(String(value.rigFamily))) errors.push("rigFamily is invalid");
  if (!Array.isArray(value.states) || !value.states.includes(value.initialState)) errors.push("states must include initialState");
  if (!Array.isArray(value.transitions)) errors.push("transitions must be an array");
  else value.transitions.forEach((raw, index) => {
    if (!isRecord(raw) || !finite(raw.blendSeconds) || raw.blendSeconds < 0 || raw.blendSeconds > 2) errors.push(`transitions[${index}] has an invalid blendSeconds`);
  });
  if (typeof value.networkState !== "boolean") errors.push("networkState must be boolean");
  return finish(value, errors);
}

export function validateNavigationSpec(value: unknown): ValidationResult<NavigationSpec> {
  const errors = baseErrors(value, "navigation");
  if (!isRecord(value)) return finish(value, errors);
  if (!["ground", "water", "air", "rail", "interior"].includes(String(value.domain))) errors.push("domain is invalid");
  for (const key of ["radius", "height", "stepHeight"] as const) if (!finite(value[key]) || value[key] < 0) errors.push(`${key} must be a non-negative finite number`);
  if (!finite(value.maxSlopeDegrees) || value.maxSlopeDegrees < 0 || value.maxSlopeDegrees > 89) errors.push("maxSlopeDegrees must be in [0, 89]");
  if (!Array.isArray(value.allowedLinks)) errors.push("allowedLinks must be an array");
  if (!["hold", "steer-local", "schedule-only"].includes(String(value.fallback))) errors.push("fallback is invalid");
  return finish(value, errors);
}

export function validateAudioSpec(value: unknown): ValidationResult<AudioSpec> {
  const errors = baseErrors(value, "audio");
  if (!isRecord(value)) return finish(value, errors);
  if (!["master", "music", "ambience", "effects", "ui", "dialogue"].includes(String(value.bus))) errors.push("bus is invalid");
  if (!nonEmpty(value.cue)) errors.push("cue is required");
  if (typeof value.loop !== "boolean" || typeof value.spatial !== "boolean") errors.push("loop and spatial must be boolean");
  if (!finite(value.gain) || value.gain < 0 || value.gain > 1) errors.push("gain must be in [0, 1]");
  if (value.synthesizedVoice !== false) errors.push("synthesizedVoice must remain false");
  if (value.spatial && (!finite(value.maxDistance) || value.maxDistance <= 0)) errors.push("spatial audio requires positive maxDistance");
  return finish(value, errors);
}

export function validateQualityProfile(value: unknown): ValidationResult<QualityProfile> {
  const errors = baseErrors(value, "quality");
  if (!isRecord(value)) return finish(value, errors);
  if (!["low", "balanced", "high"].includes(String(value.profile))) errors.push("profile is invalid");
  if (!finite(value.maxPixelRatio) || value.maxPixelRatio < 0.5 || value.maxPixelRatio > 2) errors.push("maxPixelRatio must be in [0.5, 2]");
  if (![0, 512, 1024, 2048].includes(Number(value.shadowMapSize))) errors.push("shadowMapSize is invalid");
  for (const key of ["shadowDistance", "maxDynamicBodies", "maxAudioSources", "facadeDistance", "targetFrameMs"] as const) if (!finite(value[key]) || value[key] < 0) errors.push(`${key} must be non-negative`);
  if (!Array.isArray(value.postEffects)) errors.push("postEffects must be an array");
  return finish(value, errors);
}

export function validateEngineSpec(value: unknown): ValidationResult<EngineSpec> {
  if (!isRecord(value)) return { ok: false, errors: ["spec must be an object"] };
  switch (value.kind) {
    case "physics": return validatePhysicsSpec(value);
    case "animation": return validateAnimationSpec(value);
    case "navigation": return validateNavigationSpec(value);
    case "audio": return validateAudioSpec(value);
    case "quality": return validateQualityProfile(value);
    default: return { ok: false, errors: ["kind must identify a registered engine contract"] };
  }
}

export const QUALITY_PROFILES: Readonly<Record<QualityProfile["profile"], QualityProfile>> = Object.freeze({
  low: Object.freeze({ version: ENGINE_CONTRACT_VERSION, entityId: "runtime:quality", enabled: true, kind: "quality", profile: "low", maxPixelRatio: 1, shadowMapSize: 512, shadowDistance: 34, postEffects: ["outline", "smaa"] as const, maxDynamicBodies: 64, maxAudioSources: 24, facadeDistance: 180, targetFrameMs: 22 }),
  balanced: Object.freeze({ version: ENGINE_CONTRACT_VERSION, entityId: "runtime:quality", enabled: true, kind: "quality", profile: "balanced", maxPixelRatio: 1.5, shadowMapSize: 1024, shadowDistance: 56, postEffects: ["outline", "ao", "smaa", "warm-grade"] as const, maxDynamicBodies: 128, maxAudioSources: 40, facadeDistance: 260, targetFrameMs: 16.7 }),
  high: Object.freeze({ version: ENGINE_CONTRACT_VERSION, entityId: "runtime:quality", enabled: true, kind: "quality", profile: "high", maxPixelRatio: 2, shadowMapSize: 2048, shadowDistance: 80, postEffects: ["outline", "ao", "smaa", "bloom", "warm-grade"] as const, maxDynamicBodies: 192, maxAudioSources: 64, facadeDistance: 340, targetFrameMs: 16.7 }),
});
