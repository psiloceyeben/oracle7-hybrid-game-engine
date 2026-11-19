import type { EngineFrame } from "./engineClock.js";
import type { EngineSpec, RuntimeComponentKind } from "./contracts.js";
import { validateEngineSpec } from "./contracts.js";

export type LifecycleState = "created" | "active" | "sleeping" | "inactive" | "disposed";
export type AdapterCapability = "clock" | "physics" | "animation" | "navigation" | "audio" | "quality" | "diagnostics";
export type FeatureSelection = "off" | "shadow" | "candidate" | "legacy";

export interface RuntimeHandle {
  id: string;
  entityId: string;
  component: RuntimeComponentKind;
  generation: number;
}

export interface RuntimeComponent<TSpec extends EngineSpec = EngineSpec> {
  handle: RuntimeHandle;
  spec: TSpec;
  state: LifecycleState;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ComponentHooks<TSpec extends EngineSpec = EngineSpec> {
  activate?: (component: RuntimeComponent<TSpec>) => void;
  sleep?: (component: RuntimeComponent<TSpec>) => void;
  deactivate?: (component: RuntimeComponent<TSpec>) => void;
  dispose?: (component: RuntimeComponent<TSpec>) => void;
}

export interface RuntimeAdapter {
  id: string;
  capabilities: readonly AdapterCapability[];
  start?: () => void | Promise<void>;
  stop?: () => void | Promise<void>;
  tick?: (frame: EngineFrame) => void;
  dispose?: () => void | Promise<void>;
}

export interface AdapterInvocation {
  capability: AdapterCapability;
  selected: string | null;
  fallback: string | null;
  used: string | null;
  ok: boolean;
  error?: string;
}

const ALLOWED_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = Object.freeze({
  created: ["active", "inactive", "disposed"],
  active: ["sleeping", "inactive", "disposed"],
  sleeping: ["active", "inactive", "disposed"],
  inactive: ["active", "disposed"],
  disposed: [],
});

export class ComponentRegistry {
  private components = new Map<string, RuntimeComponent>();
  private generations = new Map<string, number>();
  private hooks = new Map<string, ComponentHooks>();
  private events: Array<{ atMs: number; handleId: string; from: LifecycleState | null; to: LifecycleState }> = [];

  create<TSpec extends EngineSpec>(spec: TSpec, hooks: ComponentHooks<TSpec> = {}, nowMs = performanceNow()): RuntimeComponent<TSpec> {
    const result = validateEngineSpec(spec);
    if (!result.ok) throw new Error(`invalid ${spec.kind} spec: ${result.errors.join("; ")}`);
    const componentKind = spec.kind === "quality" ? "render" : spec.kind;
    const base = `${spec.entityId}:${componentKind}`;
    const generation = (this.generations.get(base) ?? 0) + 1;
    this.generations.set(base, generation);
    const handle: RuntimeHandle = Object.freeze({ id: `${base}:${generation}`, entityId: spec.entityId, component: componentKind, generation });
    const component: RuntimeComponent<TSpec> = { handle, spec, state: "created", createdAtMs: nowMs, updatedAtMs: nowMs };
    this.components.set(handle.id, component as RuntimeComponent);
    this.hooks.set(handle.id, hooks as ComponentHooks);
    this.events.push({ atMs: nowMs, handleId: handle.id, from: null, to: "created" });
    if (this.events.length > 512) this.events.splice(0, this.events.length - 512);
    return component;
  }

