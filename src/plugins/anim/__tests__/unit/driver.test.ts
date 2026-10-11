import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import type { Entity, TweenDriver } from "../../../world/types";
import { Animation } from "../../components";
import { advanceTracks, beginFrame, fieldKey, startTrack } from "../../tween/advance";
import { createDriver } from "../../tween/driver";
import type { MockAnim } from "./mock-anim";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

/** Nothing is muted. */
const open = (): ReadonlySet<string> => new Set();

/** The `x` field belongs to another writer. */
const mutedX = (): ReadonlySet<string> => new Set(["x"]);

/**
 * Runs one frame step of the track table only.
 *
 * @param mock - The mock anim world.
 * @param deltaMs - Milliseconds of the frame.
 */
function step(mock: MockAnim, deltaMs: number): void {
  beginFrame(mock.actx);
  advanceTracks(mock.actx, deltaMs);
}

/**
 * Creates the real driver over the mock world with one entity at the origin.
 *
 * @returns The mock, the driver and the entity.
 */
function setup(): { mock: MockAnim; driver: TweenDriver; entity: Entity } {
  const mock = createMockAnim();
  const entity = spawnTestEntity(mock, [Transform()]);

  return { mock, driver: createDriver(mock.actx), entity };
}

describe("anim/tween driver", () => {
  it("reads the start values when the delay ends, never earlier", () => {
    const { mock, driver, entity } = setup();

    driver.track(entity, Transform, { x: 100 }, { ms: 100, ease: "linear", delayMs: 100 }, open);
    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(0);

    mock.world.ecs.set(entity, Transform, { x: 20 });
    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(20);

    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(60);
  });

  it("writes the exact target on the last frame", () => {
    const { mock, driver, entity } = setup();

    driver.track(entity, Transform, { x: 100 }, { ms: 100, ease: "outBack" }, open);
    step(mock, 50);
    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(mock.api.active()).toBe(0);
  });

  it("writes through ecs.set, so changed() sees the entity", () => {
    const { mock, driver, entity } = setup();

    driver.track(entity, Transform, { x: 10 }, { ms: 100 }, open);
    step(mock, 50);

    expect([...mock.world.ecs.changed(Transform)]).toContain(entity);
  });

  it("finishes and cancels idempotently", () => {
    const { mock, driver, entity } = setup();
    const finished = driver.track(entity, Transform, { x: 100 }, { ms: 100 }, open);

    finished.finish();
    finished.finish();

    expect(finished.active()).toBe(false);
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);

    const cancelled = driver.track(entity, Transform, { y: 100 }, { ms: 100 }, open);

    cancelled.cancel();
    cancelled.cancel();

    expect(cancelled.active()).toBe(false);
    expect(mock.world.ecs.get(entity, Transform)?.y).toBe(0);
    expect(mock.api.active()).toBe(0);
  });

  it("skips a muted field, on a frame and on finish", () => {
    const { mock, driver, entity } = setup();
    const handle = driver.track(entity, Transform, { x: 100, y: 50 }, { ms: 100 }, mutedX);

    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(0);

    handle.finish();

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(0);
    expect(mock.world.ecs.get(entity, Transform)?.y).toBe(50);
  });

  it("ends a track whose entity died, without writing and without a log entry", () => {
    const { mock, driver, entity } = setup();
    const handle = driver.track(entity, Transform, { x: 100 }, { ms: 100 }, open);

    mock.world.ecs.despawn(entity);
    step(mock, 50);

    expect(handle.active()).toBe(false);
    expect(mock.api.active()).toBe(0);
    expect(mock.log.warn).not.toHaveBeenCalled();
    expect(mock.log.error).not.toHaveBeenCalled();
  });

  it("cancels the older owner of a field, field by field", () => {
    const { mock, driver, entity } = setup();
    const first = driver.track(entity, Transform, { x: 100, y: 100 }, { ms: 100 }, open);

    driver.track(entity, Transform, { x: 200 }, { ms: 100 }, open);

    expect(first.active()).toBe(true);

    const second = driver.track(entity, Transform, { y: 200 }, { ms: 100 }, open);

    expect(first.active()).toBe(false);
    expect(second.active()).toBe(true);
    expect(mock.api.active()).toBe(2);
  });

  it("starts the new track from where the picture is", () => {
    const { mock, driver, entity } = setup();

    driver.track(entity, Transform, { x: 100 }, { ms: 100, ease: "linear" }, open);
    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(50);

    driver.track(entity, Transform, { x: 150 }, { ms: 100, ease: "linear" }, open);
    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
  });

  it("sums two additive tracks over the base and writes the field clean when the last ends", () => {
    const { mock, driver, entity } = setup();

    driver.track(entity, Transform, { x: 10 }, { ms: 100, ease: "linear", additive: true }, open);
    driver.track(entity, Transform, { x: 20 }, { ms: 100, ease: "linear", additive: true }, open);
    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(15);

    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(0);
    expect(mock.api.active()).toBe(0);
  });

  it("adds an additive offset over the value the absolute owner writes", () => {
    const { mock, driver, entity } = setup();

    driver.track(entity, Transform, { x: 100 }, { ms: 100, ease: "linear" }, open);
    driver.track(entity, Transform, { x: 10 }, { ms: 100, ease: "linear", additive: true }, open);
    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(55);
  });

  it("reports what its additive tracks add to a component right now, and nothing for other fields", () => {
    const { mock, driver, entity } = setup();

    driver.track(entity, Transform, { x: 100 }, { ms: 100, ease: "linear" }, open);
    driver.track(entity, Transform, { x: 10 }, { ms: 100, ease: "linear", additive: true }, open);
    driver.track(entity, Transform, { x: 20 }, { ms: 100, ease: "linear", additive: true }, open);

    // Nothing was written yet: the tracks add nothing so far.
    expect(driver.offsetsOf?.(entity, Transform)).toEqual({ x: 0 });

    step(mock, 50);

    // Half way: 5 and 10 on top of the 50 the absolute track holds. `y` has no additive track.
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(65);
    expect(driver.offsetsOf?.(entity, Transform)).toEqual({ x: 15 });
    expect(driver.offsetsOf?.(entity, Animation)).toEqual({});

    step(mock, 50);

    // The additive tracks ended and wrote the field clean: nothing is added any more.
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(driver.offsetsOf?.(entity, Transform)).toEqual({});
  });

  it("guard: files the additive tracks per entity, and keeps none that ended", () => {
    const { mock, driver, entity } = setup();
    const other = spawnTestEntity(mock, [Transform()]);

    driver.track(entity, Transform, { x: 10 }, { ms: 100, ease: "linear", additive: true }, open);
    driver.track(other, Transform, { x: 40 }, { ms: 200, ease: "linear", additive: true }, open);
    driver.track(other, Transform, { y: 9 }, { ms: 100, ease: "linear" }, open);
    step(mock, 50);

    // Each entity answers for its own additive tracks only.
    expect(driver.offsetsOf?.(entity, Transform)).toEqual({ x: 5 });
    expect(driver.offsetsOf?.(other, Transform)).toEqual({ x: 10 });
    expect(mock.state.additive.size).toBe(2);

    step(mock, 50);

    // The track of the first entity ended, and so did its entry.
    expect(driver.offsetsOf?.(entity, Transform)).toEqual({});
    expect([...mock.state.additive.keys()]).toEqual([other]);

    driver.cancelAll(other);

    expect(mock.state.additive.size).toBe(0);
  });

  it("lets an additive track add to where another writer left a field it owned: no jump back", () => {
    const { mock, driver, entity } = setup();
    const owned = new Set<string>();

    // A bob on `y`, as the loop of a view: 10 up and back in 400 ms, forever.
    driver.track(
      entity,
      Transform,
      { y: 0 },
      {
        ms: 400,
        ease: "linear",
        additive: true,
        repeat: "forever",
        segments: [
          { at: 0.5, to: { y: 10 } },
          { at: 1, to: { y: 0 } }
        ]
      },
      () => owned
    );
    step(mock, 100);

    expect(mock.world.ecs.get(entity, Transform)?.y).toBe(5);

    // The hand takes the field, drags the entity away and holds it over a frame.
    owned.add("y");
    mock.world.ecs.set(entity, Transform, { y: -250 });
    step(mock, 100);

    expect(mock.world.ecs.get(entity, Transform)?.y).toBe(-250);

    // The hand lets go. The bob adds to where the entity stands: this frame leaves it there.
    owned.clear();
    step(mock, 16);

    expect(mock.world.ecs.get(entity, Transform)?.y).toBeCloseTo(-250, 6);

    // It walks on from there: 216 ms into its cycle the bob added 9.2, at 300 ms it adds 5.
    step(mock, 84);

    expect(mock.world.ecs.get(entity, Transform)?.y).toBeCloseTo(-254.2, 6);
    expect(mock.api.active()).toBe(1);
  });

  it.each([
    ["did not write it", (): void => undefined],
    [
      "wrote the value that stood there",
      (mock: MockAnim, entity: Entity): void => {
        mock.world.ecs.set(entity, Transform, { y: 5 });
      }
    ]
  ] as const)("keeps the base of a field another writer owned and %s", (_what, hold) => {
    const { mock, driver, entity } = setup();
    const owned = new Set<string>();
    const bob = driver.track(
      entity,
      Transform,
      { y: 0 },
      {
        ms: 400,
        ease: "linear",
        additive: true,
        repeat: "forever",
        segments: [
          { at: 0.5, to: { y: 10 } },
          { at: 1, to: { y: 0 } }
        ]
      },
      () => owned
    );

    step(mock, 100);

    expect(mock.world.ecs.get(entity, Transform)?.y).toBe(5);

    // The hand takes the field and holds the entity where it stands, over six frames.
    owned.add("y");

    for (let frame = 0; frame < 6; frame += 1) {
      hold(mock, entity);
      step(mock, 16);
    }

    expect(mock.world.ecs.get(entity, Transform)?.y).toBe(5);

    owned.clear();
    step(mock, 16);

    // Nobody moved the field: 212 ms into its cycle the bob adds 9.4, over the base it had.
    expect(mock.world.ecs.get(entity, Transform)?.y).toBeCloseTo(9.4, 6);

    bob.cancel();

    // The value under the bob is where it always was.
    expect(mock.world.ecs.get(entity, Transform)?.y).toBe(0);
  });

  it("starts a track home from where the hand let go, in a field a loop adds to", () => {
    const { mock, driver, entity } = setup();
    const owned = new Set<string>();

    driver.track(
      entity,
      Transform,
      { y: 0 },
      {
        ms: 400,
        ease: "linear",
        additive: true,
        repeat: "forever",
        segments: [
          { at: 0.5, to: { y: 10 } },
          { at: 1, to: { y: 0 } }
        ]
      },
      () => owned
    );
    step(mock, 100);
    owned.add("y");
    mock.world.ecs.set(entity, Transform, { x: 400, y: -250 });
    step(mock, 100);
    owned.clear();
    // The settle of the drop: both fields go home over 100 ms.
    driver.track(entity, Transform, { x: 0, y: 0 }, { ms: 100, ease: "linear" }, () => owned);
    step(mock, 50);

    // Half the way in both fields: `y` did not jump to the base the bob kept. The value under
    // the bob was -257.5 at the release, and the bob adds 7.5 at 250 ms.
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(200);
    expect(mock.world.ecs.get(entity, Transform)?.y).toBeCloseTo(-121.25, 6);

    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(0);
    expect(mock.world.ecs.get(entity, Transform)?.y).toBeCloseTo(5, 6);
  });

  it("counts the Animation component up per track and removes it with cancelAll", () => {
    const { mock, driver, entity } = setup();

    driver.track(entity, Transform, { x: 100 }, { ms: 100 }, open);
    driver.track(entity, Transform, { y: 100 }, { ms: 100 }, open);

    expect(mock.world.ecs.get(entity, Animation)).toEqual({ playing: 2 });

    driver.cancelAll(entity);

    expect(mock.world.ecs.has(entity, Animation)).toBe(false);
    expect(mock.api.active()).toBe(0);
  });

  it("wakes the clock once per track", () => {
    const { mock, driver, entity } = setup();

    expect(mock.wakes.count).toBe(0);

    driver.track(entity, Transform, { x: 100 }, { ms: 100 }, open);

    expect(mock.wakes.count).toBe(1);

    driver.track(entity, Transform, { y: 100 }, { ms: 100 }, open);

    expect(mock.wakes.count).toBe(2);
  });

  it("warns once when the track count rises past maxTracks", () => {
    const mock = createMockAnim({ maxTracks: 1 });
    const driver = createDriver(mock.actx);
    const entity = spawnTestEntity(mock, [Transform()]);

    driver.track(entity, Transform, { x: 1 }, { ms: 100 }, open);
    driver.track(entity, Transform, { y: 1 }, { ms: 100 }, open);
    driver.track(entity, Transform, { rotation: 1 }, { ms: 100 }, open);

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("anim:too-many-tracks", { tracks: 2, maxTracks: 1 });
  });

  it("books the key of every field once, when the track starts", () => {
    const { mock, entity } = setup();
    const track = startTrack(
      mock.actx,
      entity,
      Transform,
      { x: 10 },
      { ms: 100, segments: [{ at: 1, to: { y: 5 } }] },
      open
    );

    expect(track.keys).toEqual({
      x: fieldKey(entity, "Transform", "x"),
      y: fieldKey(entity, "Transform", "y")
    });
  });

  it("hands back an inactive handle for a target with no numeric field", () => {
    const { driver, entity, mock } = setup();

    expect(driver.track(entity, Transform, {}, { ms: 100 }, open).active()).toBe(false);
    expect(mock.api.active()).toBe(0);
  });
});

