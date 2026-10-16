import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Shape, Transform } from "../../components";
import { LAYER_ALPHA } from "../../sync/overdraw";
import type { PixiContainer } from "../../types";
import { type Drawn, startDrawn } from "../demand-harness";
import { linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the overdraw heat map of a dev or debug build (U6), over the real Pixi
// of the stage stand-in. Only the stage pass changes: in it every layer draws at
// 1/16, every node additively, without filters, kept pictures live, and one
// colour matrix on the root turns the frame's alpha into grey; between frames
// the tree is the game's, exactly. While it is on every frame is drawn.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) drawn.mock.stop();

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** What a node draws with, as a test compares it before and after. */
type Look = {
  alpha: number;
  blendMode: string;
  tint: number;
  filters: number;
  renderable: boolean;
  visible: boolean;
};

/**
 * Starts a dev build over the real Pixi with three full-screen views stacked in `items`, the middle one at alpha 0.5
 * with a filter of its own, and runs frames until the screen rests.
 *
 * @param onDemand - `config.onDemand`.
 * @returns The renderer and the three entities, bottom first.
 */
async function stacked(onDemand = true): Promise<{ drawn: Drawn; views: Entity[] }> {
  const drawn = await startDrawn({ onDemand, dev: true });
  const views = [0, 1, 2].map(index =>
    drawn.spawn(Transform(), Shape({ w: 1080, h: 1920, alpha: index === 1 ? 0.5 : 1 }))
  );

  running.push(drawn);
  drawn.mock.api.sync.filters.set(views[1] ?? 0, [{ filter: new pixi.BlurFilter(), passes: 2 }]);
  drawn.frames(3);

  return { drawn, views };
}

/**
 * Every node under a root, depth first, with what it draws with.
 *
 * @param root - The root.
 * @returns The looks, in walk order.
 */
function looksOf(root: PixiContainer): Look[] {
  const looks: Look[] = [];
  const open: PixiContainer[] = [root];

  for (let node = open.pop(); node !== undefined; node = open.pop()) {
    looks.push({
      alpha: node.alpha,
      blendMode: node.blendMode,
      tint: node.tint,
      filters: node.filters?.length ?? 0,
      renderable: node.renderable,
      visible: node.visible
    });
    open.push(...node.children);
  }

  return looks;
}

/**
 * Runs `inspect` while the stage is drawn onto the canvas, in the next frames.
 *
 * @param drawn - The renderer.
 * @param inspect - Called at the stage pass.
 */
function atStagePass(drawn: Drawn, inspect: () => void): void {
  const app = drawn.stage.last();

  app.renderer.watchers.push(call => {
    if (call.container === app.stage && call.target === undefined) inspect();
  });
}

describe("the overdraw stage pass", () => {
  // Bug caught: a view keeps its own alpha, blend mode or filter in the pass, or the layer is not at 1/16: the map
  // then shows the game's colours, not the layers drawn on a pixel.
  it("draws every node additively at full alpha without filters, its layer at 1/16, and the root through the matrix", async () => {
    const { drawn, views } = await stacked();
    const sync = drawn.mock.ctx.state.sync;
    const seen: { views: Look[]; layer: number; root: unknown[] }[] = [];

    atStagePass(drawn, () => {
      const root = sync.root;

      seen.push({
        views: views.map(
          entity => looksOf(sync.views.get(entity)?.object as PixiContainer)[0] as Look
        ),
        layer: sync.layers.get("items")?.container?.alpha ?? Number.NaN,
        root: [...(root?.filters ?? [])]
      });
    });
    drawn.mock.api.sync.debug.overdraw(true);
    drawn.frame();

    expect(seen[0]?.views.map(look => [look.alpha, look.blendMode, look.filters])).toEqual([
      [1, "add-npm", 0],
      [1, "add-npm", 0],
      [1, "add-npm", 0]
    ]);
    expect(seen[0]?.layer).toBe(LAYER_ALPHA);
    expect(seen[0]?.root).toHaveLength(1);
    expect(seen[0]?.root[0]).toBeInstanceOf(pixi.ColorMatrixFilter);
  });

  // Bug caught: the restore misses a field (a blend mode left additive, a filter left off, an alpha left at 1), so
  // the game looks different after the map, or between its frames, where the oracles and the editor read the tree.
  it("leaves the tree exactly as it was between frames and after the switch goes off", async () => {
    const { drawn } = await stacked();
    const root = drawn.mock.ctx.state.sync.root as PixiContainer;
    const before = looksOf(root);

    drawn.mock.api.sync.debug.overdraw(true);
    drawn.frames(3);

    expect(looksOf(root)).toEqual(before);

    drawn.mock.api.sync.debug.overdraw(false);
    drawn.frame();

    expect(looksOf(root)).toEqual(before);
    drawn.oracle.expectNoMissedFrame();
  });

  // Bug caught: render on demand skips the frames of a still screen, so the map freezes on the frame it started in.
  it("draws every frame of a still screen while on, and none again after off", async () => {
    const { drawn } = await stacked(true);

    expect(drawn.frames(3)).toBe(0);

    drawn.mock.api.sync.debug.overdraw(true);

    expect(drawn.frames(3)).toBe(3);

    drawn.mock.api.sync.debug.overdraw(false);
    drawn.frame();

    expect(drawn.frames(3)).toBe(0);
  });

  // Bug caught: a kept picture stays a picture in the map (one layer where its subtree stacks several), or the map
  // drops the picture, so it is taken again after the switch goes off.
  it("draws a kept view live in the pass and keeps its picture for the frames after", async () => {
    const drawn = await startDrawn({ onDemand: false, dev: true });
    const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));
    const kept = drawn.mock.ctx.state.kept;
    const inPass: boolean[] = [];

    running.push(drawn);
    drawn.mock.api.sync.filters.set(entity, [
      { filter: new pixi.AlphaFilter(), passes: 1, cache: "local" }
    ]);
    drawn.frames(3);

    const record = kept.byEntity.get(entity);
    const takes = record?.s1Version;

    expect(record?.mode).toBe("kept");

    atStagePass(drawn, () => inPass.push(record?.quad?.visible === true));
    drawn.mock.api.sync.debug.overdraw(true);
    drawn.frames(2);
    drawn.mock.api.sync.debug.overdraw(false);
    drawn.frame();

    expect(inPass).toEqual([false, false, true]);
    expect(record?.mode).toBe("kept");
    expect(record?.s1Version).toBe(takes);
  });

  // Bug caught: the switch turns on in a production build, where the heat map's code is not in the bundle.
  it("stays off without the dev and agent flags", async () => {
    const drawn = await startDrawn({ onDemand: true });

    running.push(drawn);
    drawn.mock.api.sync.debug.overdraw(true);

    expect(drawn.mock.api.sync.debug.state().overdraw).toBe(false);
    expect(drawn.frames(2)).toBe(0);
  });
});

describe("the overdraw frames in the performance log", () => {
  // Bug caught: a recording made with the map on reads as the game's cost: no event marks the switch, no header says
  // so.
  it("writes a debug event when the switch moves, and says so in the header of a listener that comes later", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    agent.mock.api.sync.debug.overdraw(true);
    agent.mock.api.sync.debug.overdraw(true);
    agent.mock.api.sync.debug.overdraw(false);
    agent.mock.api.sync.debug.overdraw(true);

    expect(
      linesOf(lines, "event")
        .filter(line => line.name === "debug")
        .map(line => line.detail)
    ).toEqual([{ overdraw: true }, { overdraw: false }, { overdraw: true }]);
    expect(linesOf(lines, "header")[0]?.debug).toEqual({ overdraw: false });
    expect(linesOf(agent.listen(), "header")[0]?.debug).toEqual({ overdraw: true });
  });
});
