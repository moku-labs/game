import { afterEach, describe, expect, it } from "vitest";
import { Alpha } from "../../../../index";
import { Transform } from "../../../renderer/components";
import { Box } from "../../components";
import type { ElementMotion } from "../../jsx/types";
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
 * One commit of the album root: the layout phase and the enter of phase `sync`.
 *
 * @param perf - The started album app.
 */
function commit(perf: AlbumPerf): void {
  perf.ui.reconcile();
  perf.ui.solve();
  perf.ui.enter();
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

    const frame = (): void => commit(perf);

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

/** An exit that keeps the element on the screen for 500 ms. */
const FADE: ElementMotion = {
  exit: view => view.tween(Alpha, { alpha: 0 }, { ms: 500, reduced: "keep" })
};

/**
 * A root whose button grows a minimum height and shrinks to 0.9 while pressed, or the same root without it.
 *
 * @param shown - Whether the button is there.
 * @returns The tree.
 */
function pressTree(shown: boolean) {
  return (
    <column key="albumRoot" style={{ width: 390, height: 844 }}>
      {shown && (
        <button
          key="probe"
          intent="tap"
          motion={FADE}
          components={[Alpha()]}
          style={{
            width: 100,
            height: 40,
            minHeight: 10,
            is: { pressed: { minHeight: 20, scale: 0.9 } }
          }}
        />
      )}
    </column>
  );
}

describe("a pressed restyle on an element that leaves in the same frame", () => {
  it("leaves its pose to its exit (F244)", async () => {
    // Bug caught: the end of the solve reposes an element a press restyled after the render
    // started its exit, and a 0 ms rest track cuts the exit's pose.
    const perf = await startAlbumPerf();

    running = perf;

    const frame = (): void => commit(perf);

    perf.render(pressTree(true));
    frame();
    frame();

    const probe = keyed(perf, "probe");

    perf.ui.press(probe);
    perf.render(pressTree(false));
    frame();

    // Still on the screen, fading: the exit holds it, and its drawn scale is the one it had.
    expect(perf.ui.app.world.ecs.has(probe, Alpha)).toBe(true);
    expect(perf.ui.app.world.ecs.get(probe, Transform)?.scale).toBe(1);
  });
});

describe("an element whose change.Box hook went", () => {
  it("keeps the two rects the hook was handed when it moves again (F244)", async () => {
    // Bug caught: the solve writes the next moves into the rects a `change.Box` hook was handed
    // and kept, once the element's motion no longer has the hook.
    const perf = await startAlbumPerf();

    running = perf;

    const kept: { x: number; y: number; w: number; h: number }[] = [];
    const hooked: ElementMotion = {
      change: {
        Box: (_view, previous, next) => {
          kept.push(previous as never, next as never);
        }
      }
    };
    const at = (left: number, motion?: ElementMotion) => (
      <column key="albumRoot" style={{ width: 390, height: 844 }}>
        <stack
          key="probe"
          style={{ width: 100, height: 40, margin: { left } }}
          {...(motion === undefined ? {} : { motion })}
        />
      </column>
    );
    const frame = (): void => commit(perf);

    perf.render(at(0, hooked));
    frame();
    perf.render(at(10, hooked));
    frame();

    const seen = kept.map(rect => ({ ...rect }));

    expect(seen.length).toBeGreaterThan(0);

    perf.render(at(20));
    frame();
    perf.render(at(30));
    frame();
    perf.render(at(40));
    frame();

    expect(kept).toEqual(seen);
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