  transition(handleOrId: RuntimeHandle | string, next: LifecycleState, nowMs = performanceNow()): RuntimeComponent {
    const id = typeof handleOrId === "string" ? handleOrId : handleOrId.id;
    const component = this.components.get(id);
    if (!component) throw new Error(`unknown runtime handle ${id}`);
    if (!ALLOWED_TRANSITIONS[component.state].includes(next)) throw new Error(`invalid lifecycle transition ${component.state} -> ${next}`);
    const previous = component.state;
    component.state = next;
    component.updatedAtMs = nowMs;
    const hooks = this.hooks.get(id);
    if (next === "active") hooks?.activate?.(component);
    else if (next === "sleeping") hooks?.sleep?.(component);
    else if (next === "inactive") hooks?.deactivate?.(component);
    else if (next === "disposed") {
      hooks?.dispose?.(component);
      this.hooks.delete(id);
    }
    this.events.push({ atMs: nowMs, handleId: id, from: previous, to: next });
    if (this.events.length > 512) this.events.splice(0, this.events.length - 512);
    return component;
  }

  activate(handleOrId: RuntimeHandle | string, nowMs?: number): RuntimeComponent { return this.transition(handleOrId, "active", nowMs); }
  sleep(handleOrId: RuntimeHandle | string, nowMs?: number): RuntimeComponent { return this.transition(handleOrId, "sleeping", nowMs); }
  deactivate(handleOrId: RuntimeHandle | string, nowMs?: number): RuntimeComponent { return this.transition(handleOrId, "inactive", nowMs); }
  dispose(handleOrId: RuntimeHandle | string, nowMs?: number): RuntimeComponent { return this.transition(handleOrId, "disposed", nowMs); }

  streamOut(entityId: string, nowMs = performanceNow()): number {
    let count = 0;
    for (const component of this.forEntity(entityId)) {
      if (component.state === "active" || component.state === "sleeping") { this.deactivate(component.handle, nowMs); count++; }
    }
    return count;
  }

  streamIn(entityId: string, nowMs = performanceNow()): number {
    let count = 0;
    for (const component of this.forEntity(entityId)) {
      if (component.state === "created" || component.state === "inactive") { this.activate(component.handle, nowMs); count++; }
    }
    return count;
  }

  disposeEntity(entityId: string, nowMs = performanceNow()): number {
    const list = this.forEntity(entityId).filter((component) => component.state !== "disposed").reverse();
    for (const component of list) this.dispose(component.handle, nowMs);
    return list.length;
  }

  removeDisposed(): number {
    let count = 0;
    for (const [id, component] of this.components) if (component.state === "disposed") { this.components.delete(id); count++; }
    return count;
  }

  get(handleOrId: RuntimeHandle | string): RuntimeComponent | undefined {
    return this.components.get(typeof handleOrId === "string" ? handleOrId : handleOrId.id);
  }

  forEntity(entityId: string): RuntimeComponent[] {
    return [...this.components.values()].filter((component) => component.handle.entityId === entityId);
  }

  snapshot(): Readonly<Record<string, unknown>> {
    const states: Record<LifecycleState, number> = { created: 0, active: 0, sleeping: 0, inactive: 0, disposed: 0 };
    for (const component of this.components.values()) states[component.state]++;
    return Object.freeze({ total: this.components.size, states: Object.freeze(states), generations: this.generations.size, eventHistorySize: this.events.length, recentEvents: Object.freeze(this.events.slice(-20).map(Object.freeze)) });
  }
}

export class FeatureFlags {
  private flags = new Map<string, FeatureSelection>();
  constructor(defaults: Readonly<Record<string, FeatureSelection>> = {}) { for (const [key, value] of Object.entries(defaults)) this.set(key, value); }
  set(key: string, value: FeatureSelection): void {
    if (!["off", "shadow", "candidate", "legacy"].includes(value)) throw new Error(`invalid feature selection ${value}`);
    this.flags.set(key, value);
  }
  get(key: string): FeatureSelection { return this.flags.get(key) ?? "off"; }
  snapshot(): Readonly<Record<string, FeatureSelection>> { return Object.freeze(Object.fromEntries(this.flags)); }
  static fromSearch(search: string, defaults: Readonly<Record<string, FeatureSelection>> = {}): FeatureFlags {
    const result = new FeatureFlags(defaults);
    const params = new URLSearchParams(search);
    for (const [key, value] of params) if (key.startsWith("engine.") && ["off", "shadow", "candidate", "legacy"].includes(value)) result.set(key.slice(7), value as FeatureSelection);
    return result;
  }
}

export class AdapterRegistry {
  private adapters = new Map<string, RuntimeAdapter>();
  private routes = new Map<AdapterCapability, { preferred: string; fallback?: string }>();
  private history: AdapterInvocation[] = [];

