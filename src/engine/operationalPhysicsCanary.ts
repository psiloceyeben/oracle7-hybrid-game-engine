import { EngineClock, type EngineFrame } from "./engineClock.js";
import { staticColliderDistanceSquared, MIN_STATIC_HALF_EXTENT, MAX_STATIC_HALF_EXTENT } from './staticColliderDistance.js';

export const OPERATIONAL_PHYSICS_CANARY_BUILD =
  "operational-physics-canary-20260728" as const;

export type OperationalPhysicsMode = "off" | "shadow" | "candidate";
export type OperationalPhysicsStatus =
  | "off"
  | "loading"
  | "ready"
  | "fallback"
  | "disposed";

export interface PhysicsVector3 {
  x: number;
  y: number;
  z: number;
}

export interface PhysicsQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface CharacterMovementInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  run: boolean;
}

export interface CharacterPlanarBasis {
  forward: PhysicsVector3;
  right: PhysicsVector3;
}

export interface StaticBoxCollider {
  id: string;
  center: PhysicsVector3;
  halfExtents: PhysicsVector3;
  rotation?: PhysicsQuaternion;
  friction?: number;
}

export interface DynamicBoxLaunch {
  id: string;
  center: PhysicsVector3;
  halfExtents: PhysicsVector3;
  rotation: PhysicsQuaternion;
  linearVelocity: PhysicsVector3;
  angularVelocity?: PhysicsVector3;
  density?: number;
  restitution?: number;
  friction?: number;
  onPose: (
    position: PhysicsVector3,
    rotation: PhysicsQuaternion,
    settled: boolean,
  ) => void;
}

export interface BoxSweepRequest {
  center: PhysicsVector3;
  halfExtents: PhysicsVector3;
  rotation?: PhysicsQuaternion;
  translation: PhysicsVector3;
  skin?: number;
}

export interface BoxSweepResult {
  translation: PhysicsVector3;
  blocked: boolean;
  timeOfImpact: number | null;
}

export interface OperationalPhysicsCanaryOptions {
  mode: OperationalPhysicsMode;
  eyeHeight: number;
  playerRadius: number;
  getPlayerPosition: () => PhysicsVector3;
  setPlayerPosition: (position: PhysicsVector3) => void;
  getMovementInput: () => CharacterMovementInput;
  getPlanarBasis: () => CharacterPlanarBasis;
  getTerrainHeight: (x: number, z: number) => number;
  constrainHorizontalStep?: (position:PhysicsVector3,dx:number,dz:number)=>{x:number;z:number};
  collectStaticColliders: (
    center: PhysicsVector3,
    radius: number,
  ) => readonly StaticBoxCollider[];
  onFallback?: (reason: string) => void;
  fixedHz?: number;
  staticRadius?: number;
  maxStaticColliders?: number;
}

export interface OperationalPhysicsSnapshot {
  build: typeof OPERATIONAL_PHYSICS_CANARY_BUILD;
  mode: OperationalPhysicsMode;
  status: OperationalPhysicsStatus;
  authoritative: boolean;
  rapierVersion: string | null;
  frames: number;
  fixedSteps: number;
  staticColliders: number;
  dynamicBoxes: number;
  kinematicBoxes: number;
  terrainSamples: number;
  grounded: boolean;
  verticalVelocity: number;
  droppedSeconds: number;
  fallbackReason: string | null;
  position: Readonly<PhysicsVector3> | null;
  activeContext: string;
}

type RapierModule = typeof import("@dimforge/rapier3d-compat");
type RapierApi = RapierModule["default"];
type RapierWorld = InstanceType<RapierApi["World"]>;
type RapierRigidBody = ReturnType<RapierWorld["createRigidBody"]>;
type RapierCollider = ReturnType<RapierWorld["createCollider"]>;
type RapierCharacterController = ReturnType<
  RapierWorld["createCharacterController"]
>;

interface DynamicBoxRecord {
  body: RapierRigidBody;
  collider: RapierCollider;
  age: number;
  onPose: DynamicBoxLaunch["onPose"];
}

