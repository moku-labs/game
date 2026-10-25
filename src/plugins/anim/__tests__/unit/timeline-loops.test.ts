import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Parent, Transform } from "../../../renderer/components";
import type { Entity } from "../../../world/types";
import { defineAnimation, mark, parallel, sequence, tween, wait } from "../../timeline/steps";
import type { Target } from "../../types";
import type { MockAnim } from "./mock-anim";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: a timeline's `tween` step with keyframe segments and repeat (F75), and its endless
// tracks under "loops nobody sees write nothing" (F76), over the real cursor and track table.
// ---------------------------------------------------------------------------

const slots = { it: type<Target>() };

/**
 * A started mock world with one entity.
 *
 * @param transform - Where the entity stands.
 * @param options - Config overrides of the anim plugin.
 * @param options.reducedMotion - Start value of reduced motion.
 * @returns The mock and the entity.
 */
function setup(
  transform: Parameters<typeof Transform>[0] = {},
  options: { reducedMotion?: boolean } = {}
): { mock: MockAnim; entity: Entity } {
  const mock = createMockAnim(options);

  mock.start();

  return { mock, entity: spawnTestEntity(mock, [Transform(transform)]) };
}

/**
 * Reads the Transform of an entity.
 *
 * @param mock - The mock anim world.
 * @param entity - The entity.
 * @returns Its Transform fields.
 */
function poseOf(mock: MockAnim, entity: Entity): { x: number; y: number; scale: number } {
  const {
    x = Number.NaN,
    y = Number.NaN,
    scale = Number.NaN
  } = mock.world.ecs.get(entity, Transform) ?? {};

  return { x, y, scale };
}

/** x walks to 100 in the first half, then y walks to 50 in the second; then a mark. */
const walk = defineAnimation("test.walk", {
  slots,
  build: ({ it }) =>
    sequence(
      tween(
        it,
        Transform,
        { x: 100, y: 50 },
        {
          ms: 100,
          ease: "linear",
          segments: [
            { at: 0.5, to: { x: 100 } },
            { at: 1, to: { y: 50 } }
          ]
        }
      ),
      mark("walked")
    )
});

/** A hop of 20 up and back, as offsets over the pose under it, once. */
const hop = defineAnimation("test.hop", {
  slots,
  build: ({ it }) =>
    tween(
      it,
      Transform,
      { y: 0 },
      {
        ms: 100,
        ease: "linear",
        additive: true,
        segments: [
          { at: 0.5, to: { y: -20 } },
          { at: 1, to: { y: 0 } }
        ]
      }
    )
});

/** Three runs of x to 100, then a mark. */
const thrice = defineAnimation("test.thrice", {
  slots,
  build: ({ it }) =>
    sequence(tween(it, Transform, { x: 100 }, { ms: 100, ease: "linear", repeat: 2 }), mark("done"))
});

/** x walks to 100 forever; beside it a mark after 100 ms. */
const sway = defineAnimation("test.sway", {
  slots,
  build: ({ it }) =>
    parallel(
      tween(it, Transform, { x: 100 }, { ms: 100, ease: "linear", repeat: "forever" }),
      sequence(wait(100), mark("beside"))
    )
});

/** The endless sway alone, with what reduced motion does to it. */
function swayAlone(reduced: "cut" | "keep") {
  return defineAnimation(`test.sway.${reduced}`, {
    slots,
    build: ({ it }) =>
      sequence(
        mark("before"),
        parallel(
          tween(it, Transform, { x: 100 }, { ms: 100, ease: "linear", repeat: "forever", reduced }),
          mark("beside")
        )
      )
  });
}

