import { describe, expect, it } from "vitest";
import {
  OperationalPhysicsCanary,
  operationalPhysicsModeFromSearch,
  type CharacterMovementInput,
  type PhysicsVector3,
  type StaticBoxCollider,
} from "../src/engine/operationalPhysicsCanary";

interface Harness {
  canary: OperationalPhysicsCanary;
  input: CharacterMovementInput;
  position: PhysicsVector3;
  fallbackReasons: string[];
}

function harness(
  mode: "off" | "shadow" | "candidate" = "candidate",
  colliders: readonly StaticBoxCollider[] = [],
): Harness {
  const state: Harness = {
    canary: null as unknown as OperationalPhysicsCanary,
    input: {
      forward: false,
      back: false,
      left: false,
      right: false,
      run: false,
    },
    position: { x: 0, y: 1.7, z: 0 },
    fallbackReasons: [],
  };
  state.canary = new OperationalPhysicsCanary({
    mode,
    eyeHeight: 1.7,
    playerRadius: 0.4,
    getPlayerPosition: () => state.position,
    setPlayerPosition: (position) => {
      state.position = { ...position };
    },
    getMovementInput: () => state.input,
    getPlanarBasis: () => ({
      forward: { x: 0, y: 0, z: -1 },
      right: { x: 1, y: 0, z: 0 },
    }),
    getTerrainHeight: () => 0,
    collectStaticColliders: () => colliders,
    onFallback: (reason) => state.fallbackReasons.push(reason),
  });
  return state;
}

async function advance(
  state: Harness,
  seconds: number,
  frameHz = 60,
): Promise<void> {
  const frames = Math.round(seconds * frameHz);
  for (let frame = 0; frame < frames; frame++) {
    state.canary.tick(1 / frameHz);
  }
}

