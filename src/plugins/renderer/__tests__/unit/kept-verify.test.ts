import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Parent, Shape, Transform } from "../../components";
import { type Drawn, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// The pixel leg of the kept oracle (spec 23 P13.2), behind debug.verifyFrames
// in dev and agent builds: a drawn frame in which a picture stood is read as
// drawn and with every picture drawn live; a difference is a stale picture.
// The stand-in's extract answers what the test says a frame looks like.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) drawn.mock.stop();

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A 4 x 4 picture, as the stand-in's extract answers it: grey, or grey with one pixel bright. */
const PIXELS = 16;

/**
 * A picture of the canvas.
 *
 * @param bright - True to light one pixel.
 * @returns RGBA bytes.
 */
function picture(bright: boolean): Uint8ClampedArray {
  const bytes = new Uint8ClampedArray(PIXELS * 4).fill(128);

  if (bright) bytes.fill(255, 0, 4);

  return bytes;
}

/**
 * Starts the renderer of a dev build, every frame drawn, with a kept view and the pixel check on.
 *
 * @param stale - True when the picture drawn differs from the frame drawn live.
 * @param frames - The drawn frames before it is handed over; its stack of alphas is taken in the second, its first frame unchanged (F114).
 * @returns The renderer, the entity and the extract spy.
 */
async function verified(
  stale: boolean,
  frames = 3
): Promise<{ drawn: Drawn; entity: Entity; extract: ReturnType<typeof vi.fn> }> {
  const drawn = await startDrawn({ onDemand: false, dev: true });
  const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));
  const kept = drawn.mock.ctx.state.kept;
  // Live (every picture bypassed) the frame has its bright pixel; drawn from a stale picture it has not.
  const extract = vi.fn(() => ({ pixels: picture(kept.bypassed || !stale), width: 4, height: 4 }));

  running.push(drawn);
  drawn.stage.last().renderer.extract.pixels = extract;
  drawn.mock.api.sync.filters.set(entity, [
    { filter: new pixi.AlphaFilter(), passes: 1, cache: "local" }
  ]);
  drawn.mock.api.sync.debug.verifyFrames(true);
  drawn.frames(frames);

  return { drawn, entity, extract };
}

/**
 * The stale-picture lines the log got.
 *
 * @param drawn - The running renderer.
 * @returns Their details.
 */
function staleLines(drawn: Drawn): unknown[] {
  return vi
    .mocked(drawn.mock.log.warn)
    .mock.calls.filter(([event]) => event === "renderer:stale-picture")
    .map(([, detail]) => detail);
}

