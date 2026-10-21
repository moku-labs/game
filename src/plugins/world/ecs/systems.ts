/**
 * @file world/ecs — the phases: system registration, the effective mode and one phase run.
 */
import type { Snapshot } from "../../model/types";
import type { Time } from "../../time/types";
import type { WorldCtx } from "../types";
import { flushCommands } from "./commands";
import { mayMatch, planOf, SystemWalk, systemRows } from "./query";
import { checkScenes, endLeaving, onScene } from "./scenes";
import { asError, resourceValue } from "./storage";
import type {
  AnySystem,
  ComponentStore,
  EcsApi,
  EcsState,
  PhaseContext,
  ResourceType,
  SystemContext,
  SystemEntry,
  WorldPhase
} from "./types";

/**
 * Time each world system took in the current frame of an agent build: names by registration index, ms in the same order.
 * `names` is a new array each time a system of a new name registers and the same array otherwise, so a reader that
 * kept it sees growth by identity.
 *
 * @example
 * ```ts
 * const timing: SystemTiming = { clock: () => performance.now(), names: ["ward.pan"], ms: Float64Array.of(0.42) };
 * ```
 */
export type SystemTiming = {
  readonly clock: () => number;
  names: readonly string[];
  ms: Float64Array;
};

/** The one phase that runs in every mode, because `renderer.sync` lives in it. */
const ALWAYS = "sync";

/** The system that hands the world to Pixi: the last of its phase, so a frame draws what every system wrote. */
const DRAWS = "renderer.sync";

/** Rows a timing table holds before it first grows. */
const TIMING_ROWS = 16;

/** The four phases, in frame order. */
const WORLD_PHASES: readonly WorldPhase[] = ["input", "animate", "layout", "sync"];

/**
 * Gives a timed system its row: the row of an earlier system of the same name, else the next one.
 * A new row replaces `names` with a new array, so a reader that kept the old one sees the growth
 * by identity, and the old array stays as it was. `ms` grows (a new array, the old values copied)
 * only when the row is past its end. Both happen at registration, never per frame.
 *
 * @param state - The ecs branch of the plugin state.
 * @param timing - The timing table.
 * @param name - The system's name.
 */
function giveRow(state: EcsState, timing: SystemTiming, name: string): void {
  if (state.timingSlots.has(name)) return;

  const row = timing.names.length;

  timing.names = [...timing.names, name];
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

  // Per frame: the one cache object is rewritten, no new one.
  if (cached === undefined) ctx.state.ecs.frameSnapshot = { frame: time.frame, snapshot };
  else {
    cached.frame = time.frame;
    cached.snapshot = snapshot;
  }

  return snapshot;
}

/**
 * An empty slot for each term of a plan: the stores its check keeps, filled with `push`, so the
 * list is a packed array of its exact length from the start.
 *
 * @param count - The number of terms.
 * @returns The slots, all `undefined`.
 */
function storeSlots(count: number): Array<ComponentStore | undefined> {
  const slots: Array<ComponentStore | undefined> = [];

  for (let index = 0; index < count; index += 1) slots.push(undefined);

  return slots;
}

/**
 * Registers a system at the end of its phase list, before `renderer.sync` in phase `sync`, and returns the remover. Its query and its
 * `scenes` are read here, once: a later change to the definition is not seen. A dev build checks
 * the `scenes` against the scenes the features declare, once the world started.
 *
 * @param ctx - Domain context of the world plugin.
 * @param definition - The system.
 * @returns The remover; calling it twice is a no-op.
 * @throws {Error} When a system of that name is already registered, and in a dev build for a
 *   name in `scenes` that no feature declares.
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

  // Inline and positive: a production `define` folds the guard and the check goes.
  if (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) {
    checkScenes(state.scene, definition);
  }

  // The query is read once, here: the plan registers every term's type and keeps the names, and
  // the one walk every run of the system resets is made.
  const plan = planOf(ctx, definition.query);
  const entry: SystemEntry = {
    definition,
    frame: ctx.deps.time.snapshot().frame,
    plan,
    stores: storeSlots(plan.names.length),
    scenes: definition.scenes === undefined ? undefined : [...definition.scenes],
    skipped: false,
    walk: plan.names.length === 0 ? undefined : new SystemWalk(ctx, plan)
  };
  const list = state.systems[definition.phase];
  const draws = list.findIndex(known => known.definition.name === DRAWS);

  // A system registered after the renderer started runs before its pass, not a frame late:
  // the ui's enter hooks are one (F48), a feature added later another.
  if (draws === -1) list.push(entry);
  else list.splice(draws, 0, entry);

  if (state.timing !== undefined) giveRow(state, state.timing, definition.name);

  return (): void => {
    const at = list.indexOf(entry);

    if (at !== -1) list.splice(at, 1);
  };
}

/**
 * Makes the one context of a world's system runs, with its one resource reader. A function of its
 * own: a closure literal in `phaseContextOf` would make V8 allocate the closure scope on every
 * call, also on the path that only reuses the context (40 B a phase, measured).
 *
 * @param state - The ecs branch of the plugin state.
 * @param world - The ecs API a system's `run` receives.
 * @param snapshot - The frame's model snapshot.
 * @param time - The frame's `Time`.
 * @returns The context, stored in the state.
 */
