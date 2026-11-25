import { afterEach, describe, expect, it } from "vitest";
import { Shape, Transform } from "../../components";
import { backSeam, backSlot } from "../quad-harness";
import {
  openSources,
  rendersNow,
  sourceOf,
  spawnRoom,
  spawnWindow,
  stopRunning,
  takesOf,
  windowOf
} from "../source-harness";

afterEach(stopRunning);

// ---------------------------------------------------------------------------
// F126 stage 5: a Source is taken in the flush of a drawn frame, for the windows that read it, and kept until
// something under it changes. The whole renderer over real Pixi, every frame drawn unless the test says otherwise.
// ---------------------------------------------------------------------------

describe("a Source and its takes", () => {
  // Bug: a Source nobody reads costs a texture and a pass in every frame of a game that only marked it.
  it("holds no texture and is never taken while no window reads it", async () => {
    const drawn = await openSources();
    const { room } = spawnRoom(drawn);
    const source = sourceOf(drawn, room);
    const from = rendersNow(drawn);

    drawn.frames(5);

    expect(source.texture).toBeUndefined();
    expect(takesOf(drawn, source, from)).toBe(0);
    expect(drawn.mock.api.stats().sources).toEqual({ count: 1, takes: 0, mb: 0, mpx: 0 });
  });

  // Bug: the first window over a Source waits forever, or the Source is taken before the window was eligible (A12).
  it("is taken once the frame after its first window was eligible, and not again at rest", async () => {
    const drawn = await openSources();
    const { room } = spawnRoom(drawn);
    const source = sourceOf(drawn, room);
    const from = rendersNow(drawn);
    const window = spawnWindow(drawn);
    const record = windowOf(drawn, window);

    expect(record.source).toBe(source);
    expect(record.reader).toBe(true);
    expect(takesOf(drawn, source, from)).toBe(0);

    drawn.frame();

    expect(takesOf(drawn, source, from)).toBe(1);
    expect(source.texture).toBeDefined();
    expect(drawn.mock.api.stats().sources.takes).toBe(1);

    const rested = rendersNow(drawn);

    drawn.frames(10);

    expect(takesOf(drawn, source, rested)).toBe(0);
    expect(drawn.mock.api.stats().sources.takes).toBe(0);
  });

  // Bug: a change under the Source shows stale glass, or retakes it every frame after.
  it("is taken exactly once for a change of a child, and its window keeps drawing on its quad", async () => {
    const drawn = await openSources();
    const { room, child } = spawnRoom(drawn);
    const source = sourceOf(drawn, room);
    const window = spawnWindow(drawn);

    drawn.frames(6);

    const record = windowOf(drawn, window);

    expect(record.mode).toBe("kept");
    expect(record.shaded).toBe(true);

    const from = rendersNow(drawn);

    drawn.mock.world.ecs.set(child, Transform, { x: 30 });
    drawn.frame();
    drawn.frames(4);

    expect(takesOf(drawn, source, from)).toBe(1);
    expect(record.mode).toBe("kept");
  });

  // Bug: a take in a frame that is not drawn presents an empty canvas on WebGPU (the spike).
  it("is never taken in a frame that is not drawn", async () => {
    const drawn = await openSources({ onDemand: true });
    const { room } = spawnRoom(drawn);
    const source = sourceOf(drawn, room);

    spawnWindow(drawn);
    drawn.frames(6);

    const from = rendersNow(drawn);

    // A dirty Source with a reader, in frames nothing asks to draw: no take.
    source.dirty = true;

    expect(drawn.frames(3)).toBe(0);
    expect(takesOf(drawn, source, from)).toBe(0);
  });

  // Bug: a window that is not eligible (a hidden one) forces a take nobody draws.
  it("is not taken for a window that may not be kept", async () => {
    const drawn = await openSources();
    const { room } = spawnRoom(drawn);
    const source = sourceOf(drawn, room);
    const from = rendersNow(drawn);
    const window = drawn.spawn(Transform({ x: 50, y: 50 }), Shape({ w: 40, h: 40 }));

    drawn.frame();

    const object = drawn.objectOf(window);

    if (object !== undefined) object.alpha = 0;
    drawn.mock.api.sync.filters.set(window, [backSlot(backSeam())]);
    drawn.frames(5);

    expect(windowOf(drawn, window).reader).toBe(false);
    expect(takesOf(drawn, source, from)).toBe(0);
    expect(source.texture).toBeUndefined();
  });
});