interface KinematicBoxRecord {
  body: RapierRigidBody;
  collider: RapierCollider;
  signature: string;
}

const WALK_SPEED = 4.6;
const RUN_SPEED = 8.5;
const GRAVITY = 18;
const JUMP_SPEED = 6.6;
const TERMINAL_VELOCITY = 32;
const JUMP_BUFFER_SECONDS = 0.12;
const COYOTE_SECONDS = 0.1;
const STATIC_REFRESH_SECONDS = 4;
const STATIC_REFRESH_DISTANCE = 8;
const TERRAIN_PATCH_SIZE = 96;
const TERRAIN_SUBDIVISIONS = 24;
const TELEPORT_DISTANCE = 12;
const MIN_HALF_EXTENT = MIN_STATIC_HALF_EXTENT;
const MAX_HALF_EXTENT = MAX_STATIC_HALF_EXTENT;
const MAX_DYNAMIC_BOXES = 48;
const MAX_DYNAMIC_AGE_SECONDS = 8;

export function operationalPhysicsModeFromSearch(
  search: string,
): OperationalPhysicsMode {
  const params = new URLSearchParams(search);
  const explicit = params.get("engine.canary") ?? params.get("engine.physics");
  if (explicit === "candidate" || explicit === "shadow") return explicit;
  // Keep legacy walking authoritative while making the shared Rapier world
  // available to vehicles, thrown objects, and moving world colliders.
  // The Rapier adapter has passed the movement, wall, stairs, door, vehicle and
  // thrown-object gates. It now owns normal play by default, while an explicit
  // `?engine.physics=shadow` remains an immediate no-build rollback and runtime
  // initialization failure still falls back to legacy automatically.
  return "candidate";
}

export class OperationalPhysicsCanary {
  readonly mode: OperationalPhysicsMode;
  private readonly options: OperationalPhysicsCanaryOptions;
  private readonly clock: EngineClock;
  private status: OperationalPhysicsStatus;
  private rapier: RapierApi | null = null;
  private world: RapierWorld | null = null;
  private body: RapierRigidBody | null = null;
  private playerCollider: RapierCollider | null = null;
  private controller: RapierCharacterController | null = null;
  private staticColliders: RapierCollider[] = [];
  private terrainCollider: RapierCollider | null = null;
  private dynamicBoxes = new Map<string, DynamicBoxRecord>();
  private kinematicBoxes = new Map<string, KinematicBoxRecord>();
  private terrainSamples = 0;
  private rapierVersion: string | null = null;
  private frameCount = 0;
  private fixedStepCount = 0;
  private verticalVelocity = 0;
  private grounded = false;
  private jumpBuffer = 0;
  private coyote = 0;
  private jumpRequested = false;
  private suspended = false;
  private refreshElapsed = Infinity;
  private lastRefreshPosition: PhysicsVector3 | null = null;
  private fallbackReason: string | null = null;
  private lastPosition: PhysicsVector3 | null = null;
  private activeContext = "hub";

  constructor(options: OperationalPhysicsCanaryOptions) {
    this.options = options;
    this.mode = options.mode;
    this.status = options.mode === "off" ? "off" : "loading";
    this.clock = new EngineClock({
      fixedHz: options.fixedHz ?? 60,
      maxCatchUpSteps: 5,
      maxFrameSeconds: 0.1,
      schedulerMode: "fixed-time-tiers",
    });
    this.clock.reset(0);
  }

