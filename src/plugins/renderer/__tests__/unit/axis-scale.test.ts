import { describe, expect, it } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Parent, Shape, Sprite, Transform, type TransformValue } from "../../components";
import { localPoseOf, poseUnder, rootPointOf, rootPoseInto, rootPoseOf } from "../../sync/pose";
import type { AxisPose } from "../../sync/types";
import { FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit: per-axis scale `scaleX` / `scaleY` on `Transform` (F179). The drawn scale is `scale × scaleX` by
// `scale × scaleY`; a missing factor is 1 everywhere, and a pose that may reach the ECS carries a factor only when it
// is not 1 or the stored value already has it.
// ---------------------------------------------------------------------------

const owner = { kind: "plugin", name: "test" } as const;
const anyEntity = (): boolean => true;

/**
 * Starts the renderer with one layer and 64 x 64 textures.
 *
 * @returns The started renderer.
 */
async function started(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.api.sync.textures.provide(() => new FakeTexture({}) as never);
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  return mock;
}

/**
 * Spawns a sprite view, syncs it and answers the scale Pixi holds for it.
 *
 * @param transform - Its Transform.
 * @param sprite - Its sprite size; 0 keeps the texture's 64.
 * @returns The Pixi scale.
 */
async function pixiScaleOf(
  transform: Partial<TransformValue>,
  sprite: { width?: number; height?: number } = {}
): Promise<{ x: number; y: number }> {
  const mock = await started();
  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform(transform),
    Sprite({ texture: "card", ...sprite })
  ]);

  mock.modules.sync.pass();

  const scale = mock.ctx.state.sync.views.get(entity)?.object.scale;

  return { x: scale?.x ?? Number.NaN, y: scale?.y ?? Number.NaN };
}

/**
 * A scratch pose with both factors.
 *
 * @returns The pose.
 */
function scratch(): AxisPose {
  return { x: 0, y: 0, rotation: 0, scale: 1, scaleX: 1, scaleY: 1, pivot: { x: 0, y: 0 } };
}

describe("sync applyTransform, per axis", () => {
  // Bug: the factor is not written, the ribbon stands at full width.
  it("writes scaleX on X alone", async () => {
    expect(await pixiScaleOf({ scaleX: 0.5 })).toEqual({ x: 0.5, y: 1 });
  });

  // Bug: a factor replaces the uniform scale instead of multiplying it.
  it("multiplies the uniform scale by each factor", async () => {
    expect(await pixiScaleOf({ scale: 2, scaleY: 0.5 })).toEqual({ x: 2, y: 1 });
  });

  // Bug: the stretch of a sized sprite is lost, or folded in on the wrong axis.
  it("keeps the stretch of a sized sprite on its own axis", async () => {
    expect(await pixiScaleOf({ scaleX: 0.5 }, { width: 128, height: 192 })).toEqual({ x: 1, y: 3 });
  });

  // Bug: a view without the fields reads `undefined` and draws NaN.
  it("writes what it wrote before for a view without the fields", async () => {
    expect(await pixiScaleOf({ scale: 1.5 }, { width: 128 })).toEqual({ x: 3, y: 1.5 });
  });
});

describe("pose math, per axis", () => {
  // Bug: the parent's X factor is not applied to its children's positions.
  it("places a child at (10, 10) under a parent of scaleX 2 at (20, 10)", () => {
    const { world } = createMockRenderer({ dom: false });
    const parent = world.ecs.spawn(owner, [Transform({ scaleX: 2 })]);
    const child = world.ecs.spawn(owner, [
      Transform({ x: 10, y: 10 }),
      Parent({ entity: parent })
    ]);
    const pose = rootPoseOf(world.ecs, child);

    expect(pose.x).toBeCloseTo(20);
    expect(pose.y).toBeCloseTo(10);
    expect(pose.scaleX).toBe(2);
    expect(rootPointOf(world.ecs, child, { x: 5, y: 5 })).toEqual({ x: 30, y: 15 });
  });

  // Bug: the parent rotates before it scales, so the stretch lands on the wrong screen axis.
  it("scales then rotates, as Pixi draws: under a parent turned by π/2 the stretch goes down", () => {
    const { world } = createMockRenderer({ dom: false });
    const parent = world.ecs.spawn(owner, [
      Transform({ x: 100, y: 100, rotation: Math.PI / 2, scaleX: 2 })
    ]);
    const child = world.ecs.spawn(owner, [
      Transform({ x: 10, y: 10 }),
      Parent({ entity: parent })
    ]);
    const pose = rootPoseOf(world.ecs, child);

    // Local (10, 10) scaled to (20, 10), turned by π/2 to (-10, 20), placed at (100, 100).
    expect(pose.x).toBeCloseTo(90);
    expect(pose.y).toBeCloseTo(120);
  });

  // Bug: the inverse divides by the uniform scale only, a dropped view lands off where it was.
  it("round-trips a root pose through localPoseOf under a stretched, turned and pivoted parent", () => {
    const { world } = createMockRenderer({ dom: false });
    const parent = world.ecs.spawn(owner, [
      Transform({ x: 40, y: 60, rotation: 0.4, scale: 0.5, scaleX: 2, scaleY: 0.8, pivot: { x: 5, y: 7 } })
    ]);
    const child = world.ecs.spawn(owner, [
      Transform({ x: 30, y: -20, scaleX: 0.5, pivot: { x: 2, y: 3 } }),
      Parent({ entity: parent })
    ]);
    const local = localPoseOf(world.ecs, parent, rootPoseOf(world.ecs, child));

    expect(local.x).toBeCloseTo(30);
    expect(local.y).toBeCloseTo(-20);
    expect(local.scale).toBeCloseTo(1);
    expect(local.scaleX).toBeCloseTo(0.5);
    expect(local.scaleY).toBeCloseTo(1);
  });

  // Bug: poseUnder multiplies only the uniform scale.
  it("composes the factors in poseUnder", () => {
    const above: TransformValue = {
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      scaleX: 2,
      pivot: { x: 0, y: 0 }
    };
    const local: TransformValue = {
      x: 10,
      y: 10,
      rotation: 0,
      scale: 1,
      scaleY: 0.5,
      pivot: { x: 0, y: 0 }
    };

    expect(poseUnder(above, local)).toEqual({
      x: 20,
      y: 10,
      rotation: 0,
      scale: 1,
      scaleX: 2,
      scaleY: 0.5,
      pivot: { x: 0, y: 0 }
    });
  });
});

