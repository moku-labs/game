/**
 * Bench plugin, Standard tier, Layer 3: the consumer plugin of the filter bench. It puts the scene
 * the address or the editor names on the running game, keeps the ballast under it, turns the arms
 * of a run and keeps a row of numbers per arm. No events.
 *
 * @see ../../README.md
 */
import {
  clockPlugin,
  createPlugin,
  rendererPlugin,
  scenesPlugin,
  timePlugin,
  worldPlugin
} from "../../../../src/index.ts";
import { createBenchApi, createBenchState } from "./api";
import { enterScene, hostOf, startBench, stopBench } from "./host";

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
  api: ctx => {
    const host = hostOf(
      ctx.require(worldPlugin),
      ctx.require(rendererPlugin),
      ctx.require(clockPlugin),
      ctx.log
    );

    ctx.state.host = host;

    return createBenchApi(ctx.state, host);
  },
  hooks: ctx => ({
    "scenes:changed": ({ to }) => enterScene(ctx.state, to)
  }),
  onStart: ctx =>
    startBench(ctx.state, run =>
      ctx.require(timePlugin).onFrame("animate", time => run(time.elapsed))
    ),
  onStop: ctx => stopBench(ctx.state)
});