  async init(): Promise<void> {
    if (this.mode === "off" || this.status === "disposed") return;
    try {
      const imported = await import("@dimforge/rapier3d-compat");
      const rapier = imported.default;
      await rapier.init();
      if (this.isDisposed()) return;
      this.rapier = rapier;
      this.rapierVersion = rapier.version();
      this.world = new rapier.World({ x: 0, y: -GRAVITY, z: 0 });

      const external = finiteVector(this.options.getPlayerPosition());
      const center = cameraToBodyCenter(
        external,
        this.options.eyeHeight,
        this.options.playerRadius,
      );
      this.body = this.world.createRigidBody(
        rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
          center.x,
          center.y,
          center.z,
        ),
      );
      const cylinderHalfHeight = Math.max(
        0.01,
        (this.options.eyeHeight - this.options.playerRadius * 2) / 2,
      );
      this.playerCollider = this.world.createCollider(
        rapier.ColliderDesc.capsule(
          cylinderHalfHeight,
          this.options.playerRadius,
        )
          .setFriction(0)
          .setRestitution(0),
        this.body,
      );
      this.controller = this.world.createCharacterController(0.025);
      this.controller.enableAutostep(0.56, 0.24, true);
      this.controller.enableSnapToGround(0.28);
      this.controller.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
      this.controller.setMinSlopeSlideAngle((54 * Math.PI) / 180);
      this.controller.setApplyImpulsesToDynamicBodies(true);
      this.controller.setCharacterMass(80);
      this.lastPosition = cloneVector(external);
      this.rebuildEnvironment(external);
      this.status = "ready";
    } catch (error) {
      this.fallback(error);
    }
  }

  requestJump(): boolean {
    if (!this.isAuthoritative()) return false;
    this.jumpRequested = true;
    return true;
  }

  setSuspended(value: boolean): void {
    this.suspended = value;
    if (value) this.synchronizeToExternal(true);
  }

  invalidateStaticEnvironment(): void {
    this.refreshElapsed = Infinity;
  }

  /** Atomically cross a world boundary. Transient physics from the prior
   * context is retired before terrain and colliders are rebuilt for the next. */
  switchContext(contextId: string, position?: PhysicsVector3): void {
    const next = String(contextId || "hub").slice(0, 128) || "hub";
    if (next !== this.activeContext) {
      for (const id of [...this.dynamicBoxes.keys()]) this.removeDynamicBox(id, true);
      this.clearKinematicBoxes();
      this.activeContext = next;
      this.lastRefreshPosition = null;
    }
    this.teleport(position ?? this.options.getPlayerPosition());
    this.invalidateStaticEnvironment();
  }

  launchDynamicBox(spec: DynamicBoxLaunch): boolean {
    if (!this.isRuntimeReady() || !this.world || !this.rapier) return false;
    if (
      !spec?.id ||
      this.dynamicBoxes.has(spec.id) ||
      this.dynamicBoxes.size >= MAX_DYNAMIC_BOXES ||
      !validDynamicBox(spec)
    ) return false;
    try {
      const half = {
        x: clamp(spec.halfExtents.x, 0.025, 8),
        y: clamp(spec.halfExtents.y, 0.025, 8),
        z: clamp(spec.halfExtents.z, 0.025, 8),
      };
      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.dynamic()
          .setTranslation(spec.center.x, spec.center.y, spec.center.z)
          .setRotation(spec.rotation)
          .setLinvel(
            spec.linearVelocity.x,
            spec.linearVelocity.y,
            spec.linearVelocity.z,
          )
          .setAngvel(spec.angularVelocity ?? { x: 4.2, y: 1.1, z: 2.4 })
          .setCcdEnabled(true)
          .setCanSleep(true),
      );
      const collider = this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(half.x, half.y, half.z)
          .setDensity(clamp(spec.density ?? 1, 0.1, 25))
          .setRestitution(clamp(spec.restitution ?? 0.18, 0, 0.8))
          .setFriction(clamp(spec.friction ?? 0.72, 0, 2)),
        body,
      );
      this.dynamicBoxes.set(spec.id, {
        body,
        collider,
        age: 0,
        onPose: spec.onPose,
      });
      this.invalidateStaticEnvironment();
      return true;
    } catch {
      this.removeDynamicBox(spec.id, false);
      return false;
    }
  }

  removeDynamicBox(id: string, settle = false): boolean {
    const record = this.dynamicBoxes.get(id);
    if (!record || !this.world) return false;
    this.dynamicBoxes.delete(id);
    const position = cloneVector(record.body.translation());
    const rotation = cloneQuaternion(record.body.rotation());
    try { this.world.removeRigidBody(record.body); } catch {}
    if (settle) {
      try { record.onPose(position, rotation, true); } catch {}
    }
    this.invalidateStaticEnvironment();
    return true;
  }

  syncKinematicBoxes(specs: readonly StaticBoxCollider[]): boolean {
    if (!this.isRuntimeReady() || !this.world || !this.rapier) {
      this.clearKinematicBoxes();
      return false;
    }
    const live = new Set<string>();
    for (const spec of specs.slice(0, 192)) {
      if (!validStaticBox(spec)) continue;
      live.add(spec.id);
      const signature = [
        round(spec.halfExtents.x),
        round(spec.halfExtents.y),
        round(spec.halfExtents.z),
      ].join(":");
      let record = this.kinematicBoxes.get(spec.id);
      if (!record || record.signature !== signature) {
        if (record) {
          try { this.world.removeRigidBody(record.body); } catch {}
          this.kinematicBoxes.delete(spec.id);
        }
        const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(spec.center.x, spec.center.y, spec.center.z)
            .setRotation(spec.rotation ?? { x: 0, y: 0, z: 0, w: 1 }),
        );
        const collider = this.world.createCollider(
          this.rapier.ColliderDesc.cuboid(
            clamp(spec.halfExtents.x, MIN_HALF_EXTENT, MAX_HALF_EXTENT),
            clamp(spec.halfExtents.y, MIN_HALF_EXTENT, MAX_HALF_EXTENT),
            clamp(spec.halfExtents.z, MIN_HALF_EXTENT, MAX_HALF_EXTENT),
          )
            .setFriction(clamp(spec.friction ?? 0.8, 0, 2))
            .setRestitution(0),
          body,
        );
        record = { body, collider, signature };
        this.kinematicBoxes.set(spec.id, record);
        this.invalidateStaticEnvironment();
      }
      record.body.setNextKinematicTranslation(spec.center);
      record.body.setNextKinematicRotation(
        spec.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
      );
    }
    for (const id of [...this.kinematicBoxes.keys()]) {
      if (live.has(id)) continue;
      const record = this.kinematicBoxes.get(id);
      if (record) {
        try { this.world.removeRigidBody(record.body); } catch {}
      }
      this.kinematicBoxes.delete(id);
      this.invalidateStaticEnvironment();
    }
    return true;
  }

  sweepBox(request: BoxSweepRequest): BoxSweepResult | null {
    if (
      !this.isRuntimeReady() ||
      !this.world ||
      !this.rapier ||
      !validBoxSweep(request)
    ) return null;
    const translation = cloneVector(request.translation);
    if (vectorLengthSquared(translation) < 1e-12) {
      return { translation, blocked: false, timeOfImpact: null };
    }
    const half = {
      x: clamp(request.halfExtents.x, 0.05, 20),
      y: clamp(request.halfExtents.y, 0.05, 20),
      z: clamp(request.halfExtents.z, 0.05, 20),
    };
    const rotation = request.rotation && finiteQuaternion(request.rotation)
      ? request.rotation
      : { x: 0, y: 0, z: 0, w: 1 };
    const ignoredHandles = new Set<number>();
    if (this.terrainCollider) ignoredHandles.add(this.terrainCollider.handle);
    if (this.playerCollider) ignoredHandles.add(this.playerCollider.handle);
    for (const record of this.dynamicBoxes.values()) {
      ignoredHandles.add(record.collider.handle);
    }
    const shape = new this.rapier.Cuboid(half.x, half.y, half.z);
    const hit = this.world.castShape(
      request.center,
      rotation,
      translation,
      shape,
      clamp(request.skin ?? 0.04, 0, 0.25),
      1,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider: { handle: number }) => !ignoredHandles.has(collider.handle),
    );
    if (!hit) {
      return { translation, blocked: false, timeOfImpact: null };
    }
    const timeOfImpact = clamp(hit.time_of_impact, 0, 1);
    const safeFraction = Math.max(0, timeOfImpact - 0.015);
    return {
      translation: {
        x: translation.x * safeFraction,
        y: translation.y * safeFraction,
        z: translation.z * safeFraction,
      },
      blocked: true,
      timeOfImpact,
    };
  }

  tick(deltaSeconds: number): EngineFrame | null {
    if (this.status !== "ready") return null;
    if (
      !Number.isFinite(deltaSeconds) ||
      deltaSeconds < 0 ||
      deltaSeconds > 0.2
    ) {
      this.fallback(new Error(`invalid frame delta ${deltaSeconds}`));
      return null;
    }
    try {
      const frame = this.clock.advance(
        (this.clock.snapshot().lastNowMs as number) + deltaSeconds * 1000,
      );
      this.frameCount++;
      if (this.suspended) {
        this.synchronizeToExternal(true);
        this.refreshElapsed += frame.deltaSeconds;
        const external = finiteVector(this.options.getPlayerPosition());
        if (this.environmentNeedsRefresh(external)) {
          this.rebuildEnvironment(external);
        }
        for (let index = 0; index < frame.fixedSteps; index++) {
          this.stepWorldOnly(frame.fixedDeltaSeconds);
          this.fixedStepCount++;
        }
        return frame;
      }

      this.synchronizeToExternal(this.mode === "shadow");
      this.refreshElapsed += frame.deltaSeconds;
      const external = finiteVector(this.options.getPlayerPosition());
      if (this.environmentNeedsRefresh(external)) {
        this.rebuildEnvironment(external);
      }

      if (this.jumpRequested) {
        this.jumpBuffer = JUMP_BUFFER_SECONDS;
        this.jumpRequested = false;
      }
      for (let index = 0; index < frame.fixedSteps; index++) {
        this.stepFixed(frame.fixedDeltaSeconds);
        this.fixedStepCount++;
      }
      this.publishPosition(frame.interpolationAlpha);
      return frame;
    } catch (error) {
      this.fallback(error);
      return null;
    }
  }

  isAuthoritative(): boolean {
    return (
      this.isCandidateReady() &&
      !this.suspended
    );
  }

  teleport(position: PhysicsVector3): void {
    if (this.status !== "ready" || !this.body) return;
    const cameraPosition = finiteVector(position);
    const center = cameraToBodyCenter(
      cameraPosition,
      this.options.eyeHeight,
      this.options.playerRadius,
    );
    this.body.setTranslation(center, true);
    this.body.setNextKinematicTranslation(center);
    this.verticalVelocity = 0;
    this.grounded = false;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.lastPosition = cloneVector(cameraPosition);
    this.refreshElapsed = Infinity;
  }

  snapshot(): OperationalPhysicsSnapshot {
    const clock = this.clock.snapshot();
    return Object.freeze({
      build: OPERATIONAL_PHYSICS_CANARY_BUILD,
      mode: this.mode,
      status: this.status,
      authoritative: this.isAuthoritative(),
      rapierVersion: this.rapierVersion,
      frames: this.frameCount,
      fixedSteps: this.fixedStepCount,
      staticColliders: this.staticColliders.length,
      dynamicBoxes: this.dynamicBoxes.size,
      kinematicBoxes: this.kinematicBoxes.size,
      terrainSamples: this.terrainSamples,
      grounded: this.grounded,
      verticalVelocity: round(this.verticalVelocity),
      droppedSeconds: Number(clock.droppedSeconds ?? 0),
      fallbackReason: this.fallbackReason,
      position: this.lastPosition
        ? Object.freeze(cloneVector(this.lastPosition))
        : null,
      activeContext: this.activeContext,
    });
  }

  dispose(): void {
    if (this.status === "disposed") return;
    try {
      this.controller?.free();
    } catch {}
    try {
      this.world?.free();
    } catch {}
    this.controller = null;
    this.playerCollider = null;
    this.body = null;
    this.world = null;
    this.rapier = null;
    this.staticColliders.length = 0;
    this.dynamicBoxes.clear();
    this.kinematicBoxes.clear();
    this.terrainCollider = null;
    this.status = "disposed";
  }

  private stepFixed(dt: number): void {
    if (
      !this.world ||
      !this.body ||
      !this.playerCollider ||
      !this.controller
    ) {
      throw new Error("Rapier character runtime is incomplete");
    }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.grounded
      ? COYOTE_SECONDS
      : Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.verticalVelocity = JUMP_SPEED;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
    }

    const input = this.options.getMovementInput();
    const basis = sanitizeBasis(this.options.getPlanarBasis());
    const localX = Number(input.right) - Number(input.left);
    const localZ = Number(input.forward) - Number(input.back);
    const localLength = Math.hypot(localX, localZ);
    const normalizedX = localLength > 1 ? localX / localLength : localX;
    const normalizedZ = localLength > 1 ? localZ / localLength : localZ;
    const speed = input.run ? RUN_SPEED : WALK_SPEED;
    const horizontalX =
      (basis.right.x * normalizedX + basis.forward.x * normalizedZ) *
      speed *
      dt;
    const horizontalZ =
      (basis.right.z * normalizedX + basis.forward.z * normalizedZ) *
      speed *
      dt;

    const priorVertical = this.verticalVelocity;
    this.verticalVelocity = Math.max(
      -TERMINAL_VELOCITY,
      this.verticalVelocity - GRAVITY * dt,
    );
    const desired = {
      x: horizontalX,
      y: this.verticalVelocity * dt,
      z: horizontalZ,
    };
    // Bound traversal before collision resolution. Post-step teleports reset
    // grounding and rebuild terrain continuously when holding against a shore.
    if(this.options.constrainHorizontalStep){
      const center=this.body.translation();
      const step=this.options.constrainHorizontalStep(center,desired.x,desired.z);
      if(!Number.isFinite(step.x)||!Number.isFinite(step.z)||Math.hypot(step.x,step.z)>Math.hypot(desired.x,desired.z)+1e-7)
        throw new Error('invalid horizontal constraint');
      desired.x=step.x;desired.z=step.z;
    }
    this.controller.computeColliderMovement(this.playerCollider, desired);
    const corrected = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.verticalVelocity < 0) this.verticalVelocity = 0;
    if (wasGrounded && !this.grounded) this.coyote = COYOTE_SECONDS;
    if (!wasGrounded && this.grounded && priorVertical < 0) {
      this.verticalVelocity = 0;
    }

    const current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + corrected.x,
      y: current.y + corrected.y,
      z: current.z + corrected.z,
    });
    this.world.timestep = dt;
    this.world.step();
    this.publishDynamicBoxes(dt);
  }

  private publishPosition(_alpha: number): void {
    if (!this.body) return;
    const cameraPosition = bodyCenterToCamera(
      this.body.translation(),
      this.options.eyeHeight,
      this.options.playerRadius,
    );
    this.lastPosition = cameraPosition;
    if (this.isAuthoritative()) this.options.setPlayerPosition(cameraPosition);
  }

  private stepWorldOnly(dt: number): void {
    if (!this.world) return;
    this.world.timestep = dt;
    this.world.step();
    this.publishDynamicBoxes(dt);
  }

  private synchronizeToExternal(force: boolean): void {
    if (!this.body) return;
    const external = finiteVector(this.options.getPlayerPosition());
    const current = bodyCenterToCamera(
      this.body.translation(),
      this.options.eyeHeight,
      this.options.playerRadius,
    );
    if (force || distanceSquared(external, current) > TELEPORT_DISTANCE ** 2) {
      this.teleport(external);
    }
  }

  private environmentNeedsRefresh(position: PhysicsVector3): boolean {
    if (!this.lastRefreshPosition) return true;
    return (
      this.refreshElapsed >= STATIC_REFRESH_SECONDS ||
      distanceSquared(position, this.lastRefreshPosition) >=
        STATIC_REFRESH_DISTANCE ** 2
    );
  }

  private rebuildEnvironment(position: PhysicsVector3): void {
    if (!this.world || !this.rapier) return;
    for (const collider of this.staticColliders) {
      this.world.removeCollider(collider, false);
    }
    this.staticColliders.length = 0;
    if (this.terrainCollider) {
      this.world.removeCollider(this.terrainCollider, false);
      this.terrainCollider = null;
    }

    this.buildTerrainCollider(position);
    const radius = this.options.staticRadius ?? 52;
    const limit = this.options.maxStaticColliders ?? 640;
    const boxes = this.options
      .collectStaticColliders(position, radius)
      .filter(validStaticBox)
      // Keep nearby floors/walls even when their centres are farther away than
      // hundreds of small furniture parts. Compute each oriented distance once.
      .map(box => ({box,distance:staticColliderDistanceSquared(box,position)}))
      .sort((left,right)=>left.distance-right.distance)
      .slice(0, limit)
      .map(entry=>entry.box);
    for (const box of boxes) {
      const half = {
        x: clamp(box.halfExtents.x, MIN_HALF_EXTENT, MAX_HALF_EXTENT),
        y: clamp(box.halfExtents.y, MIN_HALF_EXTENT, MAX_HALF_EXTENT),
        z: clamp(box.halfExtents.z, MIN_HALF_EXTENT, MAX_HALF_EXTENT),
      };
      let desc = this.rapier.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setTranslation(box.center.x, box.center.y, box.center.z)
        .setFriction(clamp(box.friction ?? 0.8, 0, 2))
        .setRestitution(0);
      if (box.rotation && finiteQuaternion(box.rotation)) {
        desc = desc.setRotation(box.rotation);
      }
      this.staticColliders.push(this.world.createCollider(desc));
    }
    this.lastRefreshPosition = cloneVector(position);
    this.refreshElapsed = 0;
  }

  private buildTerrainCollider(position: PhysicsVector3): void {
    if (!this.world || !this.rapier) return;
    const divisions = TERRAIN_SUBDIVISIONS;
    const vertices = divisions + 1;
    const centerX =
      Math.round(position.x / (TERRAIN_PATCH_SIZE / 4)) *
      (TERRAIN_PATCH_SIZE / 4);
    const centerZ =
      Math.round(position.z / (TERRAIN_PATCH_SIZE / 4)) *
      (TERRAIN_PATCH_SIZE / 4);
    const heights = new Float32Array(vertices * vertices);
    for (let column = 0; column < vertices; column++) {
      for (let row = 0; row < vertices; row++) {
        const x =
          centerX -
          TERRAIN_PATCH_SIZE / 2 +
          (row / divisions) * TERRAIN_PATCH_SIZE;
        const z =
          centerZ -
          TERRAIN_PATCH_SIZE / 2 +
          (column / divisions) * TERRAIN_PATCH_SIZE;
        const sampled = this.options.getTerrainHeight(x, z);
        // Rapier's column-major height matrix has Z rows and X columns.
        // Here `row` samples X and `column` samples Z; transpose the storage
        // indices, not the terrain coordinates, to match rendered terrain.
        heights[row * vertices + column] = Number.isFinite(sampled)
          ? Math.max(-4, Math.min(80, sampled))
          : 0;
      }
    }
    const desc = this.rapier.ColliderDesc.heightfield(
      divisions,
      divisions,
      heights,
      { x: TERRAIN_PATCH_SIZE, y: 1, z: TERRAIN_PATCH_SIZE },
    )
      .setTranslation(centerX, 0, centerZ)
      .setFriction(0.9)
      .setRestitution(0);
    this.terrainCollider = this.world.createCollider(desc);
    this.terrainSamples = heights.length;
  }

  private publishDynamicBoxes(dt: number): void {
    for (const [id, record] of [...this.dynamicBoxes]) {
      record.age += dt;
      const position = cloneVector(record.body.translation());
      const rotation = cloneQuaternion(record.body.rotation());
      const settled =
        (record.age > 0.35 && record.body.isSleeping()) ||
        record.age >= MAX_DYNAMIC_AGE_SECONDS ||
        position.y < -20;
      try { record.onPose(position, rotation, settled); } catch {}
      if (settled) this.removeDynamicBox(id, false);
    }
  }

  private fallback(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.fallbackReason = message || "unknown physics failure";
    this.status = "fallback";
    this.suspended = true;
    try {
      this.options.onFallback?.(this.fallbackReason);
    } catch {}
  }

  private isDisposed(): boolean {
    return this.status === "disposed";
  }

  private isCandidateReady(): boolean {
    return this.mode === "candidate" && this.status === "ready";
  }

  private isRuntimeReady(): boolean {
    return this.mode !== "off" && this.status === "ready";
  }

  private clearKinematicBoxes(): void {
    if (!this.world || this.kinematicBoxes.size === 0) return;
    for (const record of this.kinematicBoxes.values()) {
      try { this.world.removeRigidBody(record.body); } catch {}
    }
    this.kinematicBoxes.clear();
    this.invalidateStaticEnvironment();
  }
}