describe("anim/timeline tween — segments", () => {
  it("walks the segments in order on one clock, holds what a segment does not name, then goes on", () => {
    const { mock, entity } = setup();
    const handle = mock.api.play(walk, { it: entity });

    mock.frame(25);

    expect(poseOf(mock, entity)).toMatchObject({ x: 50, y: 0 });

    mock.frame(50);

    expect(poseOf(mock, entity)).toMatchObject({ x: 100, y: 25 });

    mock.frame(25);

    expect(poseOf(mock, entity)).toMatchObject({ x: 100, y: 50 });
    expect(handle.marks()).toEqual(["walked"]);
  });

  it("adds the offsets of an additive walk to the pose under it and leaves the pose there at the end", () => {
    const { mock, entity } = setup({ y: 200 });

    mock.api.play(hop, { it: entity });
    mock.frame(25);

    expect(poseOf(mock, entity).y).toBe(190);

    mock.frame(25);

    expect(poseOf(mock, entity).y).toBe(180);

    mock.frame(50);

    expect(poseOf(mock, entity).y).toBe(200);
  });

  it("turns every segment target into the parent's space with space root", () => {
    const mock = createMockAnim();

    mock.start();

    const slot = spawnTestEntity(mock, [Transform({ x: 100 })]);
    const item = spawnTestEntity(mock, [Transform({ x: 0 }), Parent({ entity: slot })]);
    const fly = defineAnimation("test.flyRoot", {
      slots,
      build: ({ it }) =>
        tween(
          it,
          Transform,
          { x: 500 },
          {
            ms: 100,
            ease: "linear",
            space: "root",
            segments: [
              { at: 0.5, to: { x: 400 } },
              { at: 1, to: { x: 500 } }
            ]
          }
        )
    });

    mock.api.play(fly, { it: item });
    mock.frame(50);

    // Root x 400 under a slot at 100 is local x 300.
    expect(poseOf(mock, item).x).toBe(300);

    mock.frame(50);

    expect(poseOf(mock, item).x).toBe(400);
  });
});

describe("anim/timeline tween — repeat", () => {
  it("runs a counted repeat N + 1 times, then the next step of the sequence starts", () => {
    const { mock, entity } = setup();
    const handle = mock.api.play(thrice, { it: entity });

    for (let frame = 0; frame < 5; frame += 1) mock.frame(50);

    expect(poseOf(mock, entity).x).toBe(50);
    expect(handle.marks()).toEqual([]);

    mock.frame(50);

    expect(poseOf(mock, entity).x).toBe(100);
    expect(handle.marks()).toEqual(["done"]);
    expect(handle.active()).toBe(false);
  });

  it("never ends a forever step: its parallel lives on after the other branch ends", () => {
    const { mock, entity } = setup();
    const handle = mock.api.play(sway, { it: entity });

    for (let frame = 0; frame < 250; frame += 1) mock.frame(40);

    // 10 000 ms: a hundred whole runs, the last one ends on its target.
    expect(handle.marks()).toEqual(["beside"]);
    expect(handle.active()).toBe(true);
    expect(poseOf(mock, entity).x).toBe(100);

    mock.frame(30);

    expect(poseOf(mock, entity).x).toBe(30);
  });
});

