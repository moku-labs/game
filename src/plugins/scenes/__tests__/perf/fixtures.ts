/**
 * @file scenes plugin — the fixtures of the perf tests and benches. Not a test file. Each fixture builds the mock
 * plugin outside any measured window and hands back the frame callback a running scene build registered in `signals`,
 * while `world.projection.built()` answers false: the call every frame of a build makes.
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
