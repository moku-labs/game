/**
 * @file world/ecs — the phases: system registration, the effective mode and one phase run.
 */
import type { Snapshot } from "../../model/types";
import type { Time } from "../../time/types";
import type { WorldCtx } from "../types";
import { flushCommands } from "./commands";
import { runQuery } from "./query";
import { asError, registerType, resourceValue, termType } from "./storage";
import type {
  AnySystem,
  EcsApi,
  EcsState,
  ResourceType,
  SystemContext,
  SystemEntry,
  WorldPhase
} from "./types";

/**
 * Time each world system took in the current frame of an agent build: names by registration index, ms in the same order.
 *
 * @example
 * ```ts
 * const timing: SystemTiming = { clock: () => performance.now(), names: ["ward.pan"], ms: Float64Array.of(0.42) };
 * ```
 */
export type SystemTiming = {
  readonly clock: () => number;
  readonly names: string[];
  ms: Float64Array;
};

/** The one phase that runs in every mode, because `renderer.sync` lives in it. */
const ALWAYS = "sync";

/** Rows a timing table holds before it first grows. */
const TIMING_ROWS = 16;

/** The four phases, in frame order. */
const WORLD_PHASES: readonly WorldPhase[] = ["input", "animate", "layout", "sync"];

/**
 * Gives a timed system its row: the row of an earlier system of the same name, else the next one.
 * `ms` grows (a new array, the old values copied) only when the row is past its end: at
 * registration, never per frame.
 *
 * @param state - The ecs branch of the plugin state.
 * @param timing - The timing table.
 * @param name - The system's name.
 */
function giveRow(state: EcsState, timing: SystemTiming, name: string): void {
  if (state.timingSlots.has(name)) return;

  const row = timing.names.length;

  timing.names.push(name);
  state.timingSlots.set(name, row);

  if (row < timing.ms.length) return;

  const grown = new Float64Array(timing.ms.length * 2);

  grown.set(timing.ms);
  timing.ms = grown;
}

/**
 * Starts the timing table of an agent build with the page clock `time` handed out, and gives every
 * system registered so far its row. Called once, at the world's start.
 *
 * @param state - The ecs branch of the plugin state.
 * @param clock - The page clock of `time.agentClock()`.
 */
export function startTiming(state: EcsState, clock: () => number): void {
  const timing: SystemTiming = { clock, names: [], ms: new Float64Array(TIMING_ROWS) };

  state.timing = timing;

  for (const phase of WORLD_PHASES) {
    for (const entry of state.systems[phase]) giveRow(state, timing, entry.definition.name);
  }
}

/**
 * The row of a timed system.
 *
 * @param state - The ecs branch of the plugin state.
 * @param name - The system's name.
 * @returns Its row; 0 for a name the table never saw, which cannot happen for a registered system.
 */
function rowOf(state: EcsState, name: string): number {
  return state.timingSlots.get(name) ?? 0;
}

/**
 * The effective mode: a fast walk of the graph makes the world fast, whatever it stored.
 *
 * @param ctx - Domain context of the world plugin.
 * @returns The mode this frame runs in.
 */
export function effectiveMode(ctx: WorldCtx): "live" | "paused" | "fast" {
  return ctx.deps.flow.state().mode === "fast" ? "fast" : ctx.state.ecs.mode;
}

/**
 * Reads the model snapshot of this frame, once. Four phases of one frame see the same object.
 *
 * @param ctx - Domain context of the world plugin.
 * @param time - The frame's `Time`.
 * @returns The frozen snapshot.
 */
export function frameSnapshot(ctx: WorldCtx, time: Readonly<Time>): Snapshot {
  const cached = ctx.state.ecs.frameSnapshot;

  if (cached !== undefined && cached.frame === time.frame) return cached.snapshot;

  const snapshot = ctx.deps.model.store.snapshot();

  ctx.state.ecs.frameSnapshot = { frame: time.frame, snapshot };

  return snapshot;
}

