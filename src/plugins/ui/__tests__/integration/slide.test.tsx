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

/**
 * A root of one box under a still column: a restyle may change its layout fields and its look together.
 *
 * @param style - The box's style.
 * @returns The tree.
 */
function boxTree(style: Record<string, unknown>) {
  return (
    <column key="albumRoot" style={{ width: 390, height: 844 }}>
      <stack key="probe" style={style} />
    </column>
  );
}

/** The box at rest: 100 by 40, a minimum height it stands well above. */
const PLAIN = boxTree({ width: 100, height: 40, minHeight: 10, fill: 0x22_22_22 });

/** The same rect, a new minimum height Yoga is told about, and a new scale. */
const SCALED = boxTree({ width: 100, height: 40, minHeight: 20, scale: 0.9, fill: 0x22_22_22 });

describe("a restyle that reaches Yoga and moves no rect", () => {
  it("takes the new scale of its rest pose in the same frame (F244)", async () => {
    // Bug caught: a restyle that writes a layout field leaves its rest pose to the solve, and the
    // solve applies only elements whose rect moved: the box keeps scale 1 though its style says 0.9.
    const perf = await startAlbumPerf();

    running = perf;

    const frame = (): void => {
      perf.ui.reconcile();
      perf.ui.solve();
      perf.ui.enter();
    };

    perf.render(PLAIN);
    frame();
    frame();

    const probe = keyed(perf, "probe");
    const box = { ...perf.ui.app.world.ecs.get(probe, Box) };

    perf.render(SCALED);
    frame();

    // The laid-out rect stays; the drawn one is the scaled box.
    expect(perf.ui.app.world.ecs.get(probe, Box)).toEqual(box);
    expect(perf.ui.app.world.projection.restOf(probe, Transform)?.scale).toBe(0.9);
  });
});

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
