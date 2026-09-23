import { describe, expect, it } from "vitest";
import { Shape, Sprite, Transform } from "../../../renderer/components";
import type { ComponentType, Motion, MotionHandle, ViewHandle } from "../../../world/types";
import { asComponent } from "../../components";
import { defineMotion } from "../../motion";
import { advanceTracks, beginFrame } from "../../tween/advance";
import { createDriver } from "../../tween/driver";
import type { MockAnim } from "./mock-anim";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: keyframe tracks of `defineMotion`, played on the real tween driver of `anim`
// through a view handle that behaves like the one `world` hands a motion hook.
// ---------------------------------------------------------------------------

/** The rest pose of the probe: a board hung at (540, 300). */
const REST = { x: 540, y: 300, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } };

/** Nothing is muted. */
const open = (): ReadonlySet<string> => new Set();

/** One tenth of a turn, in radians. */
const TILT = 0.2;

/** The probe: the mock anim world, one entity at rest and the view handle over both. */
type Probe = { mock: MockAnim; entity: number; view: ViewHandle<unknown> };

/**
 * Creates the probe: an entity with a Transform and a Shape at rest, and a view handle whose
 * `tween` starts a real track, the way `world` passes a hook's tween to the installed driver.
 *
 * @returns The probe.
 */
function setup(): Probe {
  const mock = createMockAnim();
  const entity = spawnTestEntity(mock, [Transform(REST), Shape({ alpha: 1 })]);
  const driver = createDriver(mock.actx);
  const rests: Record<string, object> = { Transform: REST, Shape: { ...Shape.defaults } };
  const view = {
    entity,
    key: "board",
    get: (component: ComponentType<object>) => mock.world.ecs.get(entity, component),
    rest: (component: ComponentType<object>) => rests[component.componentName],
    set: (component: ComponentType<object>, patch: object): void => {
      mock.world.ecs.set(entity, component, patch);
    },
    tween: (
      component: ComponentType<object>,
      to: Record<string, number>,
      options: { ms: number }
    ): MotionHandle => driver.track(entity, asComponent(component), to, options, open),
    toRest: (component: ComponentType<object>, options: { ms: number }): MotionHandle => {
      const rest = Object.entries(rests[component.componentName] ?? {}).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number"
      );

      return driver.track(entity, asComponent(component), Object.fromEntries(rest), options, open);
    },
    all: (handles: readonly Motion[]): MotionHandle => {
      const real = handles.filter((entry): entry is MotionHandle => entry !== undefined);

      return {
        finish: (): void => {
          for (const entry of real) entry.finish();
        },
        cancel: (): void => {
          for (const entry of real) entry.cancel();
        },
        active: (): boolean => real.some(entry => entry.active())
      };
    },
    peer: () => undefined
  } as unknown as ViewHandle<unknown>;

  return { mock, entity, view };
}

/**
 * Runs one frame step of the track table.
 *
 * @param probe - The probe.
 * @param deltaMs - Milliseconds of the frame.
 */
function step(probe: Probe, deltaMs: number): void {
  beginFrame(probe.mock.actx);
  advanceTracks(probe.mock.actx, deltaMs);
}

/**
 * Reads the pose of the probe: the four Transform numbers and the Shape alpha.
 *
 * @param probe - The probe.
 * @returns The pose.
 */
function poseOf(probe: Probe): Record<string, number | undefined> {
  const transform = probe.mock.world.ecs.get(probe.entity, Transform);

  return {
    x: transform?.x,
    y: transform?.y,
    rotation: transform?.rotation,
    scale: transform?.scale,
    alpha: probe.mock.world.ecs.get(probe.entity, Shape)?.alpha
  };
}

/** A board that drops in from above the screen and swings out upwards. */
const swing = defineMotion({
  keyframes: {
    dropIn: [
      { at: 0, Transform: { dy: -780, rotation: -TILT, scale: 0.8 }, Shape: { alpha: 0 } },
      { at: 0.5, ease: "in", Transform: { dy: 20, rotation: TILT / 2, scale: 1.04 } }
    ],
    leave: [
      { at: 0.25, ease: "linear", Transform: { dy: 10, rotation: -TILT / 2 } },
      { at: 1, ease: "linear", Transform: { dy: -840, scale: 0.9 }, Shape: { alpha: 0 } }
    ]
  },
  transition: { ms: 1000 },
  on: { enter: "dropIn", exit: "leave" }
});

