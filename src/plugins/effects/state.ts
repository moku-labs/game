/**
 * @file effects plugin — state factory. Everything starts empty: the start reads the features and
 * the systems fill the tables as entities carry effects.
 */
import type { Entity } from "../world/types";
import type { FilteredView, FilterKind } from "./filters/types";
import type { BakedEmitter, EmitterDefinition, EmitterInstance } from "./particles/types";
import type { State } from "./types";

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
 * Creates the filter tables and the shared one-shot sets.
 *
 * @returns The empty kinds, checks, views, broken marks and warnings.
 */
function filterTables(): Pick<State, "kinds" | "checks" | "views" | "broken" | "warned"> {
  return {
    kinds: new Map<string, FilterKind>(),
    checks: new Map<string, "pending" | "ok">(),
    views: new Map<Entity, FilteredView>(),
    broken: new Set<string>(),
    warned: new Set<string>()
  };
}

/**
 * Creates the initial effects state: no phone yet, nothing registered, nothing running.
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
    over: { particles: false, passes: false, fullScreen: false },
    removers: []
  };
}
