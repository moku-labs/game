import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Display, Parent, Shape, Transform } from "../../components";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// "Mark before the write" (spec 14 D1.3, D1.4, D3.2): a mark is judged as the
// view was drawn when it is made, and again at the decision. So a view that
// leaves the screen or hides itself still gets the frame it leaves in, and a
// view that arrives gets the frame it arrives in. Real Pixi, the tree oracle
// on every frame: a frame skipped over a changed picture fails the test.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

/**
 * Starts the renderer drawn on demand and keeps it for the teardown.
 *
 * @returns The running renderer.
 */
async function open(): Promise<Drawn> {
  const drawn = await startDrawn();

  running.push(drawn);

  return drawn;
}

/**
 * Builds the view of an entity spawned in the `items` layer and lets the frame after it rest.
 *
 * @param drawn - The running renderer.
 * @param components - The components of the entity.
 * @returns The entity.
 */
function settled(drawn: Drawn, ...components: Parameters<Drawn["spawn"]>): Entity {
  const entity = drawn.spawn(...components);

  drawn.frames(2);

  return entity;
}

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.oracle.expectPicturesCurrent();
    drawn.mock.stop();
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a mark is judged before its write", () => {
  it("draws a leaf in the frame it moves off the screen, then nothing while it is gone", async () => {
    const drawn = await open();
    const leaf = settled(drawn, Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.mock.world.ecs.set(leaf, Transform, { x: 5000 });

    expect(drawn.frame()).toBe(true);

    drawn.mock.world.ecs.set(leaf, Transform, { x: 5200 });

    expect(drawn.frame()).toBe(false);
  });

  it("draws a leaf in the frame it moves onto the screen", async () => {
    const drawn = await open();
    const leaf = settled(drawn, Transform({ x: 5000, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.mock.world.ecs.set(leaf, Transform, { x: 100 });

    expect(drawn.frame()).toBe(true);
  });

  it("draws the frame a padding shrinks in at the edge, invalidated before the write", async () => {
    const drawn = await open();
    const filter = new pixi.Filter({ resources: {}, padding: 20 } as unknown as pixi.FilterOptions);
    // Its box ends 10 px left of the screen: only the glow reaches it.
    const lamp = settled(drawn, Transform({ x: -50, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.mock.api.sync.filters.set(lamp, [{ filter, passes: 1 }]);
    drawn.frames(2);
    // What `effects` does for a filter value Pixi cannot see: first the call, then the write.
    drawn.mock.api.invalidate(lamp);
    filter.padding = 0;

    expect(drawn.frame()).toBe(true);

    drawn.mock.api.invalidate(lamp);
    filter.padding = 1;

    expect(drawn.frame()).toBe(false);
  });

  it("judges a Display invalidated before a write as drawn: one that hides is drawn, one that appears too", async () => {
    const drawn = await open();
    const flame = new pixi.Graphics().rect(0, 0, 30, 30).fill(0xff_80_00);
    const stove = settled(drawn, Transform({ x: 100, y: 100 }), Display({ object: flame }));

    drawn.mock.api.invalidate(stove);
    flame.visible = false;

    expect(drawn.frame()).toBe(true);

    drawn.mock.api.invalidate(stove);
    flame.visible = true;

    expect(drawn.frame()).toBe(true);
    expect(drawn.frames(3)).toBe(0);
  });

  it("the first change after a drawn frame counts for a view drawn then: a parent fading out is drawn, its child's later moves are not", async () => {
    const drawn = await open();
    const parent = settled(drawn, Transform({ x: 100, y: 100 }), Shape({ w: 80, h: 80 }));
    const child = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 10, y: 10 }),
      Shape({ w: 20, h: 20 }),
      Parent({ entity: parent })
    ]);

    drawn.frames(2);
    drawn.mock.world.ecs.set(parent, Shape, { alpha: 0 });

    expect(drawn.frame()).toBe(true);

    drawn.mock.world.ecs.set(child, Transform, { x: 30 });

    expect(drawn.frame()).toBe(false);

    drawn.mock.world.ecs.set(child, Transform, { x: 40 });
    drawn.mock.world.ecs.set(parent, Shape, { alpha: 1 });

    expect(drawn.frame()).toBe(true);
  });

  it("a second mark of an entity in one decision costs a lookup only", async () => {
    const drawn = await open();
    const leaf = settled(drawn, Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));
    const measured = vi.spyOn(drawn.objectOf(leaf) as pixi.Container, "getBounds");

    drawn.mock.api.invalidate(leaf);
    drawn.mock.api.invalidate(leaf);
    drawn.mock.world.ecs.set(leaf, Transform, { x: 120 });

    expect(drawn.frame()).toBe(true);
    // The renderer measures into its own box; the oracle's calls take none.
    expect(measured.mock.calls.filter(args => args.length === 2)).toHaveLength(1);
  });

  it("an invalidate while onDemand is off judges nothing and draws as before", async () => {
    const drawn = await startDrawn({ onDemand: false });
    const leaf = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    running.push(drawn);
    drawn.frames(2);

    const measured = vi.spyOn(drawn.objectOf(leaf) as pixi.Container, "getBounds");

    drawn.mock.api.invalidate(leaf);

    expect(drawn.frames(3)).toBe(3);
    // The renderer measures into its own box; the oracle's calls take none.
    expect(measured.mock.calls.filter(args => args.length === 2)).toHaveLength(0);
  });
});
