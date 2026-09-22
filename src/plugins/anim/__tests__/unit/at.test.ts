import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Parent, Transform } from "../../../renderer/components";
import type { Entity } from "../../../world/types";
import { restPoseOf } from "../../timeline/play";
import { defineAnimation, spawned, tween } from "../../timeline/steps";
import type { Target } from "../../types";
import type { MockAnim } from "./mock-anim";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

/**
 * Spawns a board slot at (40, 60), scaled 0.5 and pivoted at (20, 10), and a cell inside it at
 * (100, 200), scaled 2.
 *
 * @param mock - The mock anim world.
 * @returns The slot and the cell.
 */
function slotWithCell(mock: MockAnim): { slot: Entity; cell: Entity } {
  const slot = spawnTestEntity(mock, [
    Transform({ x: 40, y: 60, scale: 0.5, pivot: { x: 20, y: 10 } })
  ]);
  const cell = spawnTestEntity(mock, [
    Transform({ x: 100, y: 200, scale: 2 }),
    Parent({ entity: slot })
  ]);

  return { slot, cell };
}

describe("anim/timeline at() root pose", () => {
  it("answers the root pose of a parented, scaled and pivoted target", () => {
    const mock = createMockAnim();
    const { cell } = slotWithCell(mock);

    expect(restPoseOf(mock.actx, cell)).toEqual({ x: 80, y: 155, rotation: 0, scale: 1 });
  });

  it("turns the pose with a rotated parent", () => {
    const mock = createMockAnim();
    const card = spawnTestEntity(mock, [
      Transform({ x: 100, y: 100, rotation: Math.PI / 2, scale: 2, pivot: { x: 10, y: 0 } })
    ]);
    const stamp = spawnTestEntity(mock, [
      Transform({ x: 10, y: 5, scale: 0.5, pivot: { x: 4, y: 4 } }),
      Parent({ entity: card })
    ]);
    const pose = restPoseOf(mock.actx, stamp);

    expect(pose.x).toBeCloseTo(90);
    expect(pose.y).toBeCloseTo(100);
    expect(pose.rotation).toBeCloseTo(Math.PI / 2);
    expect(pose.scale).toBeCloseTo(1);
  });

  it("composes the rest pose of the target, not its live one", () => {
    const mock = createMockAnim();
    const { cell } = slotWithCell(mock);

    mock.world.projection.registerKey("board", "c3", cell);
    mock.world.projection.setRest(cell, Transform, {
      x: 60,
      y: 30,
      rotation: 0,
      scale: 1,
      pivot: { x: 0, y: 0 }
    });

    expect(restPoseOf(mock.actx, { projection: "board", key: "c3" })).toEqual({
      x: 60,
      y: 70,
      rotation: 0,
      scale: 0.5
    });
  });

  it("hands the root pose to build, so a flight lands on a nested target", () => {
    const mock = createMockAnim();

    mock.start();

    const { cell } = slotWithCell(mock);
    const coin = spawnTestEntity(mock, [Transform({ x: 900, y: 900 })]);
    const flight = defineAnimation("board.fly", {
      slots: { from: type<Target>(), to: type<Target>() },
      build: ({ from, to }, { at }) =>
        tween(from, Transform, { x: at(to).x, y: at(to).y }, { ms: 100 })
    });

    mock.api.play(flight, { from: coin, to: cell }).finish();

    expect(mock.world.ecs.get(coin, Transform)).toMatchObject({ x: 80, y: 155 });
  });

  it("answers the current Transform of a spawned target through the timeline's table", () => {
    const mock = createMockAnim();
    const { cell } = slotWithCell(mock);
    const table = new Map<string, Entity>([["stamp", cell]]);

    expect(restPoseOf(mock.actx, spawned("stamp"), table)).toEqual({
      x: 80,
      y: 155,
      rotation: 0,
      scale: 1
    });
  });

  it("warns and answers the identity pose for a spawned id that is not there yet", () => {
    const mock = createMockAnim();

    expect(restPoseOf(mock.actx, spawned("coin1"))).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1
    });
    expect(mock.log.warn).toHaveBeenCalledWith("anim:target-missing", { spawned: "coin1" });
  });
});