export function createOperationalPhysicsCanary(
  options: OperationalPhysicsCanaryOptions,
): OperationalPhysicsCanary {
  const canary = new OperationalPhysicsCanary(options);
  void canary.init();
  return canary;
}

function cameraToBodyCenter(
  camera: PhysicsVector3,
  eyeHeight: number,
  radius: number,
): PhysicsVector3 {
  const centerHeight = eyeHeight / 2;
  if (centerHeight < radius) {
    throw new Error("eye height must be at least twice the player radius");
  }
  return { x: camera.x, y: camera.y - centerHeight, z: camera.z };
}

function bodyCenterToCamera(
  center: PhysicsVector3,
  eyeHeight: number,
  _radius: number,
): PhysicsVector3 {
  return { x: center.x, y: center.y + eyeHeight / 2, z: center.z };
}

function sanitizeBasis(value: CharacterPlanarBasis): CharacterPlanarBasis {
  const forward = normalizePlanar(value.forward, { x: 0, y: 0, z: -1 });
  const right = normalizePlanar(value.right, { x: 1, y: 0, z: 0 });
  return { forward, right };
}

function normalizePlanar(
  value: PhysicsVector3,
  fallback: PhysicsVector3,
): PhysicsVector3 {
  const x = Number(value?.x);
  const z = Number(value?.z);
  const length = Math.hypot(x, z);
  if (!Number.isFinite(length) || length < 1e-6) return cloneVector(fallback);
  return { x: x / length, y: 0, z: z / length };
}