describe("pose shape", () => {
  // Bug: a reused scratch keeps the factor of the stretched entity it was written for before.
  it("writes both factors into a scratch every call, 1 for a plain entity", () => {
    const { world } = createMockRenderer({ dom: false });
    const stretched = world.ecs.spawn(owner, [Transform({ scaleX: 0.25, scaleY: 3 })]);
    const plain = world.ecs.spawn(owner, [Transform({ x: 5 })]);
    const out = scratch();

    rootPoseInto(world.ecs, stretched, out);
    expect(out).toMatchObject({ scaleX: 0.25, scaleY: 3 });

    rootPoseInto(world.ecs, plain, out);
    expect(out).toMatchObject({ x: 5, scaleX: 1, scaleY: 1 });
  });

  // Bug: a pose of a plain view gains `scaleX: 1`, and every snapshot and describe of it changes.
  it("leaves the keys out of rootPoseOf and localPoseOf of a plain view", () => {
    const { world } = createMockRenderer({ dom: false });
    const slot = world.ecs.spawn(owner, [Transform({ x: 40, y: 60, scale: 0.5 })]);
    const cell = world.ecs.spawn(owner, [
      Transform({ x: 100, y: 200 }),
      Parent({ entity: slot })
    ]);
    const root = rootPoseOf(world.ecs, cell);
    const local = localPoseOf(world.ecs, slot, root);

    for (const pose of [root, local, localPoseOf(world.ecs, 0, root)]) {
      expect(Object.keys(pose)).not.toContain("scaleX");
      expect(Object.keys(pose)).not.toContain("scaleY");
    }
  });

  // Bug: a factor that composes to 1 is dropped, and a merge into the stored value keeps the stale factor.
  it("keeps a key whose factor is 1 when the stored value has it", () => {
    const { world } = createMockRenderer({ dom: false });
    const parent = world.ecs.spawn(owner, [Transform({ scaleX: 0.5 })]);
    const child: Entity = world.ecs.spawn(owner, [
      Transform({ scaleX: 2 }),
      Parent({ entity: parent })
    ]);
    const root = rootPoseOf(world.ecs, child);

    expect(root.scaleX).toBe(1);
    expect(localPoseOf(world.ecs, parent, root).scaleX).toBe(2);
  });
});

describe("hit test, per axis", () => {
  /**
   * A 100 x 20 box stretched by 2 on X about its centre at (500, 300).
   *
   * @returns The renderer and the box.
   */
  async function stretchedBox(): Promise<{ mock: MockRenderer; box: Entity }> {
    const mock = await started();
    const box = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 500, y: 300, scaleX: 2, pivot: { x: 50, y: 10 } }),
      Shape({ w: 100, h: 20 })
    ]);

    mock.modules.sync.pass();

    return { mock, box };
  }

  // Bug: the inverse ignores scaleX: a point the stretched box covers is a miss.
  it("finds a point 90 units left of the centre and misses one 110 units left", async () => {
    const { mock, box } = await stretchedBox();

    expect(mock.api.sync.hitTest(410, 300, anyEntity)).toBe(box);
    expect(mock.api.sync.hitTest(390, 300, anyEntity)).toBeUndefined();
  });

  // Bug: the X factor is applied on Y too.
  it("does not stretch Y: a point 15 units above the centre is a miss", async () => {
    const { mock } = await stretchedBox();

    expect(mock.api.sync.hitTest(500, 285, anyEntity)).toBeUndefined();
  });
});