function createPhaseContext(
  state: EcsState,
  world: EcsApi,
  snapshot: Snapshot,
  time: Readonly<Time>
): PhaseContext {
  const context: PhaseContext = {
    world,
    res: <Value extends object>(resourceType: ResourceType<Value>): Value =>
      resourceValue(state, resourceType),
    snapshot,
    time,
    resumed: false
  };

  state.phaseContext = context;

  return context;
}

/**
 * The context of every system run of one world: made at the first phase run, then the same object
 * with the phase's `time` and `snapshot` written in. A world whose phases another ecs object runs
 * gets a context of its own.
 *
 * @param ctx - Domain context of the world plugin.
 * @param world - The ecs API a system's `run` receives.
 * @param time - The frame's `Time`.
 * @returns The context, set to this phase.
 */
function phaseContextOf(ctx: WorldCtx, world: EcsApi, time: Readonly<Time>): PhaseContext {
  const state = ctx.state.ecs;
  const snapshot = frameSnapshot(ctx, time);
  const known = state.phaseContext;

  if (known === undefined || known.world !== world) {
    return createPhaseContext(state, world, snapshot, time);
  }

  // Per phase: two fields of the one context are rewritten, no object is made.
  known.time = time;
  known.snapshot = snapshot;

  return known;
}

/**
 * Tells whether a system runs in this phase: one of its `scenes` is mounted or leaving, and no
 * term of its query has an empty store. A skipped system remembers it; one that runs is told in
 * `resumed` whether its last chance was skipped. No walk, no mark and no clock read happen for a
 * skipped system: the check comes before all three.
 *
 * @param state - The ecs branch of the plugin state.
 * @param entry - The system.
 * @param context - What its `run` receives; `resumed` is written here.
 * @returns True when the system runs.
 */
function wakes(state: EcsState, entry: SystemEntry, context: PhaseContext): boolean {
  const scenes = entry.scenes;

  if ((scenes !== undefined && !onScene(state.scene, scenes)) || !mayMatch(state.stores, entry)) {
    entry.skipped = true;

    return false;
  }

  context.resumed = entry.skipped;
  entry.skipped = false;

  return true;
}

/**
 * Runs one system, reporting a throw: the try lives here, so the loop of a phase holds none.
 *
 * @param ctx - Domain context of the world plugin.
 * @param entry - The system.
 * @param context - What its `run` receives.
 * @param phase - The phase, for the report.
 */
function guardedRun(
  ctx: WorldCtx,
  entry: SystemEntry,
  context: SystemContext,
  phase: WorldPhase
): void {
  try {
    entry.definition.run(systemRows(ctx, entry), context);
  } catch (error) {
    ctx.log.error("world:system-failed", { system: entry.definition.name, phase }, asError(error));
  }
}

/**
 * Runs the systems of one phase and flushes the commands they queued. A throwing system is
 * reported and skipped for this frame; the frame goes on. A system whose query has no entity, or
 * none of whose `scenes` is mounted or leaving, is skipped in its slot. While a scene leaves, the
 * phase first ends the leave when nothing carries `Exiting` any more.
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
  // Per phase: one length read while no scene leaves.
  if (state.scene.leaving.length > 0) endLeaving(state);

  const context = phaseContextOf(ctx, world, time);
  const entries = state.systems[phase];

  state.running = phase;

  if (state.timing === undefined) {
    // Per phase: an index loop, the length read every turn as `for…of` would, no iterator.
    // eslint-disable-next-line unicorn/no-for-loop -- the hot path walks by index; a system may register another
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];

      if (entry === undefined || entry.frame >= time.frame) continue;
      if (wakes(state, entry, context)) guardedRun(ctx, entry, context, phase);
    }
  } else {
    runTimed(ctx, state.timing, entries, context, phase, time);
  }

  state.running = undefined;
  flushCommands(ctx);
}

/**
 * Runs the systems of one phase as `runPhase` does, same order, same error isolation, same skip,
 * and adds each run's time to its row of the timing table: two clock reads per run, an indexed
 * loop, no closure. The rows were zeroed at the start of the frame, so after the frame they hold
 * its time; a skipped system's row stays 0.
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
  context: PhaseContext,
  phase: WorldPhase,
  time: Readonly<Time>
): void {
  const state = ctx.state.ecs;
  const count = entries.length;

  for (let index = 0; index < count; index += 1) {
    const entry = entries[index];

    if (entry === undefined || entry.frame >= time.frame) continue;
    // Before the first clock read: a skipped system is not timed, its row keeps the frame's 0.
    if (!wakes(state, entry, context)) continue;

    const row = rowOf(state, entry.definition.name);
    const started = timing.clock();

    guardedRun(ctx, entry, context, phase);

    timing.ms[row] = (timing.ms[row] ?? 0) + timing.clock() - started;
  }
}