describe("anim/tween driver — keyframe segments", () => {
  it("walks the segments of a track on one clock, each with its own ease", () => {
    const { mock, driver, entity } = setup();
    const segments = [
      { at: 0.5, ease: "linear", to: { x: 100 } },
      { at: 1, ease: "in", to: { x: 50 } }
    ] as const;

    driver.track(entity, Transform, { x: 50 }, { ms: 200, ease: "linear", segments }, open);
    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(50);

    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);

    // Halfway through the second segment, eased "in": 100 + (50 − 100) × 0.25.
    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(87.5);

    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(50);
    expect(mock.api.active()).toBe(0);
  });

  it("eases a segment that names no curve with the curve of the track", () => {
    const { mock, driver, entity } = setup();

    driver.track(
      entity,
      Transform,
      { x: 100 },
      { ms: 100, ease: "in", segments: [{ at: 1, to: { x: 100 } }] },
      open
    );
    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(25);
  });

  it("holds a field a segment does not name where the segment before left it", () => {
    const { mock, driver, entity } = setup();
    const segments = [
      { at: 0.5, ease: "linear", to: { x: 100 } },
      { at: 1, ease: "linear", to: { y: 40 } }
    ] as const;

    driver.track(entity, Transform, { x: 100, y: 40 }, { ms: 100, segments }, open);
    step(mock, 25);

    expect(mock.world.ecs.get(entity, Transform)).toMatchObject({ x: 50, y: 0 });

    step(mock, 50);

    expect(mock.world.ecs.get(entity, Transform)).toMatchObject({ x: 100, y: 20 });

    step(mock, 25);

    expect(mock.world.ecs.get(entity, Transform)).toMatchObject({ x: 100, y: 40 });
  });

  it("claims every field a segment names, so an older owner of that field loses it", () => {
    const { mock, driver, entity } = setup();
    const older = driver.track(entity, Transform, { y: 300 }, { ms: 1000 }, open);
    const walk = driver.track(
      entity,
      Transform,
      { x: 10 },
      {
        ms: 100,
        segments: [
          { at: 0.5, to: { y: 50 } },
          { at: 1, to: { x: 10 } }
        ]
      },
      open
    );

    expect(older.active()).toBe(false);

    walk.finish();

    // The target was filled with the last value each segment field reached.
    expect(mock.world.ecs.get(entity, Transform)).toMatchObject({ x: 10, y: 50 });
    expect(mock.api.active()).toBe(0);
  });

  it("holds the last target once the time is past the last segment", () => {
    const { mock, driver, entity } = setup();
    const walk = driver.track(
      entity,
      Transform,
      { x: 100 },
      { ms: 100, segments: [{ at: 0.5, ease: "linear", to: { x: 100 } }] },
      open
    );

    step(mock, 75);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(100);
    expect(walk.active()).toBe(true);

    step(mock, 25);

    expect(walk.active()).toBe(false);
  });

  it("jumps to a segment that ends at 0 on the first frame", () => {
    const { mock, driver, entity } = setup();
    const segments = [
      { at: 0, to: { x: 80 } },
      { at: 1, ease: "linear", to: { x: 0 } }
    ] as const;

    driver.track(entity, Transform, { x: 0 }, { ms: 100, segments }, open);
    step(mock, 25);

    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(60);
  });
});