function validStaticBox(value: StaticBoxCollider): boolean {
  return (
    !!value?.id &&
    finiteVectorOrFalse(value.center) &&
    finiteVectorOrFalse(value.halfExtents) &&
    value.halfExtents.x > 0 &&
    value.halfExtents.y > 0 &&
    value.halfExtents.z > 0
  );
}

function finiteVector(value: PhysicsVector3): PhysicsVector3 {
  if (!finiteVectorOrFalse(value)) {
    throw new Error("position must contain finite x/y/z");
  }
  return cloneVector(value);
}

function finiteVectorOrFalse(
  value: PhysicsVector3 | null | undefined,
): value is PhysicsVector3 {
  return (
    !!value &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  );
}

function finiteQuaternion(value: PhysicsQuaternion): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z) &&
    Number.isFinite(value.w)
  );
}

function validDynamicBox(value: DynamicBoxLaunch): boolean {
  return (
    finiteVectorOrFalse(value.center) &&
    finiteVectorOrFalse(value.halfExtents) &&
    finiteVectorOrFalse(value.linearVelocity) &&
    finiteQuaternion(value.rotation) &&
    value.halfExtents.x > 0 &&
    value.halfExtents.y > 0 &&
    value.halfExtents.z > 0 &&
    typeof value.onPose === "function"
  );
}

function validBoxSweep(value: BoxSweepRequest): boolean {
  return Boolean(
    value &&
    finiteVectorOrFalse(value.center) &&
    finiteVectorOrFalse(value.halfExtents) &&
    finiteVectorOrFalse(value.translation) &&
    value.halfExtents.x > 0 &&
    value.halfExtents.y > 0 &&
    value.halfExtents.z > 0,
  );
}

function vectorLengthSquared(value: PhysicsVector3): number {
  return value.x * value.x + value.y * value.y + value.z * value.z;
}

function cloneVector(value: PhysicsVector3): PhysicsVector3 {
  return { x: value.x, y: value.y, z: value.z };
}

function cloneQuaternion(value: PhysicsQuaternion): PhysicsQuaternion {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}

function distanceSquared(
  left: PhysicsVector3,
  right: PhysicsVector3,
): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return dx * dx + dy * dy + dz * dz;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
