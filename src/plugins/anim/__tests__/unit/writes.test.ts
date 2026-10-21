import { describe, expect, it, type MockInstance, vi } from "vitest";
import { Transform } from "../../../renderer/components";
import { component } from "../../../world/ecs/define";
import type { AnyComponentType } from "../../../world/ecs/types";
import type { Entity, TweenDriver, Api as WorldApi } from "../../../world/types";
import { Animation } from "../../components";
import { advanceTracks, beginFrame } from "../../tween/advance";
import { createDriver } from "../../tween/driver";
import type { MockAnim } from "./mock-anim";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: a track writes only the fields whose value changed (F19b). Every `ecs.set` marks
// its component changed, so a write of the value the field holds is work for `effects`, `sync`
// and the frame history, and garbage, for nothing.
// ---------------------------------------------------------------------------

/** A filter value a glint cycle drives. */
const Glow = component("Glow", { amount: 0 });

/** Nothing is muted. */
const open = (): ReadonlySet<string> => new Set();

/**
 * The glints' cycle: up to 0.6 in 150 ms, a hold of 300 ms, down to 0.2 in 150 ms, forever.
 */
const GLINT = [
  { at: 0.25, ease: "linear", to: { amount: 0.6 } },
  { at: 0.75, ease: "linear", to: { amount: 0.6 } },
  { at: 1, ease: "linear", to: { amount: 0.2 } }
] as const;

/** The mock, the real driver, one entity and the spy on the world's `ecs.set`. */
type Setup = {
  mock: MockAnim;
  driver: TweenDriver;
  entity: Entity;
  set: MockInstance<WorldApi["ecs"]["set"]>;
};

/**
 * Creates the real driver over the mock world with one entity, and spies on `ecs.set`.
 *
 * @param components - Component values the entity starts with.
 * @returns The mock, the driver, the entity and the spy.
 */
function setup(components: Parameters<typeof spawnTestEntity>[1]): Setup {
  const mock = createMockAnim();
  const entity = spawnTestEntity(mock, components);
  const set = vi.spyOn(mock.world.ecs, "set");

  return { mock, driver: createDriver(mock.actx), entity, set };
}

/**
 * Runs one frame step of the track table and returns the patches written into one component.
 *
 * @param context - The setup.
 * @param deltaMs - Milliseconds of the frame.
 * @param type - The component whose writes are returned.
 * @returns The patches of this frame, in order.
 */
function step(context: Setup, deltaMs: number, type: AnyComponentType): unknown[] {
  context.set.mockClear();
  beginFrame(context.mock.actx);
  advanceTracks(context.mock.actx, deltaMs);

  return context.set.mock.calls.filter(call => call[1] === type).map(call => call[2]);
}

