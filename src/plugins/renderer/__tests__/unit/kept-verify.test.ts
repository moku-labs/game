import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Parent, Shape, Transform } from "../../components";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";
import { shadedSlot } from "../quad-harness";

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

/**
 * A room with a filter of its own and a lamp in it on its mesh, the oracle on and every frame reading a stale picture.
 *
 * @param place - The room's corner on the canvas.
 * @param place.x - Its x.
 * @param place.y - Its y.
 * @param cache - The lamp's category. A local one is put on its mesh by the test's writes.
 * @param roomCache - The category of the room's filter; none is drawn live in every frame.
 * @returns The renderer, the lamp and the kept state.
 */
async function lampUnderRoom(
  place: { x: number; y: number },
  cache: "placed" | "local" = "placed",
  roomCache?: "local"
): Promise<{ drawn: Drawn; lamp: Entity; kept: Drawn["mock"]["ctx"]["state"]["kept"] }> {
  const drawn = await startDrawn({ onDemand: false, dev: true });
  const kept = drawn.mock.ctx.state.kept;
  const room = drawn.spawn(Transform(place), Shape({ w: 200, h: 200 }));
  const lamp = drawn.mock.world.ecs.spawn(OWNER, [
    Transform({ x: 20, y: 20 }),
    Shape({ w: 40, h: 40 }),
    Parent({ entity: room })
  ]);

  running.push(drawn);
  drawn.stage.last().renderer.extract.pixels = vi.fn(() => ({
    pixels: picture(kept.bypassed),
    width: 4,
    height: 4
  }));
  drawn.frame();
  drawn.mock.api.sync.filters.set(room, [
    { filter: new pixi.ColorMatrixFilter(), passes: 1, ...(roomCache && { cache: roomCache }) }
  ]);
  drawn.mock.api.sync.filters.set(lamp, [shadedSlot({ cache, origin: new Float32Array(2) })]);
  drawn.frames(6);

  if (cache === "local") {
    for (let frame = 0; frame < 3; frame += 1) {
      drawn.mock.api.invalidate(lamp);
      drawn.frame();
    }
  }

  // A kept room stands once its lamp's take stopped marking it.
  if (roomCache !== undefined) {
    drawn.frames(12);
    expect(kept.byEntity.get(room)?.mode).toBe("kept");
  }

  expect(kept.byEntity.get(lamp)?.shaded).toBe(true);
  vi.mocked(drawn.mock.log.warn).mockClear();
  drawn.mock.api.sync.debug.verifyFrames(true);

  return { drawn, lamp, kept };
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

  // Bug: a glow under a filter off the origin is named a stale picture, sent live, taken, and sent live again: live, its
  // body reads a place relative to that filter's texture, on purpose (spec 23 P8.3).
  it("skips a frame in which a placed view reads its place under a filter off the origin", async () => {
    const { drawn, lamp, kept } = await lampUnderRoom({ x: 50, y: 50 });
    const skipped = kept.verifySkipped;

    drawn.frames(3);

    expect(kept.verifySkipped).toBe(skipped + 3);
    expect(staleLines(drawn)).toEqual([]);
    expect(kept.byEntity.get(lamp)?.mode).toBe("kept");
  });

  // Bug: a kept room holds no filters of its own, its stand-in does, and its glow is named a stale picture.
  it("skips such a frame under a kept picture off the origin", async () => {
    const { drawn, kept } = await lampUnderRoom({ x: 50, y: 50 }, "placed", "local");
    const skipped = kept.verifySkipped;

    drawn.frames(3);

    expect(kept.verifySkipped).toBe(skipped + 3);
    expect(staleLines(drawn)).toEqual([]);
  });

  // Bug: the skip covers every view under a filter, and the glows of the ward are never compared.
  it("compares such a view when the filter's bounds start at the canvas origin", async () => {
    const { drawn, kept } = await lampUnderRoom({ x: 0, y: 0 });
    const skipped = kept.verifySkipped;

    drawn.frames(3);

    expect(kept.verifySkipped).toBe(skipped);
    expect(staleLines(drawn)).not.toEqual([]);
  });

  // Bug: a local view under a filter stops being compared: its body reads no place, so live and the picture must agree.
  it("compares a local view on its shader under a filter off the origin", async () => {
    const { drawn, kept } = await lampUnderRoom({ x: 50, y: 50 }, "local");
    const skipped = kept.verifySkipped;

    drawn.frames(3);

    expect(kept.verifySkipped).toBe(skipped);
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
