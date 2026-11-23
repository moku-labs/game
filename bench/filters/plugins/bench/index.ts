/**
 * Bench plugin, Standard tier, Layer 3: the consumer plugin of the filter bench. It puts the scene
 * the address or the editor names on the running game, keeps the ballast under it, turns the arms
 * of a run and keeps a row of numbers per arm. The `trans-*` arms ask the graph for a real switch
 * between its two scenes. No events.
 *
 * @see ../../README.md
 */
import {
  assetsPlugin,
  clockPlugin,
  createPlugin,
  flowPlugin,
  rendererPlugin,
  scenesPlugin,
  timePlugin,
  worldPlugin
} from "../../../../src/index.ts";
import { createBenchApi, createBenchState } from "./api";
import { enterScene, hostOf, loadPixi, startBench, stopBench } from "./host";

/**
 * The bench on `game.bench`.
 *
 * @example
 * ```ts
 * game.bench.show("slope-4-mask", { k: 8 });
 * ```
 */
export const benchPlugin = createPlugin("bench", {
  depends: [
    worldPlugin,
    rendererPlugin,
    scenesPlugin,
    timePlugin,
    clockPlugin,
    flowPlugin,
    assetsPlugin
  ],
  createState: createBenchState,
  api: ctx => {
    const host = hostOf(
      ctx.require(worldPlugin),
      ctx.require(rendererPlugin),
      ctx.require(clockPlugin),
      ctx.log,
      ctx.require(flowPlugin),
      ctx.require(scenesPlugin),
      { api: ctx.require(assetsPlugin), holder: ctx.state.pixi }
    );

    ctx.state.host = host;

    return createBenchApi(ctx.state, host);
  },
  hooks: ctx => ({
    "scenes:changed": ({ to }) => enterScene(ctx.state, to)
  }),
  onStart: ctx => {
    loadPixi(ctx.state.pixi);
    startBench(ctx.state, run =>
      ctx.require(timePlugin).onFrame("animate", time => run(time.elapsed))
    );
  },
  onStop: ctx => stopBench(ctx.state)
});
