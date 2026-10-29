/**
 * @file effects plugin — state factory. Everything starts empty: the start reads the features and
 * the systems fill the tables as entities carry effects.
 */
import type { Entity } from "../world/types";
import type { CheckState, FilteredView, FilterKind, FilterSyncState } from "./filters/types";
import type { BakedEmitter, EmitterDefinition, EmitterInstance } from "./particles/types";
import type { State } from "./types";

/** The empty kind list of the switches: one frozen array, shared, so an unchanged list is the same array. */
export const NO_KINDS: readonly string[] = Object.freeze([]);

/**
 * Creates the particle tables. Its own function because lint rule L5 refuses a collection built
 * inside an exported declaration.
 *
 * @returns The empty registry, bakes, instances and orphans.
 */
function particleTables(): Pick<State, "emitters" | "baked" | "instances" | "orphans"> {
  return {
    emitters: new Map<string, EmitterDefinition>(),
    baked: new Map<string, BakedEmitter>(),
    instances: new Map<Entity, EmitterInstance>(),
    orphans: new Set<EmitterInstance>()
  };
}

/**
 * Creates the shader checks of one run: nothing started, nothing answered, and the promise the boot's first node
 * waits for.
 *
 * @param run - The run the answers belong to.
 * @returns The fresh check state.
 */
function createCheckState(run: number): CheckState {
  const settle: { resolve?: () => void } = {};
  const settled = new Promise<void>(resolve => {
    settle.resolve = resolve;
  });

  return {
    run,
    started: false,
    status: new WeakMap(),
    waiting: 0,
    checked: 0,
    failed: 0,
    gl: [],
    startedAt: 0,
    settled,
    resolve: () => settle.resolve?.()
  };
}

/**
 * Creates where the filter sync stands before its first run: no run yet, no view to sync them all, no viewport judged.
 *
 * @returns The fresh sync state.
 */
export function createFilterSync(): FilterSyncState {
  return { round: 0, all: false, pending: false, width: -1, height: -1 };
}

/**
 * Creates the filter tables and the shared one-shot sets.
 *
 * @returns The empty kinds, checks, views, broken and ready marks and warnings.
 */
function filterTables(): Pick<
  State,
  | "kinds"
  | "kindList"
  | "checks"
  | "views"
  | "viewList"
  | "filterSync"
  | "broken"
  | "ready"
  | "warned"
> {
  return {
    kinds: new Map<string, FilterKind>(),
    kindList: [],
    checks: createCheckState(0),
    views: new Map<Entity, FilteredView>(),
    viewList: [],
    filterSync: createFilterSync(),
    broken: new Set<string>(),
    ready: new Set<string>(),
    warned: new Set<string>()
  };
}

/**
 * Starts the shader checks over for the next run: an answer still in flight belongs to the old run and is ignored.
 *
 * @param state - The plugin state.
 */
export function resetChecks(state: State): void {
  state.checks = createCheckState(state.checks.run + 1);
  state.ready.clear();
  state.broken.clear();
}

/**
 * Creates the initial effects state: no phone yet, nothing registered, nothing running, nothing warmed.
 *
 * @returns A fresh state, owned by one app.
 */
export function createEffectsState(): State {
  return {
    ...particleTables(),
    ...filterTables(),
    phone: false,
    seedCounter: 0,
    particles: 0,
    over: { particles: false, passes: 0, fullScreen: false },
    removers: [],
    diagnostics: { kinds: NO_KINDS, off: new Set<string>(), offList: NO_KINDS },
    warm: { started: false, core: [], probes: [] }
  };
}