describe("anim/timeline tween — a finish, a fast world and headless", () => {
  it("lands a running forever step on its start pose and a counted repeat on its end, and resolves done", async () => {
    const { mock, entity } = setup({ x: 10 });
    const other = spawnTestEntity(mock, [Transform({ x: 0 })]);
    const both = defineAnimation("test.both", {
      slots: { loop: type<Target>(), counted: type<Target>() },
      build: ({ loop, counted }) =>
        parallel(
          tween(loop, Transform, { x: 110 }, { ms: 100, ease: "linear", repeat: "forever" }),
          tween(counted, Transform, { x: 100 }, { ms: 100, ease: "linear", repeat: 4 })
        )
    });
    const handle = mock.api.play(both, { loop: entity, counted: other });

    mock.frame(150);

    expect(poseOf(mock, entity).x).toBe(60);

    mock.world.ecs.setMode("fast");
    mock.frame(16);

    expect(poseOf(mock, entity).x).toBe(10);
    expect(poseOf(mock, other).x).toBe(100);
    expect(handle.active()).toBe(false);
    expect(mock.api.active()).toBe(0);
    await expect(handle.done).resolves.toBeUndefined();
  });

  it("writes nothing for a forever step a fast world finishes before it started", async () => {
    const { mock, entity } = setup({ x: 10 });

    mock.world.ecs.setMode("fast");

    const handle = mock.api.play(sway, { it: entity });

    mock.frame(16);

    expect(poseOf(mock, entity).x).toBe(10);
    expect(handle.marks()).toEqual(["beside"]);
    await expect(handle.done).resolves.toBeUndefined();
  });

  it("leaves an additive forever walk on the pose under it when finished", () => {
    const { mock, entity } = setup({ y: 200, scale: 1 });
    const bounce = defineAnimation("test.bounce", {
      slots,
      build: ({ it }) =>
        tween(
          it,
          Transform,
          { y: 0, scale: 0 },
          {
            ms: 100,
            ease: "linear",
            additive: true,
            repeat: "forever",
            segments: [
              { at: 0.5, to: { y: -20, scale: 0.1 } },
              { at: 1, to: { y: 0, scale: 0 } }
            ]
          }
        )
    });
    const handle = mock.api.play(bounce, { it: entity });

    mock.frame(25);
    handle.finish();

    expect(poseOf(mock, entity)).toEqual({ x: 0, y: 200, scale: 1 });
  });

  it("lands a keyframe step a finish reaches before it started on its whole end, offsets never as values", () => {
    const { mock, entity } = setup({ y: 200, scale: 1 });
    const later = defineAnimation("test.later", {
      slots,
      build: ({ it }) =>
        sequence(
          wait(100),
          tween(
            it,
            Transform,
            { x: 100 },
            {
              ms: 100,
              segments: [
                { at: 0.5, to: { rotation: 0.5 } },
                { at: 1, to: { x: 100 } }
              ]
            }
          ),
          tween(
            it,
            Transform,
            { y: 0, scale: 0 },
            {
              ms: 100,
              additive: true,
              repeat: 1,
              segments: [
                { at: 0.5, to: { y: -20, scale: 0.1 } },
                { at: 1, to: { y: 0, scale: 0 } }
              ]
            }
          )
        )
    });

    mock.api.play(later, { it: entity }).finish();

    expect(mock.world.ecs.get(entity, Transform)).toMatchObject({
      x: 100,
      rotation: 0.5,
      y: 200,
      scale: 1
    });
  });
});

describe("anim/timeline tween — reduced motion", () => {
  it("does not play a forever step under cut: nothing is written and the tree goes on", () => {
    const { mock, entity } = setup({ x: 10 }, { reducedMotion: true });
    const handle = mock.api.play(swayAlone("cut"), { it: entity });

    mock.frame(16);
    mock.frame(50);

    expect(poseOf(mock, entity).x).toBe(10);
    expect(handle.marks()).toEqual(["before", "beside"]);
    expect(handle.active()).toBe(false);
    expect(mock.api.active()).toBe(0);
  });

  it("plays a forever step under keep as written", () => {
    const { mock, entity } = setup({ x: 0 }, { reducedMotion: true });
    const handle = mock.api.play(swayAlone("keep"), { it: entity });

    mock.frame(25);
    mock.frame(100);

    expect(poseOf(mock, entity).x).toBe(25);
    expect(handle.active()).toBe(true);
  });
});

describe("anim/timeline tween — loops nobody sees (F76)", () => {
  it("writes nothing for a held forever step and resumes it at the phase of the time that passed", () => {
    const { mock, entity } = setup();

    mock.api.play(sway, { it: entity });
    mock.frame(25);

    expect(poseOf(mock, entity).x).toBe(25);

    mock.held.add(entity);
    mock.frame(25);
    mock.frame(25);

    expect(poseOf(mock, entity).x).toBe(25);
    expect(mock.asks).toContainEqual({ entity, reveals: "place" });

    mock.held.delete(entity);
    mock.frame(10);

    expect(poseOf(mock, entity).x).toBe(85);
  });

  it("writes a finite step while held: a node may wait for it", () => {
    const { mock, entity } = setup();

    mock.held.add(entity);
    mock.api.play(thrice, { it: entity });
    mock.frame(50);

    expect(poseOf(mock, entity).x).toBe(50);
    expect(mock.asks).toEqual([]);
  });
});
