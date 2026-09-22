import { describe, expect, it } from "vitest";
import type { Entity } from "../../../world/types";
import { Parent, Transform, type TransformValue } from "../../components";
import { localPoseOf, rootPoseOf } from "../../sync/pose";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

const owner = { kind: "plugin", name: "test" } as const;

/**
 * Checks a pose field by field, with the tolerance the trigonometry needs.
 *
 * @param actual - The pose the helper answered.
 * @param expected - The pose worked out by hand.
 */
function expectPose(actual: TransformValue, expected: TransformValue): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.rotation).toBeCloseTo(expected.rotation, 9);
  expect(actual.scale).toBeCloseTo(expected.scale, 9);
  expect(actual.pivot.x).toBeCloseTo(expected.pivot.x, 9);
  expect(actual.pivot.y).toBeCloseTo(expected.pivot.y, 9);
}

/**
 * A root entity A, B under it and C under B: rotation, scale and pivot on every level that can
 * carry them.
 *
 * @param mock - The mock renderer whose world holds the chain.
 * @returns The three entities, outermost first.
 */
function chain(mock: MockRenderer): { a: Entity; b: Entity; c: Entity } {
  const ecs = mock.world.ecs;
  const a = ecs.spawn(owner, [
    Transform({ x: 100, y: 50, rotation: Math.PI / 2, scale: 2, pivot: { x: 10, y: 0 } })
  ]);
  const b = ecs.spawn(owner, [Transform({ x: 20, y: 0, scale: 0.5 }), Parent({ entity: a })]);
  const c = ecs.spawn(owner, [
    Transform({ x: 0, y: 40, rotation: Math.PI / 2, scale: 3, pivot: { x: 5, y: 5 } }),
    Parent({ entity: b })
  ]);

  return { a, b, c };
}

