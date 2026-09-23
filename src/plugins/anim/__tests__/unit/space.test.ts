import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Parent, Sprite, Transform } from "../../../renderer/components";
import { rootPoseOf } from "../../../renderer/sync/pose";
import type { Entity } from "../../../world/types";
import { defineAnimation, tween } from "../../timeline/steps";
import type { Target } from "../../types";
import type { MockAnim } from "./mock-anim";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

/** Frames of 16 ms that outlast a 100 ms tween. */
const FRAMES = 10;

/**
 * Spawns the scene of a delivery: the board slot at (40, 60) scaled 0.5 and pivoted at (20, 10)
 * hosting an item at (100, 200) scaled 2 and pivoted at (8, 4), and the HUD at (20, 30) scaled 0.8
 * holding an order card at (600, 100) scaled 1.25 and pivoted at (40, 20).
 *
 * @param mock - The mock anim world.
 * @returns The item and the card.
 */
function deliveryScene(mock: MockAnim): { item: Entity; card: Entity } {
  const slot = spawnTestEntity(mock, [
    Transform({ x: 40, y: 60, scale: 0.5, pivot: { x: 20, y: 10 } })
  ]);
  const item = spawnTestEntity(mock, [
    Transform({ x: 100, y: 200, scale: 2, pivot: { x: 8, y: 4 } }),
    Parent({ entity: slot })
  ]);
  const hud = spawnTestEntity(mock, [Transform({ x: 20, y: 30, scale: 0.8 })]);
  const card = spawnTestEntity(mock, [
    Transform({ x: 600, y: 100, scale: 1.25, pivot: { x: 40, y: 20 } }),
    Parent({ entity: hud })
  ]);

  return { item, card };
}

/** The item flies to where the card rests, in the space the step names. */
const flyRoot = defineAnimation("orders.flyRoot", {
  slots: { item: type<Target>(), card: type<Target>() },
  build: ({ item, card }, { at }) => {
    const pose = at(card);

    return tween(
      item,
      Transform,
      { x: pose.x, y: pose.y, scale: pose.scale },
      { ms: 100, space: "root" }
    );
  }
});

/** The same flight with the space left out, so the target is written as a local pose. */
const flyLocal = defineAnimation("orders.flyLocal", {
  slots: { item: type<Target>(), card: type<Target>() },
  build: ({ item, card }, { at }) => {
    const pose = at(card);

    return tween(item, Transform, { x: pose.x, y: pose.y, scale: pose.scale }, { ms: 100 });
  }
});

/**
 * Runs enough frames for every 100 ms tween to end.
 *
 * @param mock - The mock anim world.
 */
function runOut(mock: MockAnim): void {
  for (let frame = 0; frame < FRAMES; frame += 1) mock.frame(16);
}

