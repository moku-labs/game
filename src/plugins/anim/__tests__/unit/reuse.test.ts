import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Transform } from "../../../renderer/components";
import { defineAnimation, mark, sequence, use } from "../../timeline/steps";
import { advanceTracks, beginFrame } from "../../tween/advance";
import { createDriver } from "../../tween/driver";
import type { Target } from "../../types";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: what a frame step reuses instead of rebuilding — the patch of a track and the cursor
// context of a timeline — never carries a value of one frame or one subtree into another.
// ---------------------------------------------------------------------------

/** Nothing is muted. */
const open = (): ReadonlySet<string> => new Set();

describe("anim — reused frame objects", () => {
  it("never writes back a field a newer track took, after that track ended", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 0, y: 0 })]);
    const driver = createDriver(mock.actx);
    const frame = (deltaMs: number): void => {
      beginFrame(mock.actx);
      advanceTracks(mock.actx, deltaMs);
    };

    driver.track(entity, Transform, { x: 100, y: 100 }, { ms: 100, ease: "linear" }, open);
    frame(50);
    driver.track(entity, Transform, { x: 0 }, { ms: 10, ease: "linear" }, open);
    frame(10);
    frame(10);

    expect(mock.world.ecs.get(entity, Transform)).toMatchObject({ x: 0, y: 70 });
  });

  it("reports a mark after a nested animation under the outer id, in the same frame", () => {
    const mock = createMockAnim();
    const slots = { it: type<Target>() };
    const inner = defineAnimation("hud.inner", { slots, build: () => mark("inside") });
    const outer = defineAnimation("hud.outer", {
      slots,
      build: ({ it }) => sequence(use(inner, { it }), mark("after"))
    });

    mock.start();
    mock.api.play(outer, { it: spawnTestEntity(mock, [Transform()]) });
    mock.frame(16);

    expect(mock.emitted.filter(entry => entry.name === "anim:mark")).toEqual([
      { name: "anim:mark", payload: { animation: "hud.inner", mark: "inside" } },
      { name: "anim:mark", payload: { animation: "hud.outer", mark: "after" } }
    ]);
  });
});
