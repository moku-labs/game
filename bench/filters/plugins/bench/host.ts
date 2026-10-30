/**
 * @file The bench plugin's seam with the engine: the host its work reads, and what it does when the
 * game starts, enters its scene and stops.
 */
import type { Clock, Renderer, World } from "../../../../src/index.ts";
import { type BenchHost, benchFrame, followAddress } from "./api";
import type { BenchState } from "./types";

/** The log as the bench writes to it. */
type BenchLog = { warn(event: string, data: Record<string, string>): void };

/** The name of the one scene of the graph. */
const BENCH_SCENE = "bench";

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
 * @returns The host.
 */
export function hostOf(
  world: Pick<World.Api, "ecs">,
  renderer: Pick<Renderer.Api, "viewport" | "stats" | "monitor">,
  clock: Pick<Clock.Api, "now">,
  log: Pick<BenchLog, "warn">
): BenchHost {
  return {
    ecs: world.ecs,
    screen: () => renderer.viewport.size(),
    stats: () => renderer.stats(),
    monitor: renderer.monitor,
    now: () => clock.now(),
    warn: (event, data) => log.warn(event, data)
  };
}

/**
 * Follows the address when the game enters the bench's scene for the first time.
 *
 * @param state - The bench's state.
 * @param to - The scene entered.
 */
export function enterScene(state: BenchState, to: string): void {
  if (to !== BENCH_SCENE || state.scene !== undefined || state.host === undefined) return;

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
