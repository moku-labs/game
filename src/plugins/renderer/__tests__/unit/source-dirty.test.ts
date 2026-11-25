import { afterEach, describe, expect, it } from "vitest";
import { Transform } from "../../components";
import {
  openSources,
  rendersNow,
  sourceOf,
  spawnRoom,
  spawnWindow,
  stopRunning,
  takesOf
} from "../source-harness";

afterEach(stopRunning);

// ---------------------------------------------------------------------------
// F126 stage 5: when a Source is dirty. A mark inside its subtree, a resize (also a resolution step), a restore and a
// debug switch take it again; a mark outside it and a moving window do not.
// ---------------------------------------------------------------------------

/**
 * A room under a Source with a window over it, at rest: its first take done.
 *
 * @returns The renderer, the room, its child, the window and the Source.
 */
async function atRest(): Promise<{
  drawn: Awaited<ReturnType<typeof openSources>>;
  child: number;
  window: number;
  source: ReturnType<typeof sourceOf>;
}> {
  const drawn = await openSources();
  const { room, child } = spawnRoom(drawn);
  const window = spawnWindow(drawn);

  drawn.frames(6);

  return { drawn, child, window, source: sourceOf(drawn, room) };
}

describe("a Source's dirty flag", () => {
  // Bug: stale glass: a change of a node under the Source does not take it again.
  it("is set by a mark inside the subtree", async () => {
    const { drawn, child, source } = await atRest();
    const from = rendersNow(drawn);

    drawn.mock.world.ecs.set(child, Transform, { x: 12 });
    drawn.frame();

    expect(takesOf(drawn, source, from)).toBe(1);
    expect(source.dirty).toBe(false);
  });

  // Bug: every change anywhere on the screen retakes the Source: its cost at rest becomes the cost of the busiest view.
  it("is not set by a mark outside the subtree", async () => {
    const { drawn, source } = await atRest();
    const other = drawn.spawn(Transform({ x: 300, y: 300 }));

    drawn.frame();

    const from = rendersNow(drawn);

    drawn.mock.world.ecs.set(other, Transform, { x: 310 });
    drawn.frames(2);

    expect(takesOf(drawn, source, from)).toBe(0);
  });

  // Bug: a sliding note retakes the room in every frame (rejected form B measured +4.1 ms for 8 windows).
  it("is not set by a moving window", async () => {
    const { drawn, window, source } = await atRest();
    const from = rendersNow(drawn);

    for (let frame = 1; frame <= 6; frame += 1) {
      drawn.mock.world.ecs.set(window, Transform, { x: 50 + frame * 3 });
      drawn.frame();
    }

    expect(takesOf(drawn, source, from)).toBe(0);
  });

  // Bug: after a resize the glass reads a picture of the old screen size.
  it("is set on every Source by a resize, a restore and a debug switch", async () => {
    const { drawn, source } = await atRest();

    for (const reason of ["resize", "restore", "debug"] as const) {
      const from = rendersNow(drawn);

      drawn.mock.modules.demand.whole(reason);
      drawn.frame();

      expect(takesOf(drawn, source, from)).toBe(1);
    }
  });
});
