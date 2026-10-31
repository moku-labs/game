/**
 * @file scenes plugin — the fixtures of the perf tests and benches. Not a test file. Each fixture builds the mock
 * plugin outside any measured window and hands back a call scenes makes in a frame or on an event: the `signals`
 * callback of a running scene build while `world.projection.built()` answers false, the same callback while a floor
 * holds a built scene, the one of a loader projection fading out with the veil after a swap, and the
 * `assets:bundle-progress` hook of a switch that feeds its loader.
 */
import { alloc } from "../../../../../tests/perf/alloc";
import { defineScene } from "../../define";
import { createMockScenes } from "../unit/mock-scenes";

/** Calls before a window: the callback reaches its optimized tier first. */
const WARM_CALLS = 30_000;

/** Calls of a window. */
const CALLS = 100_000;

/** The scene on the screen. */
const homeScene = defineScene("home", { bundle: "home", layers: {}, projections: [] });

/** The scene built aside. */
const boardScene = defineScene("board", {
  bundle: "board",
  layers: { items: {} },
  projections: [{ name: "board.items", layer: "items" }]
});

/**
 * The heap bytes one call keeps: the call run until V8 optimized it, outside the window, then `alloc` over a window
 * of `CALLS`.
 *
 * @param fn - The call.
 * @returns Bytes per call.
 */
export function bytesPerCall(fn: () => void): number {
  for (let call = 0; call < WARM_CALLS; call += 1) fn();

  return alloc(fn, CALLS);
}

/**
 * The `signals` callback of the board's build while the world says it is not done: the home scene is mounted, the
 * renderer draws, and the live switch to the board waits in its build.
 *
 * @returns The callback the frame loop calls, as `time` calls it.
 * @throws {Error} When the switch registered no frame callback.
 */
export async function buildWaiting(): Promise<() => void> {
  const mock = createMockScenes();

  mock.flow.features.push({ name: "screens", description: { scenes: [homeScene, boardScene] } });
  mock.start();
  await mock.enter({ rest: true, scene: "home" });
  mock.renderer.host.ready.mockReturnValue(true);
  // The switch waits in its build for good: its promise is never awaited.
  mock.enter({ rest: true, scene: "board" }).catch(() => undefined);

  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();

  const callback = mock.time.callbacks.signals[0];

  if (callback === undefined) throw new Error("the switch registered no build callback");

  const time = { delta: 16, elapsed: 16, scale: 1, frame: 1, idle: false };

  return () => callback(time);
}

/** The `Time` of a frame of the floor fixture: past the frames a floor asks for. */
const HELD_TIME = { delta: 16, elapsed: 16, scale: 1, frame: 5, idle: false };

/**
 * Stands in for the fake's `time.wake`, whose journal grows with every call: the real one is four assignments.
 */
function wakeNothing(): void {
  // Nothing to record: the window measures what `scenes` keeps.
}

/**
 * Stands in for the fake's `time.snapshot`, one field V8 erases: this copies the whole `Time`, as the real one does, so
 * a wait that reads it in a frame is seen in the window.
 *
 * @returns A copy of the `Time`.
 */
function copyTime(): typeof HELD_TIME {
  return { ...HELD_TIME };
}

/**
 * The `signals` callback of the board's build, done, while a floor no window of calls ends holds its swap.
 *
 * @returns The callback the frame loop calls, as `time` calls it.
 * @throws {Error} When the switch registered no frame callback.
 */
export async function buildHeld(): Promise<() => void> {
  const mock = createMockScenes({ buildMs: "auto", leave: { loader: { holdMs: 1e15 } } });

  mock.flow.features.push({ name: "screens", description: { scenes: [homeScene, boardScene] } });
  mock.start();
  await mock.enter({ rest: true, scene: "home" });
  mock.renderer.host.ready.mockReturnValue(true);
  mock.world.building.done = true;
  // The switch waits at the floor for good: its promise is never awaited.
  mock.enter({ rest: true, scene: "board" }).catch(() => undefined);

  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();

  const callback = mock.time.callbacks.signals[0];

  if (callback === undefined) throw new Error("the switch registered no build callback");

  mock.time.api.wake = wakeNothing;
  mock.time.api.snapshot = copyTime;

  return () => callback(HELD_TIME);
}

/** The scene on the screen of the fade fixture: it declares the loader's layer, so it holds the loader. */
const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { loading: {} },
  projections: []
});

/**
 * The `signals` callback of the loader "loading" fading out with the veil after the swap from the ward to the board:
 * the veil's `outMs` is so long that no window of calls ends the fade.
 *
 * @returns The callback the frame loop calls, as `time` calls it.
 * @throws {Error} When the swap registered no fade callback.
 */
export async function loaderFading(): Promise<() => void> {
  const mock = createMockScenes({
    buildMs: "auto",
    leave: { cover: { outMs: 1e15 }, loader: { projection: "loading" } }
  });

  mock.flow.features.push({
    name: "screens",
    description: {
      scenes: [wardScene, boardScene],
      projections: [{ name: "loading", layer: "loading" }]
    }
  });
  mock.start();
  mock.renderer.host.ready.mockReturnValue(true);
  mock.world.building.done = true;
  await mock.enter({ rest: true, scene: "ward" });

  const entering = mock.enter({ rest: true, scene: "board" });

  // The renderer calls the loader's `due`: the held loader is shown, and fades out after the swap.
  mock.renderer.sync.leave.show.mock.calls.at(-1)?.[0].loader?.due?.();
  await entering;

  const callback = mock.time.callbacks.signals[0];

  if (callback === undefined) throw new Error("the swap registered no fade callback");

  const time = { delta: 16, elapsed: 16, scale: 1, frame: 1, idle: false };

  return () => callback(time);
}

/**
 * The `assets:bundle-progress` hook of the ward → board switch, whose held loader "loading" is fed: one file of the
 * board's 1000 settled, a share of 0.001, below the step of 0.01, so the call feeds nothing.
 *
 * @returns The hook, called with one payload, as the kernel calls it.
 * @throws {Error} When the switch feeds no loader.
 */
export async function progressBelowStep(): Promise<() => void> {
  const mock = createMockScenes({ buildMs: "auto", leave: { loader: { projection: "loading" } } });

  mock.flow.features.push({
    name: "screens",
    description: {
      scenes: [wardScene, boardScene],
      projections: [{ name: "loading", layer: "loading" }]
    }
  });
  mock.start();
  mock.renderer.host.ready.mockReturnValue(true);
  mock.world.building.done = true;
  await mock.enter({ rest: true, scene: "ward" });
  mock.assets.control.gated = true;
  mock.assets.cold.add("board");
  // The switch waits for the board's load for good: its promise is never awaited.
  mock.enter({ rest: true, scene: "board" }).catch(() => undefined);

  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();

  if (mock.state.leaving?.feeding === undefined) throw new Error("the switch feeds no loader");

  const hook = mock.hooks["assets:bundle-progress"];
  const payload = { bundle: "board", loaded: 1, total: 1000 };

  return () => hook(payload);
}
