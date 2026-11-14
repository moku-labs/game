import { describe, expect, it } from "vitest";
import { Parent, Transform, type TransformValue } from "../../../renderer/components";
import type { ViewHandle } from "../../../world/projection/types";
import type { Entity, TrackOptions } from "../../../world/types";
import { asComponent } from "../../components";
import { playLoop } from "../../keyframes";
import { localTargetOf } from "../../timeline/space";
import { advanceTracks, beginFrame } from "../../tween/advance";
import { createDriver } from "../../tween/driver";
import { createMockAnim, type MockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit: tweens, keyframe loops and root-space targets of the per-axis scale `scaleX` / `scaleY` (F179). A field the
// view does not carry starts from its neutral 1, never from the target or NaN.
// ---------------------------------------------------------------------------

/** Nothing muted. */
const NONE = (): ReadonlySet<string> => new Set();

/**
 * One frame step of the mock.
 *
 * @param mock - The mock.
 * @param deltaMs - The step.
 */
function step(mock: MockAnim, deltaMs: number): void {
  beginFrame(mock.actx);
  advanceTracks(mock.actx, deltaMs);
}

/**
 * The stored Transform of an entity.
 *
 * @param mock - The mock.
 * @param entity - The entity.
 * @returns Its value.
 */
function transformOf(mock: MockAnim, entity: Entity): Readonly<TransformValue> | undefined {
  return mock.world.ecs.get(entity, Transform);
}

/**
 * A view handle over one entity whose tweens run on the real driver: what `playLoop` needs of one.
 *
 * @param mock - The mock.
 * @param entity - The entity.
 * @returns The handle.
 */
function handleOver(mock: MockAnim, entity: Entity): ViewHandle<unknown> {
  const driver = createDriver(mock.actx);
  const rest = transformOf(mock, entity);

  return {
    rest: (component: { componentName: string }) =>
      component.componentName === Transform.componentName ? rest : undefined,
    tween: (component: Parameters<typeof asComponent>[0], to: object, options: object) =>
      driver.track(
        entity,
        asComponent(component),
        to as Record<string, number>,
        { ease: "out", delayMs: 0, additive: false, ...options } as TrackOptions,
        NONE
      ),
    all: (handles: readonly { cancel(): void }[]) => ({
      cancel: () => {
        for (const handle of handles) handle.cancel();
      }
    })
  } as unknown as ViewHandle<unknown>;
}

describe("a tween of scaleX", () => {
  // Bug: the segments of the unfurl skip scaleX, or the tween touches scale and scaleY.
  it("walks the unfurl from 0.01 through 1.08 at 65 % to 1, scale and scaleY untouched", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ scaleX: 0.01 })]);

    createDriver(mock.actx).track(
      entity,
      asComponent(Transform),
      { scaleX: 1 },
      {
        ms: 260,
        ease: "linear",
        delayMs: 0,
        additive: false,
        segments: [
          { at: 0.65, to: { scaleX: 1.08 } },
          { at: 1, to: { scaleX: 1 } }
        ]
      },
      NONE
    );

    step(mock, 169);
    expect(transformOf(mock, entity)?.scaleX).toBeCloseTo(1.08);

    step(mock, 91);
    expect(transformOf(mock, entity)?.scaleX).toBe(1);
    expect(transformOf(mock, entity)?.scale).toBe(1);
    expect(Object.keys(transformOf(mock, entity) ?? {})).not.toContain("scaleY");
  });

  // Bug: a missing field starts from the target, so the tween jumps there on its first frame.
  it("starts from 1 on a view without the field", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 5 })]);

    createDriver(mock.actx).track(
      entity,
      asComponent(Transform),
      { scaleX: 2 },
      { ms: 100, ease: "linear", delayMs: 0, additive: false },
      NONE
    );

    step(mock, 50);
    expect(transformOf(mock, entity)?.scaleX).toBeCloseTo(1.5);
  });

  // Bug: one of two tracks on one view overwrites the other: a press and an unfurl cannot run together.
  it("runs with a press tween of scale: the drawn X and Y end at 0.92", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ scaleX: 0.01 })]);
    const driver = createDriver(mock.actx);
    const options = { ms: 100, ease: "linear", delayMs: 0, additive: false } as const;

    driver.track(entity, asComponent(Transform), { scale: 0.92 }, options, NONE);
    driver.track(entity, asComponent(Transform), { scaleX: 1 }, options, NONE);
    step(mock, 50);
    step(mock, 50);

    const value = transformOf(mock, entity);

    expect((value?.scale ?? 0) * (value?.scaleX ?? 1)).toBeCloseTo(0.92);
    expect((value?.scale ?? 0) * (value?.scaleY ?? 1)).toBeCloseTo(0.92);
  });
});

describe("a loop keyframe of scaleX", () => {
  // Bug: the loop adds its offset to 0, not to the neutral 1, and the view collapses to 0.05.
  it("peaks at 1.05 on a view at rest without the field", () => {
    const mock = createMockAnim();
    const entity = spawnTestEntity(mock, [Transform({ x: 10 })]);

    playLoop(
      handleOver(mock, entity),
      [
        { at: 0, Transform: { scaleX: 0 } },
        { at: 0.5, ease: "linear", Transform: { scaleX: 0.05 } },
        { at: 1, ease: "linear", Transform: { scaleX: 0 } }
      ],
      400,
      "keep"
    );

    step(mock, 200);
    expect(transformOf(mock, entity)?.scaleX).toBeCloseTo(1.05);
    expect(transformOf(mock, entity)?.scale).toBe(1);
  });
});

describe("a root-space target of scaleX", () => {
  // Bug: the root-space conversion drops scaleX, or divides it by the parent's uniform scale.
  it("lands at local scaleX 0.5 under a parent of scaleX 2", () => {
    const mock = createMockAnim();
    const parent = spawnTestEntity(mock, [Transform({ scaleX: 2, scale: 3 })]);
    const child = spawnTestEntity(mock, [Transform(), Parent({ entity: parent })]);

    expect(localTargetOf(mock.world.ecs, child, asComponent(Transform), { scaleX: 1 })).toEqual({
      scaleX: 0.5
    });
    expect(localTargetOf(mock.world.ecs, child, asComponent(Transform), { scale: 1.5 })).toEqual({
      scale: 0.5
    });
  });
});
