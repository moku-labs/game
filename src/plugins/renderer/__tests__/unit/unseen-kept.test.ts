import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shape, Transform } from "../../components";
import type { FilterSlot } from "../../sync/types";
import { endStage, type OverlayStage, startOverlayStage } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test: the walks of `shown` the endless loops ask for are kept across frames (E4 of change
// 2026-10-18-render-path-garbage), keyed by the version every write that changes the tree moves on, and a walk reads
// whether a node is faded from the engine's records, never from Pixi's boxed `alpha`. A kept answer that outlives its
// tree freezes a loop the player sees, or lets one write that nobody sees.
// ---------------------------------------------------------------------------

const running: OverlayStage[] = [];

afterEach(() => {
  for (const stage of running.splice(0)) endStage(stage);
  vi.restoreAllMocks();
});

/**
 * Starts a stage the test ends in `afterEach`.
 *
 * @returns The stage.
 */
async function stageOf(): Promise<OverlayStage> {
  const stage = await startOverlayStage();

  running.push(stage);

  return stage;
}

describe("the kept walks of shown", () => {
  // Bug: the off-screen answer outlives a move, and the comet's loop stays frozen on the screen.
  it("let the loops of a leaf moved onto the screen write in the next frame", async () => {
    const stage = await stageOf();
    const { sync } = stage.drawn.mock.api;
    const comet = stage.view({ order: 1, x: 5000, y: 100 });

    stage.frames(2);

    expect(sync.loopsHeld(comet, "alpha")).toBe(true);

    stage.drawn.mock.world.ecs.set(comet, Transform, { x: 100 });
    stage.frame();

    expect(sync.loopsHeld(comet, "alpha")).toBe(false);
  });

  // Bug: the shown answer outlives a fade to 0, and a loop nobody sees keeps asking for frames.
  it("hold the loops of a view faded to 0 after they asked, from the next frame", async () => {
    const stage = await stageOf();
    const { sync } = stage.drawn.mock.api;
    const glint = stage.view({ order: 1 });

    stage.frames(2);

    expect(sync.loopsHeld(glint, "place")).toBe(false);

    stage.drawn.mock.world.ecs.set(glint, Shape, { alpha: 0 });
    stage.frame();

    expect(sync.loopsHeld(glint, "place")).toBe(true);
  });

  // Bug: a filter switched on, whose padding reaches the screen, leaves the off-screen answer standing.
  it("let the loops of a leaf write once a filter whose padding reaches the screen is switched on", async () => {
    const stage = await stageOf();
    const { api } = stage.drawn.mock;
    const light = stage.view({ order: 1, x: 1085, y: 100 });
    const glow = new pixi.AlphaFilter();
    const slots: readonly FilterSlot[] = Object.freeze([{ filter: glow, passes: 1 }]);

    stage.frame();
    glow.padding = 10;
    glow.enabled = false;
    api.sync.filters.set(light, slots);
    stage.frames(2);

    expect(api.sync.loopsHeld(light, "alpha")).toBe(true);

    api.invalidate(light);
    glow.enabled = true;
    stage.frame();

    expect(api.sync.loopsHeld(light, "alpha")).toBe(false);
  });

  // Bug: a resize moves the root and the screen, and the answers taken before it stand.
  it("are taken again after a resize", async () => {
    const stage = await stageOf();
    const { mock } = stage.drawn;
    const comet = stage.view({ order: 1, x: 5000, y: 100 });

    stage.frames(2);
    mock.modules.sync.loopsHeld(comet);

    const walk = vi.spyOn(mock.modules.demand, "unseenBy");

    stage.frame();
    mock.modules.sync.loopsHeld(comet);

    expect(walk).not.toHaveBeenCalled();

    mock.ctx.state.viewport.resizePending = true;
    stage.frame();
    mock.modules.sync.loopsHeld(comet);

    expect(walk).toHaveBeenCalledTimes(1);
  });

  // Bug: a walk reads Pixi's `alpha` on every node, and its getter boxes a double per node per walk.
  it("read no Pixi alpha on the chain of a built-in view: its own, its parent's, the layer's or the root's", async () => {
    const stage = await stageOf();
    const { mock } = stage.drawn;
    const panel = stage.view({ order: 1, w: 600, h: 600 });
    const glint = stage.view({ parent: panel, x: 10, w: 40, h: 40 });

    stage.frames(2);

    const alpha = vi.spyOn(pixi.Container.prototype, "alpha", "get");

    expect(mock.modules.sync.loopsHeld(glint)).toBe(false);
    expect(alpha).not.toHaveBeenCalled();
  });
});