describe("anim defineMotion — keyframe tracks on enter", () => {
  it("sets the first key at 0 %, with dx and dy as offsets from the rest pose", () => {
    const probe = setup();

    swing.enter?.(probe.view, {});

    expect(poseOf(probe)).toEqual({ x: 540, y: -480, rotation: -TILT, scale: 0.8, alpha: 0 });
  });

  it("reaches a key at its at, holding a field the key does not name", () => {
    const probe = setup();

    swing.enter?.(probe.view, {});
    step(probe, 500);

    expect(poseOf(probe)).toEqual({ x: 540, y: 320, rotation: TILT / 2, scale: 1.04, alpha: 0 });
  });

  it("eases between two keys with the ease of the key the segment ends on", () => {
    const probe = setup();

    swing.enter?.(probe.view, {});
    step(probe, 250);

    // Halfway to the key at 0.5, eased "in" (0.25 of the way): −480 + 800 × 0.25.
    expect(poseOf(probe).y).toBeCloseTo(-280, 9);
  });

  it("eases the last segment into the rest pose with inOut", () => {
    const probe = setup();

    swing.enter?.(probe.view, {});
    step(probe, 625);

    // A quarter into the segment 0.5 → 1, inOut gives 0.125: 320 + (300 − 320) × 0.125.
    expect(poseOf(probe).y).toBeCloseTo(317.5, 9);
  });

  it("ends on the rest pose at the end of the track and stops", () => {
    const probe = setup();
    const motion = swing.enter?.(probe.view, {});

    step(probe, 600);
    step(probe, 400);

    expect(poseOf(probe)).toEqual({ x: 540, y: 300, rotation: 0, scale: 1, alpha: 1 });
    expect(motion?.active()).toBe(false);
    expect(probe.mock.api.active()).toBe(0);
  });

  it("finishes on the rest pose", () => {
    const probe = setup();
    const motion = swing.enter?.(probe.view, {});

    step(probe, 100);
    motion?.finish();

    expect(poseOf(probe)).toEqual({ x: 540, y: 300, rotation: 0, scale: 1, alpha: 1 });
  });

  it("holds the first key until its at when it is later than 0", () => {
    const probe = setup();
    const late = defineMotion({
      keyframes: { rise: [{ at: 0.5, Transform: { dy: 100 } }] },
      transition: { ms: 1000 },
      on: { enter: "rise" }
    });

    late.enter?.(probe.view, {});
    step(probe, 400);

    expect(poseOf(probe).y).toBe(400);

    step(probe, 600);

    expect(poseOf(probe).y).toBe(300);
  });

  it("ends on the rest pose even when a key sits at 1, eased by that key", () => {
    const probe = setup();
    const pop = defineMotion({
      keyframes: {
        pop: [
          { at: 0, Transform: { scale: 0 } },
          { at: 1, ease: "in", Transform: { scale: 2 } }
        ]
      },
      transition: { ms: 100 },
      on: { enter: "pop" }
    });

    pop.enter?.(probe.view, {});
    step(probe, 50);

    // Eased "in" at half the track, toward the rest scale 1 and not toward 2: 0 + 1 × 0.25.
    expect(poseOf(probe).scale).toBeCloseTo(0.25, 9);

    step(probe, 50);

    expect(poseOf(probe).scale).toBe(1);
  });

  it("leaves a component alone that the view does not carry", () => {
    const probe = setup();
    const fade = defineMotion({
      keyframes: { show: [{ at: 0, Sprite: { alpha: 0 }, Transform: { scale: 0.5 } }] },
      on: { enter: "show" }
    });

    fade.enter?.(probe.view, {});

    expect(probe.mock.world.ecs.get(probe.entity, Sprite)).toBeUndefined();
    expect(poseOf(probe).scale).toBe(0.5);
  });
});

