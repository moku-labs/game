import { describe, expect, it } from "vitest";
import { Parent, Transform, type TransformValue } from "../../components";
import { rootPoseInto } from "../../sync/pose";
import { createMockRenderer } from "../mock-renderer";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: `rootPoseInto`, the root pose `effects` reads for a following emitter every frame (change
// 2026-10-18-cheap-idle-tick, E2): written into the caller's object, it allocates nothing.
// ---------------------------------------------------------------------------

describe("rootPoseInto", () => {
  it("allocates nothing through a chain of three", () => {
    const mock = createMockRenderer({ dom: false });
    const ecs = mock.world.ecs;
    const owner = { kind: "plugin", name: "perf" } as const;
    const a = ecs.spawn(owner, [Transform({ x: 100, y: 50, rotation: 0.5, scale: 2 })]);
    const b = ecs.spawn(owner, [Transform({ x: 20, y: 0, scale: 0.5 }), Parent({ entity: a })]);
    const c = ecs.spawn(owner, [Transform({ x: 0, y: 40 }), Parent({ entity: b })]);
    const out: TransformValue = { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } };

    expect(bytesPerCall(() => rootPoseInto(ecs, c, out))).toBeLessThanOrEqual(
      BUDGET.rootPoseInto + NOISE
    );
  });
});
