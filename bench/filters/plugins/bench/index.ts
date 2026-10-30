/**
 * Bench plugin, Standard tier, Layer 3: the consumer plugin of the filter bench. It puts the scene
 * the address or the editor names on the running game, keeps the ballast under it, turns the arms
 * of a run and keeps a row of numbers per arm. No events.
 *
 * @see ../../README.md
 */
import {
  type Clock,
  clockPlugin,
  createPlugin,
  type Renderer,
  rendererPlugin,
  scenesPlugin,
  timePlugin,
  type World,
  worldPlugin
} from "../../../../src/index.ts";
import { type BenchHost, benchFrame, createBenchApi, createBenchState, followAddress } from "./api";

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
function hostOf(
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
 * The bench on `game.bench`.
 *
 * @example
 * ```ts
 * game.bench.show("slope-4-mask", { k: 8 });
 * ```
 */
export const benchPlugin = createPlugin("bench", {
  depends: [worldPlugin, rendererPlugin, scenesPlugin, timePlugin, clockPlugin],
  createState: createBenchState,
  api: ctx =>
    createBenchApi(
      ctx.state,
      hostOf(
        ctx.require(worldPlugin),
        ctx.require(rendererPlugin),
        ctx.require(clockPlugin),
        ctx.log
      )
    ),
  hooks: ctx => ({
    "scenes:changed": ({ to }) => {
      if (to === BENCH_SCENE && ctx.state.scene === undefined) {
        followAddress(
          ctx.state,
          hostOf(
            ctx.require(worldPlugin),
            ctx.require(rendererPlugin),
            ctx.require(clockPlugin),
            ctx.log
          ),
          hashOfPage()
        );
      }
    }
  }),
  onStart: ctx => {
    const { state } = ctx;
    const host = hostOf(
      ctx.require(worldPlugin),
      ctx.require(rendererPlugin),
      ctx.require(clockPlugin),
      ctx.log
    );
    const follow = (): void => followAddress(state, host, hashOfPage());

    state.off.push(
      ctx.require(timePlugin).onFrame("animate", time => benchFrame(state, host, time.elapsed))
    );

    if (typeof addEventListener === "function") {
      addEventListener("hashchange", follow);
      state.off.push(() => removeEventListener("hashchange", follow));
    }
  },
  onStop: ctx => {
    for (const off of ctx.state.off.splice(0)) off();
  }
});