describe("anim/timeline tween space", () => {
  it("lands a hosted item on the root pose of the card with space root", () => {
    const mock = createMockAnim();

    mock.start();

    const { item, card } = deliveryScene(mock);
    const cardPose = rootPoseOf(mock.world.ecs, card);

    mock.api.play(flyRoot, { item, card });
    runOut(mock);

    const landed = rootPoseOf(mock.world.ecs, item);

    expect(cardPose).toMatchObject({ x: 500, y: 110, scale: 1 });
    expect(landed.x).toBeCloseTo(cardPose.x);
    expect(landed.y).toBeCloseTo(cardPose.y);
    expect(landed.scale).toBeCloseTo(cardPose.scale);
    expect(mock.world.ecs.get(item, Transform)).toMatchObject({ x: 940, y: 110, scale: 2 });
  });

  it("writes the root target at once, converted, when the timeline is finished before it starts", () => {
    const mock = createMockAnim();

    mock.start();

    const { item, card } = deliveryScene(mock);

    mock.api.play(flyRoot, { item, card }).finish();

    expect(rootPoseOf(mock.world.ecs, item)).toMatchObject({ x: 500, y: 110, scale: 1 });
  });

  it("keeps the local space by default: the target is the item's own Transform", () => {
    const mock = createMockAnim();

    mock.start();

    const { item, card } = deliveryScene(mock);

    mock.api.play(flyLocal, { item, card });
    runOut(mock);

    expect(mock.world.ecs.get(item, Transform)).toMatchObject({ x: 500, y: 110, scale: 1 });
    expect(rootPoseOf(mock.world.ecs, item).x).not.toBeCloseTo(500);
  });

  it("is the same as local for an entity without a parent", () => {
    const mock = createMockAnim();

    mock.start();

    const coin = spawnTestEntity(mock, [Transform({ x: 10, y: 20, pivot: { x: 5, y: 5 } })]);
    const flight = defineAnimation("hud.coin", {
      slots: { coin: type<Target>() },
      build: ({ coin: target }) =>
        tween(target, Transform, { x: 300, y: 400, scale: 0.5 }, { ms: 100, space: "root" })
    });

    mock.api.play(flight, { coin });
    runOut(mock);

    expect(mock.world.ecs.get(coin, Transform)).toMatchObject({ x: 300, y: 400, scale: 0.5 });
  });

  it("turns the target into the space of a rotated parent, rotation included", () => {
    const mock = createMockAnim();

    mock.start();

    const card = spawnTestEntity(mock, [
      Transform({ x: 100, y: 100, rotation: Math.PI / 2, scale: 2, pivot: { x: 10, y: 0 } })
    ]);
    const stamp = spawnTestEntity(mock, [
      Transform({ x: 10, y: 5, scale: 0.5, pivot: { x: 4, y: 4 } }),
      Parent({ entity: card })
    ]);
    const swing = defineAnimation("orders.swing", {
      slots: { stamp: type<Target>() },
      build: ({ stamp: target }) =>
        tween(
          target,
          Transform,
          { x: 300, y: 250, rotation: Math.PI, scale: 1 },
          { ms: 100, space: "root" }
        )
    });

    mock.api.play(swing, { stamp });
    runOut(mock);

    const landed = rootPoseOf(mock.world.ecs, stamp);

    expect(landed.x).toBeCloseTo(300);
    expect(landed.y).toBeCloseTo(250);
    expect(landed.rotation).toBeCloseTo(Math.PI);
    expect(landed.scale).toBeCloseTo(1);
  });

  it("converts only the fields the step names and leaves the others where they are", () => {
    const mock = createMockAnim();

    mock.start();

    const { item } = deliveryScene(mock);
    const shrink = defineAnimation("board.shrink", {
      slots: { item: type<Target>() },
      build: ({ item: target }) =>
        tween(target, Transform, { scale: 0.5 }, { ms: 100, space: "root" })
    });

    mock.api.play(shrink, { item });
    runOut(mock);

    expect(mock.world.ecs.get(item, Transform)).toMatchObject({ x: 100, y: 200, scale: 1 });
    expect(rootPoseOf(mock.world.ecs, item).scale).toBeCloseTo(0.5);
  });

  it("moves a hosted view by x and y alone and keeps its scale", () => {
    const mock = createMockAnim();

    mock.start();

    const { item } = deliveryScene(mock);
    const slide = defineAnimation("board.slide", {
      slots: { item: type<Target>() },
      build: ({ item: target }) =>
        tween(target, Transform, { x: 500, y: 110 }, { ms: 100, space: "root" })
    });

    mock.api.play(slide, { item });
    runOut(mock);

    expect(mock.world.ecs.get(item, Transform)).toMatchObject({ x: 940, y: 110, scale: 2 });
  });

  it("writes a component other than Transform as it is", () => {
    const mock = createMockAnim();

    mock.start();

    const { item } = deliveryScene(mock);

    mock.world.ecs.add(item, Sprite({ texture: "board.item-wood-1" }));

    const fade = defineAnimation("board.fade", {
      slots: { item: type<Target>() },
      build: ({ item: target }) =>
        tween(target, Sprite, { alpha: 0.25 }, { ms: 100, space: "root" })
    });

    mock.api.play(fade, { item });
    runOut(mock);

    expect(mock.world.ecs.get(item, Sprite)?.alpha).toBe(0.25);
    expect(mock.world.ecs.get(item, Transform)).toMatchObject({ x: 100, y: 200, scale: 2 });
  });
});
