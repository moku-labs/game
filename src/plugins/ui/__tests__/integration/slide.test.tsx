import { afterEach, describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { Box } from "../../components";
import { type AlbumPerf, startAlbumPerf } from "../perf/album.fixture";

// ---------------------------------------------------------------------------
// Integration: elements that move with their parent (F244). A page of the album's strip moves by
// its `left`; Yoga lays out the page again and passes over its subtree, so the solve moves the
// cards by the page's step without reading their nodes, and the application writes their `Box`
// alone. Real flow, world, Yoga; inert renderer.
// ---------------------------------------------------------------------------

/** The app of the running test, stopped after it. */
let running: AlbumPerf | undefined;

afterEach(async () => {
  await running?.ui.app.stop();
  running = undefined;
});

/**
 * The entity of a keyed element of the album root.
 *
 * @param perf - The started album app.
 * @param key - The element key.
 * @returns The entity.
 */
function keyed(perf: AlbumPerf, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = perf.ui.app.ui.find(key);

  if (entity === undefined) throw new Error(`no element "${key}"`);

  return entity;
}

describe("a card that moves with its page", () => {
  it("has its Box moved by the page's step, and its pose relative to the page kept", async () => {
    // Bug caught: a card that only slid with its page keeps the Box of where it stood, so a tap on
    // it lands on the place the page left; or its rest pose is written as if it moved inside it.
    const perf = await startAlbumPerf();

    running = perf;

    const card = keyed(perf, "albumCard0x4");
    const page = perf.ui.app.ui.rectOf({ projection: "album", key: "albumPage0" });
    const box = { ...perf.ui.app.world.ecs.get(card, Box) };
    const pose = { ...perf.ui.app.world.ecs.get(card, Transform) };

    perf.turn();

    const moved = perf.ui.app.ui.rectOf({ projection: "album", key: "albumPage0" });
    const step = (moved?.x ?? 0) - (page?.x ?? 0);

    expect(step).toBe(-435);
    expect(perf.ui.app.world.ecs.get(card, Box)).toEqual({ ...box, x: (box.x ?? 0) + step });
    expect(perf.ui.app.ui.rectOf({ projection: "album", key: "albumCard0x4" })).toEqual(
      perf.ui.app.world.ecs.get(card, Box)
    );
    expect(perf.ui.app.world.ecs.get(card, Transform)).toMatchObject({ x: pose.x, y: pose.y });
  });
});
