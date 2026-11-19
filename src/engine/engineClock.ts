export type SchedulerMode = "legacy-frame-tiers" | "fixed-time-tiers";

export interface EngineClockConfig {
  fixedHz: number;
  maxCatchUpSteps: number;
  maxFrameSeconds: number;
  tier30Hz: number;
  tier10Hz: number;
  tier1Hz: number;
  schedulerMode: SchedulerMode;
}

export interface EngineFrame {
  frame: number;
  nowMs: number;
  rawDeltaSeconds: number;
  deltaSeconds: number;
  fixedDeltaSeconds: number;
  fixedSteps: number;
  interpolationAlpha: number;
  tier30: boolean;
  tier10: boolean;
  tier1: boolean;
  paused: boolean;
  contextLost: boolean;
  droppedSeconds: number;
}

export const DEFAULT_ENGINE_CLOCK_CONFIG: Readonly<EngineClockConfig> = Object.freeze({
  fixedHz: 60,
  maxCatchUpSteps: 5,
  maxFrameSeconds: 0.1,
  tier30Hz: 30,
  tier10Hz: 10,
  tier1Hz: 1,
  schedulerMode: "legacy-frame-tiers",
});

export class EngineClock {
  readonly config: Readonly<EngineClockConfig>;
  private lastNowMs: number | null = null;
  private accumulator = 0;
  private frameCounter = 0;
  private paused = false;
  private contextLost = false;
  private droppedSeconds = 0;
  private tierElapsed = { thirty: 0, ten: 0, one: 0 };

  constructor(config: Partial<EngineClockConfig> = {}) {
    this.config = Object.freeze({ ...DEFAULT_ENGINE_CLOCK_CONFIG, ...config });
    if (!Number.isFinite(this.config.fixedHz) || this.config.fixedHz <= 0) throw new Error("fixedHz must be positive");
    if (!Number.isInteger(this.config.maxCatchUpSteps) || this.config.maxCatchUpSteps < 1) throw new Error("maxCatchUpSteps must be a positive integer");
  }

  reset(nowMs: number | null = null): void {
    this.lastNowMs = nowMs;
    this.accumulator = 0;
    this.frameCounter = 0;
    this.droppedSeconds = 0;
    this.tierElapsed = { thirty: 0, ten: 0, one: 0 };
  }

  setPaused(value: boolean, nowMs?: number): void {
    this.paused = value;
    if (!value && Number.isFinite(nowMs)) this.lastNowMs = nowMs!;
  }

  setContextLost(value: boolean, nowMs?: number): void {
    this.contextLost = value;
    if (!value && Number.isFinite(nowMs)) this.lastNowMs = nowMs!;
  }

  advance(nowMs: number): EngineFrame {
    if (!Number.isFinite(nowMs)) throw new Error("nowMs must be finite");
    const fixedDeltaSeconds = 1 / this.config.fixedHz;
    if (this.lastNowMs === null) {
      this.lastNowMs = nowMs;
      return this.makeFrame(nowMs, 0, 0, fixedDeltaSeconds, 0, false, false, false);
    }

    const rawDeltaSeconds = Math.max(0, (nowMs - this.lastNowMs) / 1000);
    this.lastNowMs = nowMs;
    if (this.paused || this.contextLost) return this.makeFrame(nowMs, rawDeltaSeconds, 0, fixedDeltaSeconds, 0, false, false, false);

    const deltaSeconds = Math.min(rawDeltaSeconds, this.config.maxFrameSeconds);
    this.droppedSeconds += Math.max(0, rawDeltaSeconds - deltaSeconds);
    this.accumulator += deltaSeconds;

    const availableSteps = Math.floor((this.accumulator + 1e-12) / fixedDeltaSeconds);
    const fixedSteps = Math.min(availableSteps, this.config.maxCatchUpSteps);
    this.accumulator -= fixedSteps * fixedDeltaSeconds;
    if (availableSteps > this.config.maxCatchUpSteps) {
      const overflow = this.accumulator - (this.accumulator % fixedDeltaSeconds);
      this.droppedSeconds += Math.max(0, overflow);
      this.accumulator %= fixedDeltaSeconds;
    }

    this.frameCounter = (this.frameCounter + 1) | 0;
    let tier30 = false;
    let tier10 = false;
    let tier1 = false;
    if (this.config.schedulerMode === "legacy-frame-tiers") {
      tier30 = (this.frameCounter & 1) === 0;
      tier10 = (this.frameCounter % 6) === 0;
      tier1 = (this.frameCounter % 60) === 0;
    } else {
      this.tierElapsed.thirty += deltaSeconds;
      this.tierElapsed.ten += deltaSeconds;
      this.tierElapsed.one += deltaSeconds;
      [tier30, this.tierElapsed.thirty] = consumeTier(this.tierElapsed.thirty, 1 / this.config.tier30Hz);
      [tier10, this.tierElapsed.ten] = consumeTier(this.tierElapsed.ten, 1 / this.config.tier10Hz);
      [tier1, this.tierElapsed.one] = consumeTier(this.tierElapsed.one, 1 / this.config.tier1Hz);
    }
    return this.makeFrame(nowMs, rawDeltaSeconds, deltaSeconds, fixedDeltaSeconds, fixedSteps, tier30, tier10, tier1);
  }

  snapshot(): Readonly<Record<string, number | boolean | string | null>> {
    return Object.freeze({
      schedulerMode: this.config.schedulerMode,
      fixedHz: this.config.fixedHz,
      maxCatchUpSteps: this.config.maxCatchUpSteps,
      frame: this.frameCounter,
      accumulatorSeconds: round(this.accumulator),
      droppedSeconds: round(this.droppedSeconds),
      paused: this.paused,
      contextLost: this.contextLost,
      lastNowMs: this.lastNowMs,
    });
  }

  private makeFrame(nowMs: number, rawDeltaSeconds: number, deltaSeconds: number, fixedDeltaSeconds: number, fixedSteps: number, tier30: boolean, tier10: boolean, tier1: boolean): EngineFrame {
    return Object.freeze({
      frame: this.frameCounter,
      nowMs,
      rawDeltaSeconds,
      deltaSeconds,
      fixedDeltaSeconds,
      fixedSteps,
      interpolationAlpha: fixedDeltaSeconds ? this.accumulator / fixedDeltaSeconds : 0,
      tier30,
      tier10,
      tier1,
      paused: this.paused,
      contextLost: this.contextLost,
      droppedSeconds: this.droppedSeconds,
    });
  }
}

function consumeTier(elapsed: number, interval: number): [boolean, number] {
  if (elapsed + 1e-12 < interval) return [false, elapsed];
  // Subtract the crossed interval directly. `% interval` is unsafe here:
  // a value infinitesimally below the boundary is admitted by the epsilon,
  // but modulo would preserve almost the whole interval and fire again on
  // the next frame. Clamp the tiny negative residue to zero instead.
  return [true, Math.max(0, elapsed - interval)];
}

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