  register(adapter: RuntimeAdapter): void {
    if (!adapter.id.trim()) throw new Error("adapter id is required");
    if (this.adapters.has(adapter.id)) throw new Error(`adapter ${adapter.id} already registered`);
    this.adapters.set(adapter.id, adapter);
  }

  route(capability: AdapterCapability, preferred: string, fallback?: string): void {
    const first = this.adapters.get(preferred);
    if (!first?.capabilities.includes(capability)) throw new Error(`${preferred} lacks ${capability}`);
    if (fallback && !this.adapters.get(fallback)?.capabilities.includes(capability)) throw new Error(`${fallback} lacks ${capability}`);
    this.routes.set(capability, { preferred, fallback });
  }

  invoke(capability: AdapterCapability, frame: EngineFrame): AdapterInvocation {
    const route = this.routes.get(capability);
    if (!route) return this.record({ capability, selected: null, fallback: null, used: null, ok: true });
    const preferred = this.adapters.get(route.preferred)!;
    try {
      preferred.tick?.(frame);
      return this.record({ capability, selected: preferred.id, fallback: route.fallback ?? null, used: preferred.id, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallback = route.fallback ? this.adapters.get(route.fallback) : undefined;
      if (!fallback) return this.record({ capability, selected: preferred.id, fallback: null, used: null, ok: false, error: message });
      try {
        fallback.tick?.(frame);
        return this.record({ capability, selected: preferred.id, fallback: fallback.id, used: fallback.id, ok: true, error: message });
      } catch (fallbackError) {
        return this.record({ capability, selected: preferred.id, fallback: fallback.id, used: null, ok: false, error: `${message}; fallback: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}` });
      }
    }
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return Object.freeze({ adapters: Object.freeze([...this.adapters.values()].map((adapter) => ({ id: adapter.id, capabilities: [...adapter.capabilities] }))), routes: Object.freeze(Object.fromEntries(this.routes)), invocationHistorySize: this.history.length, recentInvocations: Object.freeze(this.history.slice(-20).map(Object.freeze)) });
  }

  async disposeAll(): Promise<void> {
    const adapters = [...this.adapters.values()].reverse();
    for (const adapter of adapters) { try { await adapter.stop?.(); } catch {} try { await adapter.dispose?.(); } catch {} }
    this.adapters.clear();
    this.routes.clear();
  }

  private record(invocation: AdapterInvocation): AdapterInvocation {
    this.history.push(invocation);
    if (this.history.length > 256) this.history.splice(0, this.history.length - 256);
    return Object.freeze(invocation);
  }
}

export interface QaDiagnostics {
  enabled: boolean;
  build: string;
  clock: Readonly<Record<string, unknown>>;
  components: Readonly<Record<string, unknown>>;
  adapters: Readonly<Record<string, unknown>>;
  flags: Readonly<Record<string, FeatureSelection>>;
}

export function createQaDiagnostics(enabled: boolean, build: string, sources: { clock: { snapshot(): Readonly<Record<string, unknown>> }; components: ComponentRegistry; adapters: AdapterRegistry; flags: FeatureFlags }): QaDiagnostics | null {
  if (!enabled) return null;
  return Object.freeze({ enabled: true, build, clock: sources.clock.snapshot(), components: sources.components.snapshot(), adapters: sources.adapters.snapshot(), flags: sources.flags.snapshot() });
}

function performanceNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}
