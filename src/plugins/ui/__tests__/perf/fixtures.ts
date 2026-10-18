/**
 * @file ui plugin — the fixtures of the perf tests and benches. Not a test file. The perf app is
 * started and brought to rest outside any measured window, and the two systems of phase `layout`
 * and the two `Pressed` hooks `ui` registered on the world are handed out, so a window calls
 * exactly the engine's code: no frame of another plugin, no spy.
 */
import { vi } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { Pressed } from "../../../input/components";
import type { AnySystem, Entity } from "../../../world/types";
import { createPerfApp, type PerfApp, settlePerfApp } from "./app";

/** Calls before a window, so the engine's code reaches its optimized tier first. */
const WARM_CALLS = 30_000;

/**
 * Calls of a window, ten times `alloc`'s default: a stray compile of a few kilobytes inside it
 * weighs a tenth of a byte a call, so the two halves of `alloc`'s cross-check still agree on a step
 * that keeps 0 B.
 */
const CALLS = 100_000;

/** A `ui` step: a system run or a hook, with nothing to pass. */
export type Step = () => void;

/** A `Pressed` hook of `ui`: it takes the entity the tag was added to or removed from. */
type PressHook = (entity: Entity, value: true) => void;

/** The started perf app and the `ui` steps a window calls. */
export type PerfUi = {
  app: PerfApp;
  /** The system `ui.reconcile` of phase `layout`. */
  reconcile: Step;
  /** The system `ui.solve` of phase `layout`. */
  solve: Step;
  /** What `ui` does when `Pressed` lands on an entity: the pointer went down on it. */
  press: (entity: Entity) => void;
  /** What `ui` does when `Pressed` leaves an entity: the pointer came up. */
  release: (entity: Entity) => void;
};

/**
 * Starts the perf app, mounts every projection, and runs frames until the screen rests. The
 * systems and the hooks `ui` opens in its `onStart` are read off the world while they register.
 *
 * @returns The app and its `ui` steps.
 */
export async function startPerfUi(): Promise<PerfUi> {
  const app = createPerfApp();
  const ecs = app.world.ecs;
  const systems = new Map<string, Step>();
  const hooks: { press?: PressHook; release?: PressHook } = {};
  const register = ecs.system;
  const onAdded = ecs.onAdded;
  const onRemoved = ecs.onRemoved;

  vi.spyOn(ecs, "system").mockImplementation((definition: AnySystem) => {
    // The two systems of ui run with no rows and read no system context.
    systems.set(definition.name, definition.run as unknown as Step);

    return register(definition);
  });
  vi.spyOn(ecs, "onAdded").mockImplementation((watched, fn) => {
    if (watched === Pressed) hooks.press = fn as PressHook;

    return onAdded(watched, fn);
  });
  vi.spyOn(ecs, "onRemoved").mockImplementation((watched, fn) => {
    if (watched === Pressed) hooks.release = fn as PressHook;

    return onRemoved(watched, fn);
  });

  await app.start();
  vi.restoreAllMocks();
  await settlePerfApp(app);

  const reconcile = systems.get("ui.reconcile");
  const solve = systems.get("ui.solve");
  const { press, release } = hooks;

  if (
    reconcile === undefined ||
    solve === undefined ||
    press === undefined ||
    release === undefined
  ) {
    throw new Error("perf: ui registered no layout systems or no Pressed hooks");
  }

  return {
    app,
    reconcile,
    solve,
    press: (entity: Entity): void => press(entity, true),
    release: (entity: Entity): void => release(entity, true)
  };
}

/**
 * The heap bytes one call of a step keeps: the step run until V8 optimized what it calls, outside
 * the window, then `alloc` over a window of `calls`.
 *
 * @param fn - The step.
 * @param calls - Calls in the window; fewer for a step that keeps kilobytes, so the window stays
 *   inside the young generation.
 * @returns Bytes per call.
 */
export function bytesPerCall(fn: Step, calls = CALLS): number {
  for (let call = 0; call < WARM_CALLS; call += 1) fn();

  return alloc(fn, calls);
}

/**
 * A press and a release on one element, each followed by the reconcile and the solve of its frame,
 * as the pointer tags land at the flush of phase `input` and phase `layout` runs after it.
 *
 * @param ui - The started perf app.
 * @param entity - The pressed element.
 * @returns One press and release.
 */
export function pressRelease(ui: PerfUi, entity: Entity): Step {
  return (): void => {
    ui.press(entity);
    ui.reconcile();
    ui.solve();
    ui.release(entity);
    ui.reconcile();
    ui.solve();
  };
}

/**
 * The entity of a keyed element of the running app.
 *
 * @param ui - The started perf app.
 * @param key - The element key.
 * @returns The entity.
 */
export function keyed(ui: PerfUi, key: string): Entity {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = ui.app.ui.find(key);

  if (entity === undefined) throw new Error(`perf: no element "${key}"`);

  return entity;
}