describe("the pixel leg of the kept oracle", () => {
  it("reads a frame with a picture twice, drawn and live, and logs nothing when they are equal", async () => {
    const { drawn, entity, extract } = await verified(false);
    const reads = extract.mock.calls.length;

    drawn.frame();

    // Two reads of the kept leg, one of the frame oracle.
    expect(extract.mock.calls.length - reads).toBe(3);
    expect(staleLines(drawn)).toEqual([]);
    expect(drawn.mock.ctx.state.kept.byEntity.get(entity)?.mode).toBe("kept");
    expect(drawn.mock.ctx.state.kept.bypassed).toBe(false);
  });

  it("leaves every picture as it was: a nested pair stays kept and nothing is retaken by the leg", async () => {
    const drawn = await startDrawn({ onDemand: false, dev: true });
    const card = drawn.spawn(Transform({ x: 60, y: 60 }), Shape({ w: 200, h: 120 }));
    const badge = drawn.mock.world.ecs.spawn({ kind: "plugin", name: "test" }, [
      Transform({ x: 20, y: 20 }),
      Shape({ w: 40, h: 20 }),
      Parent({ entity: card })
    ]);
    const kept = drawn.mock.ctx.state.kept;

    running.push(drawn);
    drawn.stage.last().renderer.extract.pixels = () => ({
      pixels: picture(false),
      width: 4,
      height: 4
    });
    drawn.mock.api.sync.filters.set(card, [
      { filter: new pixi.AlphaFilter(), passes: 1, cache: "local" }
    ]);
    drawn.mock.api.sync.filters.set(badge, [
      { filter: new pixi.AlphaFilter(), passes: 1, cache: "local" }
    ]);
    drawn.mock.api.sync.debug.verifyFrames(true);
    drawn.frames(6);

    const from = drawn.stage.targets().length;

    drawn.frames(10);

    expect([kept.byEntity.get(badge)?.mode, kept.byEntity.get(card)?.mode]).toEqual([
      "kept",
      "kept"
    ]);
    expect(drawn.stage.targets().length).toBe(from);
  });

  it("logs renderer:stale-picture with its labels and draws every view live", async () => {
    const { drawn, entity } = await verified(true, 2);

    expect(staleLines(drawn)).toEqual([
      expect.objectContaining({ pixels: 1, pictures: [`kept:Shape#${entity}`] })
    ]);
    expect(drawn.mock.ctx.state.kept.byEntity.get(entity)?.mode).toBe("live");
    expect(drawn.objectOf(entity)?.renderable).toBe(true);
  });

  // Bug F113: a kept view under a fading ancestor draws its filter's output faded, live draws the filter of the faded
  // input; for a filter that is not alpha-linear every frame of a fade was reported stale and every view drawn live.
  it("skips a frame in which a picture hangs under a translucent ancestor, and compares again at alpha 1", async () => {
    const drawn = await startDrawn({ onDemand: false, dev: true });
    const panel = drawn.spawn(Transform({ x: 60, y: 60 }), Shape({ w: 200, h: 120 }));
    const icon = drawn.mock.world.ecs.spawn({ kind: "plugin", name: "test" }, [
      Transform({ x: 20, y: 20 }),
      Shape({ w: 40, h: 20 }),
      Parent({ entity: panel })
    ]);
    const kept = drawn.mock.ctx.state.kept;

    running.push(drawn);
    // Drawn live the frame differs from the picture: what a filter that is not alpha-linear draws under a fade.
    drawn.stage.last().renderer.extract.pixels = () => ({
      pixels: picture(kept.bypassed),
      width: 4,
      height: 4
    });
    drawn.mock.world.ecs.set(panel, Shape, { alpha: 0.5 });
    drawn.mock.api.sync.filters.set(icon, [
      { filter: new pixi.ColorMatrixFilter(), passes: 1, cache: "local" }
    ]);
    drawn.mock.api.sync.debug.verifyFrames(true);
    drawn.frames(3);

    const skipped = kept.verifySkipped;

    drawn.frames(2);

    expect(kept.verifySkipped - skipped).toBe(2);
    expect(staleLines(drawn)).toEqual([]);
    expect(kept.byEntity.get(icon)?.mode).toBe("kept");

    drawn.mock.world.ecs.set(panel, Shape, { alpha: 1 });
    drawn.frame();

    expect(staleLines(drawn)).toHaveLength(1);
  });

  it("skips a frame in which a picture is off its grid, and counts it", async () => {
    const { drawn, entity, extract } = await verified(false);
    const reads = extract.mock.calls.length;

    drawn.mock.world.ecs.set(entity, Transform, { x: 100.25 });
    drawn.frame();

    expect(extract.mock.calls.length - reads).toBe(1);
    expect(drawn.mock.ctx.state.kept.verifySkipped).toBe(1);
  });

  it("does not run in a production build", async () => {
    const drawn = await startDrawn({ onDemand: false });
    const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));
    const extract = vi.fn(() => ({ pixels: picture(false), width: 4, height: 4 }));

    running.push(drawn);
    drawn.stage.last().renderer.extract.pixels = extract;
    drawn.mock.api.sync.filters.set(entity, [
      { filter: new pixi.AlphaFilter(), passes: 1, cache: "local" }
    ]);
    drawn.mock.api.sync.debug.verifyFrames(true);
    drawn.frames(5);

    expect(drawn.mock.ctx.state.kept.byEntity.get(entity)?.mode).toBe("kept");
    expect(extract).not.toHaveBeenCalled();
  });
});