describe("sync pose", () => {
  it("answers the own Transform of an entity without a parent, as a copy", () => {
    const mock = createMockRenderer({ dom: false });
    const entity = mock.world.ecs.spawn(owner, [
      Transform({ x: 40, y: 60, rotation: 0.5, scale: 2, pivot: { x: 3, y: 4 } })
    ]);
    const pose = rootPoseOf(mock.world.ecs, entity);

    expect(pose).toEqual({ x: 40, y: 60, rotation: 0.5, scale: 2, pivot: { x: 3, y: 4 } });

    pose.pivot.x = 99;
    expect(mock.world.ecs.get(entity, Transform)?.pivot.x).toBe(3);
  });

  it("answers the identity pose for an entity without a Transform", () => {
    const mock = createMockRenderer({ dom: false });
    const entity = mock.world.ecs.spawn(owner, [Parent()]);

    expect(rootPoseOf(mock.world.ecs, entity)).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      pivot: { x: 0, y: 0 }
    });
  });

  it("composes a three-deep chain with rotation, scale and pivot", () => {
    const mock = createMockRenderer({ dom: false });
    const { c } = chain(mock);

    // C's pivot lands at (0, 40) in B, at (20, 20) in A and at (60, 70) in the root.
    expectPose(rootPoseOf(mock.world.ecs, c), {
      x: 60,
      y: 70,
      rotation: Math.PI,
      scale: 3,
      pivot: { x: 5, y: 5 }
    });
  });

  it("puts every local point of the chain where the composed pose puts it", () => {
    const mock = createMockRenderer({ dom: false });
    const { c } = chain(mock);
    const pose = rootPoseOf(mock.world.ecs, c);
    // The local point (6, 5) of C, walked level by level: (0, 43) in B, (20, 21.5) in A.
    const cos = Math.cos(pose.rotation);
    const sin = Math.sin(pose.rotation);
    const dx = 6 - pose.pivot.x;
    const dy = 5 - pose.pivot.y;

    expect(pose.x + pose.scale * (dx * cos - dy * sin)).toBeCloseTo(57, 9);
    expect(pose.y + pose.scale * (dx * sin + dy * cos)).toBeCloseTo(70, 9);
  });

  it("takes the pose it is given in place of the entity's own Transform", () => {
    const mock = createMockRenderer({ dom: false });
    const { b, c } = chain(mock);
    const rest: TransformValue = { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } };

    // B's origin: (20, 0) in A, then (100, 50) + 2 · R(π/2) · (10, 0) = (100, 70) in the root.
    expectPose(rootPoseOf(mock.world.ecs, c, rest), {
      x: 100,
      y: 70,
      rotation: Math.PI / 2,
      scale: 1,
      pivot: { x: 0, y: 0 }
    });
    expect(mock.world.ecs.get(b, Transform)?.x).toBe(20);
  });

  it("answers the slot example of its documentation", () => {
    const mock = createMockRenderer({ dom: false });
    const slot = mock.world.ecs.spawn(owner, [Transform({ x: 40, y: 60, scale: 0.5 })]);
    const cell = mock.world.ecs.spawn(owner, [
      Transform({ x: 100, y: 200 }),
      Parent({ entity: slot })
    ]);

    expect(rootPoseOf(mock.world.ecs, cell)).toEqual({
      x: 90,
      y: 160,
      rotation: 0,
      scale: 0.5,
      pivot: { x: 0, y: 0 }
    });
    expect(
      localPoseOf(mock.world.ecs, slot, {
        x: 90,
        y: 160,
        rotation: 0,
        scale: 0.5,
        pivot: { x: 0, y: 0 }
      })
    ).toEqual({ x: 100, y: 200, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } });
  });

  it("round-trips: the local pose of a root pose is the Transform it came from", () => {
    const mock = createMockRenderer({ dom: false });
    const { b, c } = chain(mock);
    const own = mock.world.ecs.get(c, Transform);

    if (own === undefined) throw new Error("C has no Transform");

    expectPose(localPoseOf(mock.world.ecs, b, rootPoseOf(mock.world.ecs, c)), own);
  });

  it("round-trips the other way: the root pose of a local pose lands where it was asked", () => {
    const mock = createMockRenderer({ dom: false });
    const { b } = chain(mock);
    const target: TransformValue = {
      x: 300,
      y: -120,
      rotation: 0.25,
      scale: 1.5,
      pivot: { x: 8, y: -2 }
    };
    const local = localPoseOf(mock.world.ecs, b, target);
    const child = mock.world.ecs.spawn(owner, [Transform(local), Parent({ entity: b })]);

    expectPose(rootPoseOf(mock.world.ecs, child), target);
  });

  it("answers the root pose unchanged under no parent", () => {
    const mock = createMockRenderer({ dom: false });
    const root: TransformValue = { x: 5, y: 6, rotation: 1, scale: 2, pivot: { x: 1, y: 1 } };
    const local = localPoseOf(mock.world.ecs, 0, root);

    expect(local).toEqual(root);
    expect(local).not.toBe(root);
    expect(local.pivot).not.toBe(root.pivot);
  });

  it("treats a parent without a Transform as the identity", () => {
    const mock = createMockRenderer({ dom: false });
    const parent = mock.world.ecs.spawn(owner, [Parent()]);
    const child = mock.world.ecs.spawn(owner, [
      Transform({ x: 12, y: 34, rotation: 0.5 }),
      Parent({ entity: parent })
    ]);

    expect(rootPoseOf(mock.world.ecs, child)).toEqual({
      x: 12,
      y: 34,
      rotation: 0.5,
      scale: 1,
      pivot: { x: 0, y: 0 }
    });
  });

  it("stops a chain that names itself as its parent", () => {
    const mock = createMockRenderer({ dom: false });
    const entity = mock.world.ecs.spawn(owner, [Transform({ x: 7, y: 8 })]);

    mock.world.ecs.add(entity, Parent({ entity }));

    expect(rootPoseOf(mock.world.ecs, entity)).toEqual({
      x: 7,
      y: 8,
      rotation: 0,
      scale: 1,
      pivot: { x: 0, y: 0 }
    });
  });

  it("stays finite under a parent collapsed to scale zero", () => {
    const mock = createMockRenderer({ dom: false });
    const parent = mock.world.ecs.spawn(owner, [Transform({ x: 10, y: 0, scale: 0 })]);
    const local = localPoseOf(mock.world.ecs, parent, {
      x: 30,
      y: 0,
      rotation: 0,
      scale: 1,
      pivot: { x: 0, y: 0 }
    });

    expect(Number.isFinite(local.x)).toBe(true);
    expect(Number.isFinite(local.scale)).toBe(true);
  });
});
