/**
 * @file The bench plugin's seam with the engine: the host its work reads, and what it does when the
 * game starts, enters its scene and stops.
 */
import type { Clock, Flow, Renderer, Scenes, World } from "../../../../src/index.ts";
import { type BenchHost, benchFrame, followAddress } from "./api";
import type { BenchState } from "./types";

/** The log as the bench writes to it. */
type BenchLog = { warn(event: string, data: Record<string, string>): void };

/** The scene the graph starts on, where the address is followed. */
const BENCH_SCENE = "bench";

/** The answer that takes the graph from each of its two scenes to the other: the `trans-*` arms' switch. */
const SWITCH_INTENT: Readonly<Record<string, string>> = { bench: "over", "bench-b": "back" };

/**
 * The address of the page.
 *
 * @returns `location.hash`; empty without a page.
 */
function hashOfPage(): string {
  return typeof location === "undefined" ? "" : location.hash;
}

/**
 * The engine as the bench reads it.
 *
 * @param world - The world plugin.
 * @param renderer - The renderer plugin.
 * @param clock - The clock plugin.
 * @param log - The log.
 * @param flow - The flow plugin: its gate takes the answer that switches the scene.
 * @param scenes - The scenes plugin: which scene stands.
 * @returns The host.
 */
export function hostOf(
  world: Pick<World.Api, "ecs">,
  renderer: Pick<Renderer.Api, "viewport" | "stats" | "monitor">,
  clock: Pick<Clock.Api, "now">,
  log: Pick<BenchLog, "warn">,
  flow: Pick<Flow.Api, "gate">,
  scenes: Pick<Scenes.ScenesApi, "current">
): BenchHost {
  return {
    ecs: world.ecs,
    screen: () => renderer.viewport.size(),
    stats: () => renderer.stats(),
    monitor: renderer.monitor,
    now: () => clock.now(),
    warn: (event, data) => log.warn(event, data),
    scene: () => scenes.current(),
    switchScene: () => {
      const intent = SWITCH_INTENT[scenes.current() ?? ""];

      return intent !== undefined && flow.gate.answer({ intent });
    }
  };
}

/**
 * Follows the address when the game enters the bench's scene for the first time, and tells the arm on screen about a
 * switch of scenes: its swap.
 *
 * @param state - The bench's state.
 * @param to - The scene entered.
 */
export function enterScene(state: BenchState, to: string): void {
  if (state.scene !== undefined) {
    state.mounted?.swapped?.(to);

    return;
  }

  if (to !== BENCH_SCENE || state.host === undefined) return;

  followAddress(state, state.host, hashOfPage());
}

/**
 * Turns the arms every frame and follows the address from now on.
 *
 * @param state - The bench's state.
 * @param onFrame - Runs a callback every frame with the elapsed time, and answers how to stop it.
 */
export function startBench(
  state: BenchState,
  onFrame: (run: (elapsed: number) => void) => () => void
): void {
  const { host } = state;

  if (host === undefined) return;

  const follow = (): void => followAddress(state, host, hashOfPage());

  state.off.push(onFrame(elapsed => benchFrame(state, host, elapsed)));

  if (typeof addEventListener === "function") {
    addEventListener("hashchange", follow);
    state.off.push(() => removeEventListener("hashchange", follow));
  }
}

/**
 * Lets go of everything `startBench` took.
 *
 * @param state - The bench's state.
 */
export function stopBench(state: BenchState): void {
  for (const off of state.off.splice(0)) off();
}
