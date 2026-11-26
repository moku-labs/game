/**
 * Stress plugin, Standard tier, Layer 3: the driver of the stress bench. Every frame it walks the scene of the page
 * as a fast finger would (a peek, a drag, a turn, a slide; a popup open and close; a merge; every item of the board
 * moved), marks the frame of each commit, and hands out the frames of the engine's ring as rows. No events.
 *
 * @see ../../README.md
 */
import {
  createPlugin,
  flowPlugin,
  rendererPlugin,
  timePlugin,
  uiPlugin,
  worldPlugin
} from "../../../../src/index.ts";
import { startingSession } from "../../state";
import { createStressApi, createStressState } from "./api";
import { walkFrame } from "./drive";

/**
 * The stress bench on `game.stress`.
 *
 * @example
 * ```ts
 * game.stress.drain().rows.length; // 290: the frames of the last five seconds
 * ```
 */
export const stressPlugin = createPlugin("stress", {
  depends: [worldPlugin, rendererPlugin, timePlugin, flowPlugin, uiPlugin],
  createState: createStressState,
  api: ctx => createStressApi(ctx.state, ctx.require(rendererPlugin), ctx.require(worldPlugin)),
  onStart: ctx => {
    const driven = {
      world: ctx.require(worldPlugin),
      flow: ctx.require(flowPlugin),
      ui: ctx.require(uiPlugin)
    };

    ctx.state.off.push(
      ctx
        .require(timePlugin)
        .onFrame("input", time => walkFrame(ctx.state, driven, startingSession, time))
    );
  },
  onStop: ctx => {
    for (const off of ctx.state.off) off();
    ctx.state.off = [];
  }
});
