import { describe, expect, it } from "vitest";
import { Parent, Transform, type TransformValue } from "../../components";
import { rootPoseInto, rootPoseOf } from "../../sync/pose";
import type { AxisPose } from "../../sync/types";
import { createMockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit: `rootPoseInto`, the root pose written into the caller's object (change 2026-10-18-cheap-idle-tick, for
// `effects`' particles that follow a host every frame): the numbers of `rootPoseOf`, no object of its own.
// ---------------------------------------------------------------------------

const owner = { kind: "plugin", name: "test" } as const;

/**
 * A pose to write into, with its own pivot object.
 *
 * @returns The pose.
 */
function blankPose(): AxisPose {
  return { x: 0, y: 0, rotation: 0, scale: 1, scaleX: 1, scaleY: 1, pivot: { x: 0, y: 0 } };
}

describe("rootPoseInto", () => {
  it("writes the pose of rootPoseOf through a rotated, scaled and pivoted chain into the caller's object", () => {
    const mock = createMockRenderer({ dom: false });
    const ecs = mock.world.ecs;
    const a = ecs.spawn(owner, [
      Transform({ x: 100, y: 50, rotation: Math.PI / 2, scale: 2, pivot: { x: 10, y: 0 } })
    ]);
    const b = ecs.spawn(owner, [Transform({ x: 20, y: 0, scale: 0.5 }), Parent({ entity: a })]);
    const c = ecs.spawn(owner, [
      Transform({ x: 0, y: 40, rotation: Math.PI / 2, scale: 3, pivot: { x: 5, y: 5 } }),
      Parent({ entity: b })
    ]);
    const out = blankPose();
    const pivot = out.pivot;

    expect(rootPoseInto(ecs, c, out)).toBe(out);
    // The scratch carries both factors, written every call; the pose of `rootPoseOf` only those that are not 1.
    expect(out).toEqual({ ...rootPoseOf(ecs, c), scaleX: 1, scaleY: 1 });
    expect(out.pivot).toBe(pivot);
  });

  it("starts from the pose it is handed in place of the entity's own Transform", () => {
    const mock = createMockRenderer({ dom: false });
    const ecs = mock.world.ecs;
    const slot = ecs.spawn(owner, [Transform({ x: 40, y: 60, scale: 0.5 })]);
    const cell = ecs.spawn(owner, [Transform({ x: 100, y: 200 }), Parent({ entity: slot })]);
    const rest: TransformValue = { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } };

    expect(rootPoseInto(ecs, cell, blankPose(), rest)).toEqual({
      x: 40,
      y: 60,
      rotation: 0,
      scale: 0.5,
      scaleX: 1,
      scaleY: 1,
      pivot: { x: 0, y: 0 }
    });
  });
});