/**
 * Registers a system at the end of its phase list and returns the remover.
 *
 * @param ctx - Domain context of the world plugin.
 * @param definition - The system.
 * @returns The remover; calling it twice is a no-op.
 * @throws {Error} When a system of that name is already registered.
 */
export function registerSystem(ctx: WorldCtx, definition: AnySystem): () => void {
  const state = ctx.state.ecs;
  const phases: WorldPhase[] = ["input", "animate", "layout", "sync"];

  for (const phase of phases) {
    if (state.systems[phase].some(entry => entry.definition.name === definition.name)) {
      throw new Error(
        `[game] System "${definition.name}" is registered twice.\n` +
          "  Give the second system another name, or remove the first one."
      );
    }
  }

  for (const term of definition.query) registerType(ctx, termType(term));

  const entry = { definition, frame: ctx.deps.time.snapshot().frame };
  const list = state.systems[definition.phase];

  list.push(entry);

  if (state.timing !== undefined) giveRow(state, state.timing, definition.name);

  return (): void => {
    const at = list.indexOf(entry);

    if (at !== -1) list.splice(at, 1);
  };
}

/**
 * Runs the systems of one phase and flushes the commands they queued. A throwing system is
 * reported and skipped for this frame; the frame goes on.
 *
 * @param ctx - Domain context of the world plugin.
 * @param world - The ecs API a system's `run` receives.
 * @param phase - The phase to run.
 * @param time - The frame's `Time`.
 */
export function runPhase(
  ctx: WorldCtx,
  world: EcsApi,
  phase: WorldPhase,
  time: Readonly<Time>
): void {
  const state = ctx.state.ecs;

  if (phase !== ALWAYS && effectiveMode(ctx) !== "live") return;

  const context: SystemContext = {
    world,
    res: <Value extends object>(resourceType: ResourceType<Value>): Value =>
      resourceValue(state, resourceType),
    snapshot: frameSnapshot(ctx, time),
    time
  };

  state.running = phase;

  if (state.timing === undefined) {
    for (const entry of state.systems[phase]) {
      if (entry.frame >= time.frame) continue;

      try {
        entry.definition.run(runQuery(ctx, entry.definition.query), context);
      } catch (error) {
        ctx.log.error(
          "world:system-failed",
          { system: entry.definition.name, phase },
          asError(error)
        );
      }
    }
  } else {
    runTimed(ctx, state.timing, state.systems[phase], context, phase, time);
  }

  state.running = undefined;
  flushCommands(ctx);
}

/**
 * Runs the systems of one phase as `runPhase` does, same order, same error isolation, and adds
 * each run's time to its row of the timing table: two clock reads per run, an indexed loop, no
 * closure. The rows were zeroed at the start of the frame, so after the frame they hold its time.
 *
 * @param ctx - Domain context of the world plugin.
 * @param timing - The timing table of the agent build.
 * @param entries - The systems of the phase.
 * @param context - What a system's `run` receives.
 * @param phase - The phase.
 * @param time - The frame's `Time`.
 */
function runTimed(
  ctx: WorldCtx,
  timing: SystemTiming,
  entries: readonly SystemEntry[],
  context: SystemContext,
  phase: WorldPhase,
  time: Readonly<Time>
): void {
  const count = entries.length;

  for (let index = 0; index < count; index += 1) {
    const entry = entries[index];

    if (entry === undefined || entry.frame >= time.frame) continue;

    const row = rowOf(ctx.state.ecs, entry.definition.name);
    const started = timing.clock();

    try {
      entry.definition.run(runQuery(ctx, entry.definition.query), context);
    } catch (error) {
      ctx.log.error(
        "world:system-failed",
        { system: entry.definition.name, phase },
        asError(error)
      );
    }

    timing.ms[row] = (timing.ms[row] ?? 0) + timing.clock() - started;
  }
}
