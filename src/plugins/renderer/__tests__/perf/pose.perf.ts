import { describe, expect, it } from "vitest";
import type { TransformValue } from "../../components";
import { Parent, Transform } from "../../components";
import { rootPoseInto } from "../../sync/pose";
import type { AxisPose } from "../../sync/types";
import { createMockRenderer } from "../mock-renderer";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: `rootPoseInto`, the root pose `effects` reads for a following emitter every frame (change
// 2026-10-18-cheap-idle-tick, E2): written into the caller's object, it allocates nothing, also through a chain that
// stretches per axis (F179).
// ---------------------------------------------------------------------------

/**
 * A chain of three under a mock renderer: the root turned and scaled, the middle scaled, the leaf placed.
 *
 * @param factors - The per-axis factors every link carries, or none.
 * @returns The world read and the leaf.
 */
function chain(factors: Partial<TransformValue>): {
  ecs: ReturnType<typeof createMockRenderer>["world"]["ecs"];
  leaf: number;
} {
  const mock = createMockRenderer({ dom: false });
  const ecs = mock.world.ecs;
  const owner = { kind: "plugin", name: "perf" } as const;
  const a = ecs.spawn(owner, [Transform({ x: 100, y: 50, rotation: 0.5, scale: 2, ...factors })]);
  const b = ecs.spawn(owner, [
    Transform({ x: 20, y: 0, scale: 0.5, ...factors }),
    Parent({ entity: a })
  ]);
  const leaf = ecs.spawn(owner, [Transform({ x: 0, y: 40, ...factors }), Parent({ entity: b })]);

  return { ecs, leaf };
}

describe("rootPoseInto", () => {
  it.each([
    ["without the per-axis fields", {}],
    ["with scaleX and scaleY on every link", { scaleX: 1.5, scaleY: 0.75 }]
  ])("allocates nothing through a chain of three %s", (_name, factors) => {
    const { ecs, leaf } = chain(factors);
    const out: AxisPose = {
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      pivot: { x: 0, y: 0 }
    };

    expect(bytesPerCall(() => rootPoseInto(ecs, leaf, out))).toBeLessThanOrEqual(
      BUDGET.rootPoseInto + NOISE
    );
  });
});