describe("anim defineMotion — keyframe tracks on exit", () => {
  it("walks from the rest pose through the keys", () => {
    const probe = setup();

    swing.exit?.(probe.view, {});
    step(probe, 250);

    expect(poseOf(probe)).toEqual({ x: 540, y: 310, rotation: -TILT / 2, scale: 1, alpha: 1 });
  });

  it("ends on the last key, where the element leaves", () => {
    const probe = setup();
    const motion = swing.exit?.(probe.view, {});

    step(probe, 500);
    step(probe, 500);

    expect(poseOf(probe)).toEqual({ x: 540, y: -540, rotation: -TILT / 2, scale: 0.9, alpha: 0 });
    expect(motion?.active()).toBe(false);
  });

  it("holds the last key when it comes before the end of the track", () => {
    const probe = setup();
    const sink = defineMotion({
      keyframes: { sink: [{ at: 0.5, ease: "linear", Transform: { dy: 60 } }] },
      transition: { ms: 400 },
      on: { exit: "sink" }
    });

    sink.exit?.(probe.view, {});
    step(probe, 300);

    expect(poseOf(probe).y).toBe(360);

    step(probe, 100);

    expect(poseOf(probe).y).toBe(360);
    expect(probe.mock.api.active()).toBe(0);
  });
});

describe("anim defineMotion — a state and a keyframe track in one spec", () => {
  it("walks the track on enter and tweens to the state on exit", () => {
    const probe = setup();
    const mixed = defineMotion({
      states: { hidden: { Shape: { alpha: 0 } }, pressed: { Transform: { scale: 0.95 } } },
      keyframes: { dropIn: [{ at: 0, Transform: { dy: -100 } }] },
      transition: { ms: 200, ease: "linear" },
      on: { enter: "dropIn", exit: "hidden", change: ["Transform"] }
    });

    mixed.enter?.(probe.view, {});

    expect(poseOf(probe).y).toBe(200);

    step(probe, 200);

    expect(poseOf(probe).y).toBe(300);

    mixed.exit?.(probe.view, {});
    step(probe, 100);

    expect(poseOf(probe)).toMatchObject({ y: 300, alpha: 0.5 });
    expect(Object.keys(mixed.change ?? {})).toEqual(["Transform"]);
  });

  it("takes a state name in on.enter next to keyframes", () => {
    const probe = setup();
    const mixed = defineMotion({
      states: { hidden: { Transform: { scale: 0 } } },
      keyframes: { leave: [{ at: 1, Transform: { dy: 50 } }] },
      on: { enter: "hidden", exit: "leave" }
    });

    mixed.enter?.(probe.view, {});

    expect(poseOf(probe).scale).toBe(0);
  });
});

describe("anim defineMotion — definition-time errors", () => {
  it("refuses a name that is both a state and a keyframe track", () => {
    expect(() =>
      defineMotion({
        states: { dropIn: { Transform: { scale: 0 } } },
        keyframes: { dropIn: [{ at: 0, Transform: { dy: -100 } }] },
        on: { enter: "dropIn" }
      })
    ).toThrow(
      '[game] Motion "dropIn" is both a state and a keyframe track.\n  Give one of them another name.'
    );
  });

  it("refuses an on.enter that names neither a state nor a track", () => {
    expect(() => defineMotion({ keyframes: { dropIn: [{ at: 0 }] }, on: { enter: "x" } })).toThrow(
      '[game] Motion names "x" in on.enter, but no state or track has it.\n  Define it in states or keyframes.'
    );
  });

  it("refuses an on.exit that names neither a state nor a track", () => {
    expect(() => defineMotion({ states: {}, on: { exit: "gone" } })).toThrow(
      '[game] Motion names "gone" in on.exit, but no state or track has it.\n  Define it in states or keyframes.'
    );
  });

  it("refuses a key whose at is outside 0..1", () => {
    expect(() =>
      defineMotion({ keyframes: { dropIn: [{ at: 1.5 }] }, on: { enter: "dropIn" } })
    ).toThrow('[game] Motion track "dropIn" has a key at 1.5.\n  Keep every at between 0 and 1.');
    expect(() =>
      defineMotion({ keyframes: { dropIn: [{ at: Number.NaN }] }, on: { enter: "dropIn" } })
    ).toThrow('[game] Motion track "dropIn" has a key at NaN.');
  });

  it("refuses keys that are not in ascending order", () => {
    expect(() =>
      defineMotion({
        keyframes: { dropIn: [{ at: 0.5 }, { at: 0.5 }] },
        on: { enter: "dropIn" }
      })
    ).toThrow(
      '[game] Motion track "dropIn" has its keys out of order at 0.5.\n  Sort the keys by at, each one after the one before.'
    );
  });

  it("refuses a track with no key", () => {
    expect(() => defineMotion({ keyframes: { dropIn: [] }, on: { enter: "dropIn" } })).toThrow(
      '[game] Motion track "dropIn" has no keys.\n  Give it at least one key.'
    );
  });
});
