/**
 * @file ui plugin — the fixtures of the perf tests and benches. Not a test file. The perf app is
 * started and brought to rest outside any measured window, and the two systems of phase `layout`
 * and the two `Pressed` hooks `ui` registered on the world are handed out, so a window calls
 * exactly the engine's code: no frame of another plugin, no spy.
 */
import { vi } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { Pointer, Pressed } from "../../../input/components";
import type { Time } from "../../../time/types";
import type { AnySystem, Entity, SystemContext } from "../../../world/types";
import type { Element, ScrollMotion } from "../../jsx/types";
import type { stepScroll } from "../../layout/scroll";
import type { ElementLookup, LayoutState } from "../../layout/types";
import type { UiCtx } from "../../types";
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

/** A frame of 16.7 ms: a fractional delta, as a 60 Hz display gives it. */
const FRAME: Readonly<Time> = Object.freeze({
  delta: 16.7,
  elapsed: 0,
  scale: 1,
  frame: 0,
  idle: false
});

/** The rows a system of `ui` gets: it declares no query. */
const NO_ROWS: readonly [] = Object.freeze([]);

/**
 * What a system of `ui` gets beside its rows. They read the frame's time only, so the rest of
 * the context stays out.
 */
const SYSTEM_FRAME = Object.freeze({ time: FRAME }) as unknown as SystemContext;

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
    // The two systems of ui run with no rows and read the frame's time of their context only.
    systems.set(definition.name, () => definition.run(NO_ROWS, SYSTEM_FRAME));

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

/** What the scroll step of `ui` was last called with, read off by a file that mocks its module. */
export type ScrollCall = {
  step: typeof stepScroll | undefined;
  ctx: UiCtx | undefined;
  state: LayoutState | undefined;
  containers: readonly Element[] | undefined;
  lookup: ElementLookup | undefined;
};

/** The started perf app with its order strip, and the scroll step called with what `ui` hands it. */
export type ScrollPerf = {
  ui: PerfUi;
  /** The strip entity. */
  strip: Entity;
  /** Its motion record, which a window sets back between frames. */
  motion: ScrollMotion;
  /** One frame of the scroll step over every live scroll. */
  frame: Step;
};

/**
 * Starts the perf app, mounts the order strip, puts it at 1000 u and reads the scroll step and
 * its arguments off the call `ui` made in the last frame.
 *
 * @param call - Where the mocked module recorded the call.
 * @returns The app, the strip, its motion and one frame of the step.
 */
export async function startScrollPerf(call: ScrollCall): Promise<ScrollPerf> {
  const ui = await startPerfUi();

  ui.app.world.projection.mount(["strip"], { kind: "plugin", name: "perf" });

  for (let frame = 0; frame < 3; frame += 1) ui.app.time.step(16);

  ui.app.ui.scroll("perfStrip", 1000);
  ui.app.time.step(16);

  const { step, ctx, state, containers, lookup } = call;
  const strip = keyed(ui, "perfStrip");
  const motion = containers?.find(element => element.entity === strip)?.scroll;

  if (
    step === undefined ||
    ctx === undefined ||
    state === undefined ||
    containers === undefined ||
    lookup === undefined ||
    motion === undefined
  ) {
    throw new Error("perf: the scroll step never ran over the strip");
  }

  return { ui, strip, motion, frame: (): void => step(ctx, state, containers, lookup, FRAME) };
}

/**
 * A frame of a strip the finger holds: the finger moves 3.7 u one way, then back, so every frame
 * writes `Scroll`, `ScrollState` and the content's pose.
 *
 * @param scroll - The started scroll perf app.
 * @returns One frame.
 */
export function heldFrame(scroll: ScrollPerf): Step {
  const pointer = scroll.ui.app.world.ecs.resource(Pointer);
  // The window's own number lives in a cell: a double in a closure would be a new heap number.
  const shift = new Float64Array(1);

  scroll.ui.app.world.ecs.tag(scroll.strip, Pressed);
  pointer.x = 500;

  return (): void => {
    shift[0] = shift[0] === 0 ? 3.7 : 0;
    pointer.x = 500 + (shift[0] ?? 0);
    scroll.frame();
  };
}

/**
 * A frame of a flinging strip: the fling is set going again at 1.3 u a ms, one way, then back.
 *
 * @param scroll - The started scroll perf app.
 * @returns One frame.
 */
export function flingFrame(scroll: ScrollPerf): Step {
  const speed = new Float64Array(1);

  scroll.ui.app.world.ecs.untag(scroll.strip, Pressed);

  return (): void => {
    speed[0] = (speed[0] ?? 0) > 0 ? -1.3 : 1.3;
    scroll.motion.mode = "fling";
    scroll.motion.velocity = speed[0] ?? 0;
    scroll.frame();
  };
}

/**
 * A frame of a gliding strip: a glide from 900 to 1100 over 400 ms, 100 or 200 ms in.
 *
 * @param scroll - The started scroll perf app.
 * @returns One frame.
 */
export function glideFrame(scroll: ScrollPerf): Step {
  const elapsed = new Float64Array(1);

  scroll.ui.app.world.ecs.untag(scroll.strip, Pressed);

  return (): void => {
    elapsed[0] = elapsed[0] === 100 ? 200 : 100;
    scroll.motion.mode = "glide";
    scroll.motion.from = 900;
    scroll.motion.to = 1100;
    scroll.motion.duration = 400;
    scroll.motion.elapsed = elapsed[0] ?? 0;
    scroll.frame();
  };
}

/**
 * A frame of a strip that stands: no finger, no fling, no glide.
 *
 * @param scroll - The started scroll perf app.
 * @returns One frame.
 */
export function stillFrame(scroll: ScrollPerf): Step {
  scroll.ui.app.world.ecs.untag(scroll.strip, Pressed);
  scroll.motion.mode = "still";

  return scroll.frame;
}