describe("anim/tween — writes only what changed", () => {
  it("writes nothing in the frames a loop stands still between two keys, and every frame it moves", () => {
    const context = setup([Glow({ amount: 0.2 })]);
    const { mock, driver, entity } = context;

    driver.track(
      entity,
      Glow,
      { amount: 0.2 },
      { ms: 600, repeat: "forever", segments: GLINT },
      open
    );

    // 50, 100 and 150 ms: the way up, one write a frame.
    for (let frame = 0; frame < 3; frame += 1) expect(step(context, 50, Glow)).toHaveLength(1);

    expect(mock.world.ecs.get(entity, Glow)?.amount).toBe(0.6);

    // 200 to 450 ms: the hold. The value is the one the component holds: no write at all.
    for (let frame = 0; frame < 6; frame += 1) expect(step(context, 50, Glow)).toEqual([]);

    expect(mock.world.ecs.get(entity, Glow)?.amount).toBe(0.6);

    // 500 ms: the way down starts, and is written.
    expect(step(context, 50, Glow)).toHaveLength(1);
    expect(mock.world.ecs.get(entity, Glow)?.amount).toBeCloseTo(0.4667, 4);
  });

  it("writes a held field back in the next frame when another writer moved it", () => {
    const context = setup([Glow({ amount: 0.2 })]);
    const { mock, driver, entity } = context;

    driver.track(
      entity,
      Glow,
      { amount: 0.2 },
      { ms: 600, repeat: "forever", segments: GLINT },
      open
    );
    for (let frame = 0; frame < 4; frame += 1) step(context, 50, Glow);

    // In the hold, a system writes the filter: the track's value differs from it now.
    mock.world.ecs.set(entity, Glow, { amount: 0.9 });

    expect(step(context, 50, Glow)).toEqual([{ amount: 0.6 }]);
    expect(mock.world.ecs.get(entity, Glow)?.amount).toBe(0.6);
  });

  it("writes nothing for a track whose target is the value it starts from, and still ends it", () => {
    const context = setup([Transform({ x: 10 })]);
    const { mock, driver, entity } = context;

    driver.track(entity, Transform, { x: 10 }, { ms: 100, ease: "linear" }, open);

    expect(step(context, 50, Transform)).toEqual([]);
    expect(mock.world.ecs.get(entity, Animation)?.playing).toBe(1);
    expect(step(context, 50, Transform)).toEqual([]);
    expect(mock.api.active()).toBe(0);
    expect(mock.world.ecs.get(entity, Animation)).toBeUndefined();
  });

  it("writes only the fields that changed: a held field is left out of the patch", () => {
    const context = setup([Transform({ x: 0, y: 5 })]);
    const { mock, driver, entity } = context;

    driver.track(entity, Transform, { x: 100, y: 5 }, { ms: 100, ease: "linear" }, open);

    expect(step(context, 50, Transform)).toEqual([{ x: 50 }]);
    expect(step(context, 50, Transform)).toEqual([{ x: 100 }]);
    expect(mock.world.ecs.get(entity, Transform)).toMatchObject({ x: 100, y: 5 });
  });

  it("does not write a field that stands on NaN again every frame", () => {
    const context = setup([Glow({ amount: Number.NaN })]);
    const { mock, driver, entity } = context;

    driver.track(entity, Glow, { amount: Number.NaN }, { ms: 100, ease: "linear" }, open);

    expect(step(context, 50, Glow)).toEqual([]);
    expect(step(context, 50, Glow)).toEqual([]);
    expect(mock.api.active()).toBe(0);
  });

  it("writes the base back when an additive track ends only when the field stands off it", () => {
    const walk = [
      { at: 0.5, ease: "linear", to: { x: 10 } },
      { at: 1, ease: "linear", to: { x: 0 } }
    ] as const;
    const home = setup([Transform({ x: 40 })]);

    // A walk that ends at no offset lands on the base: its last frame writes it, the end does not.
    home.driver.track(
      home.entity,
      Transform,
      { x: 0 },
      { ms: 100, additive: true, segments: walk },
      open
    );
    step(home, 50, Transform);

    expect(step(home, 50, Transform)).toEqual([{ x: 40 }]);
    expect(home.mock.api.active()).toBe(0);

    const away = setup([Transform({ x: 40 })]);

    // A straight additive track ends on its offset: the end writes the base back.
    away.driver.track(
      away.entity,
      Transform,
      { x: 50 },
      { ms: 100, ease: "linear", additive: true },
      open
    );
    step(away, 50, Transform);

    expect(step(away, 50, Transform)).toEqual([{ x: 50 }, { x: 40 }]);
    expect(away.mock.world.ecs.get(away.entity, Transform)?.x).toBe(40);
  });
});

describe("anim/tween — a 0 ms track lands as it starts (F47)", () => {
  // Bug (A Memory Missing, inspect plate): ui writes a new rest pose through a 0 ms track in phase layout; the track
  // wrote the position at the next frame step while the pivot was written at once, and the plate jumped for a frame.
  it("writes its target when it starts, and the next frame step ends it and its Animation", () => {
    const context = setup([Transform({ x: 0, y: 0 })]);
    const { mock, driver, entity } = context;

    beginFrame(mock.actx);
    driver.track(entity, Transform, { x: 40, y: 20 }, { ms: 0 }, open);

    expect(mock.world.ecs.get(entity, Transform)).toMatchObject({ x: 40, y: 20 });

    step(context, 16, Transform);
    step(context, 16, Transform);

    expect(mock.world.ecs.get(entity, Animation)).toBeUndefined();
    expect(mock.world.ecs.get(entity, Transform)).toMatchObject({ x: 40, y: 20 });
  });

  // The other side: a delayed or a timed track still waits for its frame steps.
  it("leaves a 0 ms track with a delay, and a timed one, to the frame steps", () => {
    const context = setup([Transform({ x: 0, y: 0 })]);
    const { mock, driver, entity } = context;

    beginFrame(mock.actx);
    driver.track(entity, Transform, { x: 40 }, { ms: 0, delayMs: 32 }, open);
    driver.track(entity, Transform, { y: 20 }, { ms: 100 }, open);

    expect(mock.world.ecs.get(entity, Transform)).toMatchObject({ x: 0, y: 0 });
  });
});