describe("operational Rapier physics canary", () => {
  it("defaults to candidate while preserving an explicit shadow rollback", () => {
    expect(operationalPhysicsModeFromSearch("?engine.canary=candidate")).toBe(
      "candidate",
    );
    expect(operationalPhysicsModeFromSearch("?engine.physics=shadow")).toBe(
      "shadow",
    );
    expect(operationalPhysicsModeFromSearch("?engine.canary=legacy")).toBe(
      "candidate",
    );
    expect(operationalPhysicsModeFromSearch("")).toBe("candidate");
  });

  it("loads real Rapier, settles onto terrain, and blocks a wall", async () => {
    const state = harness("candidate", [
      {
        id: "wall",
        center: { x: 0, y: 1.5, z: -2 },
        halfExtents: { x: 3, y: 1.5, z: 0.1 },
      },
    ]);
    await state.canary.init();
    state.input.forward = true;
    await advance(state, 2);

    const snapshot = state.canary.snapshot();
    expect(snapshot.status).toBe("ready");
    expect(snapshot.rapierVersion).toMatch(/^0\.19\./);
    expect(snapshot.staticColliders).toBe(1);
    expect(snapshot.terrainSamples).toBe(625);
    expect(state.position.y).toBeCloseTo(1.7, 1);
    expect(state.position.z).toBeGreaterThan(-1.55);
    expect(snapshot.grounded).toBe(true);
    state.canary.dispose();
  });

  it("uses fixed steps so equivalent elapsed time is frame-rate stable", async () => {
    const sixty = harness();
    const thirty = harness();
    await Promise.all([sixty.canary.init(), thirty.canary.init()]);
    sixty.input.right = true;
    thirty.input.right = true;
    await advance(sixty, 1.5, 60);
    await advance(thirty, 1.5, 30);

    expect(sixty.position.x).toBeCloseTo(thirty.position.x, 3);
    expect(sixty.position.y).toBeCloseTo(thirty.position.y, 3);
    expect(sixty.canary.snapshot().fixedSteps).toBe(
      thirty.canary.snapshot().fixedSteps,
    );
    sixty.canary.dispose();
    thirty.canary.dispose();
  });

  it("honors an explicit external teleport even below the drift threshold", async () => {
    const state = harness();
    await state.canary.init();
    await advance(state, 0.25);

    state.position = { x: 4, y: 1.7, z: -3 };
    state.canary.teleport(state.position);
    await advance(state, 0.1);

    expect(state.position.x).toBeCloseTo(4, 3);
    expect(state.position.z).toBeCloseTo(-3, 3);
    expect(state.canary.snapshot().position?.x).toBeCloseTo(4, 3);
    state.canary.dispose();
  });

  it("walks up player-scale stairs using the operational controller", async () => {
    const stairs: StaticBoxCollider[] = Array.from({ length: 8 }, (_, index) => {
      const height = (index + 1) * 0.22;
      return {
        id: `stair:${index}`,
        center: { x: 0, y: height / 2, z: -0.72 - index * 0.42 },
        halfExtents: { x: 1.2, y: height / 2, z: 0.22 },
      };
    });
    const state = harness("candidate", stairs);
    await state.canary.init();
    state.input.forward = true;
    await advance(state, 1.25);

    expect(state.position.z).toBeLessThan(-3.1);
    // The controller has climbed more than five 22 cm risers; the exact final
    // interpolation height is intentionally not coupled to Rapier internals.
    expect(state.position.y).toBeGreaterThan(2.8);
    expect(state.canary.snapshot().status).toBe("ready");
    state.canary.dispose();
  });

  it("supports jump and automatically falls back on an invalid frame", async () => {
    const state = harness();
    await state.canary.init();
    await advance(state, 0.5);
    const groundedY = state.position.y;
    expect(state.canary.requestJump()).toBe(true);
    await advance(state, 0.2);
    expect(state.position.y).toBeGreaterThan(groundedY + 0.25);

    state.canary.tick(Number.NaN);
    expect(state.canary.snapshot().status).toBe("fallback");
    expect(state.canary.isAuthoritative()).toBe(false);
    expect(state.fallbackReasons[0]).toContain("invalid frame delta");
    state.canary.dispose();
  });

  it("simulates thrown boxes in the same terrain world and settles them", async () => {
    const state = harness();
    await state.canary.init();
    const poses: Array<{ position: PhysicsVector3; settled: boolean }> = [];
    expect(state.canary.launchDynamicBox({
      id: "throw:clay-ball",
      center: { x: 0, y: 3, z: 0 },
      halfExtents: { x: 0.15, y: 0.15, z: 0.15 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linearVelocity: { x: 3, y: 3, z: -2 },
      onPose: (position, _rotation, settled) => {
        poses.push({ position: { ...position }, settled });
      },
    })).toBe(true);

    await advance(state, 8.2);
    expect(poses.length).toBeGreaterThan(10);
    expect(poses.some((pose) => pose.position.x > 0.8)).toBe(true);
    expect(poses.at(-1)?.settled).toBe(true);
    expect(state.canary.snapshot().dynamicBoxes).toBe(0);
    state.canary.dispose();
  });

  it("updates moving door colliders without leaving a closed ghost wall", async () => {
    const state = harness();
    await state.canary.init();
    const closedDoor: StaticBoxCollider = {
      id: "door:panel",
      center: { x: 0, y: 1.4, z: -2 },
      halfExtents: { x: 2, y: 1.4, z: 0.12 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    };
    expect(state.canary.syncKinematicBoxes([closedDoor])).toBe(true);
    state.input.forward = true;
    await advance(state, 1.5);
    expect(state.position.z).toBeGreaterThan(-1.55);
    expect(state.canary.snapshot().kinematicBoxes).toBe(1);

    expect(state.canary.syncKinematicBoxes([{
      ...closedDoor,
      center: { x: 3, y: 1.4, z: -2 },
    }])).toBe(true);
    await advance(state, 1.5);
    expect(state.position.z).toBeLessThan(-3);
    state.canary.dispose();
  });

  it("keeps world physics active while character movement is suspended", async () => {
    const state = harness();
    await state.canary.init();
    state.canary.setSuspended(true);
    expect(state.canary.isAuthoritative()).toBe(false);
    expect(state.canary.syncKinematicBoxes([{
      id: "driving:door",
      center: { x: 0, y: 1, z: -2 },
      halfExtents: { x: 1, y: 1, z: 0.1 },
    }])).toBe(true);
    expect(state.canary.launchDynamicBox({
      id: "driving:throw",
      center: { x: 0, y: 2, z: 0 },
      halfExtents: { x: 0.1, y: 0.1, z: 0.1 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linearVelocity: { x: 1, y: 1, z: 0 },
      onPose: () => {},
    })).toBe(true);
    expect(state.canary.snapshot().kinematicBoxes).toBe(1);
    expect(state.canary.snapshot().dynamicBoxes).toBe(1);
    state.canary.dispose();
  });

  it("retires transient bodies when crossing an isolated world context", async () => {
    const state = harness();
    await state.canary.init();
    expect(state.canary.launchDynamicBox({
      id: "context-box",
      center: { x: 0, y: 3, z: 0 },
      halfExtents: { x: 0.2, y: 0.2, z: 0.2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linearVelocity: { x: 1, y: 0, z: 0 },
      onPose: () => {},
    })).toBe(true);
    expect(state.canary.snapshot().dynamicBoxes).toBe(1);
    state.canary.switchContext("dim-race", { x: 5, y: 1.7, z: 7 });
    await advance(state, 0.1);
    expect(state.canary.snapshot().activeContext).toBe("dim-race");
    expect(state.canary.snapshot().dynamicBoxes).toBe(0);
    expect(state.position.x).toBeCloseTo(5, 2);
    expect(state.position.z).toBeCloseTo(7, 2);
    state.canary.dispose();
  });

  it("sweeps a vehicle-sized box against static world geometry", async () => {
    const state = harness("candidate", [{
      id: "garage-wall",
      center: { x: 0, y: 1, z: -4 },
      halfExtents: { x: 4, y: 1, z: 0.2 },
    }]);
    await state.canary.init();
    state.canary.setSuspended(true);
    state.canary.tick(1 / 60);
    const result = state.canary.sweepBox({
      center: { x: 0, y: 1, z: 0 },
      halfExtents: { x: 1, y: 0.8, z: 2 },
      translation: { x: 0, y: 0, z: -4 },
    });
    expect(result).not.toBeNull();
    expect(result?.blocked).toBe(true);
    expect(result?.translation.z).toBeGreaterThan(-2);
    state.canary.dispose();
  });

  it("provides world interactions in shadow mode without owning the player", async () => {
    const state = harness("shadow", [{
      id: "parthenon-wall",
      center: { x: 0, y: 1, z: -4 },
      halfExtents: { x: 4, y: 1, z: 0.2 },
    }]);
    await state.canary.init();
    state.canary.tick(1 / 60);
    expect(state.canary.isAuthoritative()).toBe(false);
    expect(state.canary.sweepBox({
      center: { x: 0, y: 1, z: 0 },
      halfExtents: { x: 1, y: 0.8, z: 2 },
      translation: { x: 0, y: 0, z: -4 },
    })?.blocked).toBe(true);
    expect(state.canary.launchDynamicBox({
      id: "shadow:throw",
      center: { x: 0, y: 2, z: 0 },
      halfExtents: { x: 0.1, y: 0.1, z: 0.1 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linearVelocity: { x: 1, y: 1, z: 0 },
      onPose: () => {},
    })).toBe(true);
    state.canary.dispose();
  });
});
