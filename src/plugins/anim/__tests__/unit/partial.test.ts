import { describe, expect, it } from "vitest";
import { component } from "../../../world/ecs/define";
import { advanceTracks, beginFrame } from "../../tween/advance";
import { createDriver } from "../../tween/driver";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: a frame that moves only some fields of a track writes a patch the track keeps and
// fills again (E6). Kept across frames, it must never carry a field the frame did not move: not
// one the frame before moved, and not one a newer track took.
// ---------------------------------------------------------------------------

/** A component with three numbers, so a track can move one, two or three of them. */
const Pos = component("Pos", { a: 0, b: 0, c: 0 });

/**
 * The mock with one entity at the origin, the real driver, the fields a hand holds now, and one
 * frame step that returns the patches written into `Pos`.
 *
 * @returns The setup.
 */
function setup() {
  const mock = createMockAnim();
  const entity = spawnTestEntity(mock, [Pos({ a: 0, b: 0, c: 0 })]);
  const held = new Set<string>();
  const patches: unknown[] = [];
  const set = mock.world.ecs.set.bind(mock.world.ecs);

  mock.world.ecs.set = (target, type, patch): void => {
    // A copy: the patch a track keeps is filled again by the next frame.
    if (type.componentName === Pos.componentName) patches.push({ ...patch });
    set(target, type, patch);
  };

  const step = (deltaMs: number): unknown[] => {
    patches.length = 0;
    beginFrame(mock.actx);
    advanceTracks(mock.actx, deltaMs);

    return [...patches];
  };

  return { mock, entity, held, driver: createDriver(mock.actx), step, muted: () => held };
}

describe("anim/tween — the kept patch of a frame that moves some fields", () => {
  it("writes only the fields this frame moved when the moved fields change between frames", () => {
    const { entity, held, driver, step, muted } = setup();

    driver.track(entity, Pos, { a: 100, b: 100 }, { ms: 100, ease: "linear" }, muted);

    held.add("b");
    expect(step(50)).toEqual([{ a: 50 }]);

    held.clear();
    held.add("a");
    expect(step(25)).toEqual([{ b: 75 }]);

    held.clear();
    expect(step(25)).toEqual([{ a: 100, b: 100 }]);
  });

  it("never writes a field a newer track took, also from the patch kept for some fields", () => {
    const { entity, held, driver, step, muted } = setup();

    driver.track(entity, Pos, { a: 100, b: 100, c: 100 }, { ms: 100, ease: "linear" }, muted);
    held.add("c");
    expect(step(50)).toEqual([{ a: 50, b: 50 }]);

    driver.track(entity, Pos, { a: 0 }, { ms: 100, ease: "linear" }, () => new Set());

    expect(step(25)).toEqual([{ b: 75 }, { a: 37.5 }]);
  });
});
