import { describe, expect, it } from "vitest";
import type { ComponentType, MotionHandle, ViewHandle } from "../../../world/types";
import type { MotionSpec } from "../../motion";
import { defineMotion, printOf } from "../../motion";
import type { MotionKeyframe } from "../../types";

type Call = { call: string; options: Record<string, unknown> };

/**
 * Creates a view handle that records the options of every track a hook starts. It rests at a
 * Transform and a Shape, so keyframe walks have lanes to start.
 *
 * @returns The handle and the recorded calls.
 */
function createFakeView(): { view: ViewHandle<unknown>; calls: Call[] } {
  const calls: Call[] = [];
  const handle: MotionHandle = {
    finish: (): void => undefined,
    cancel: (): void => undefined,
    active: (): boolean => true
  };
  const rests: Record<string, object> = {
    Transform: { x: 10, y: 20, rotation: 0, scale: 1 },
    Shape: { alpha: 1 }
  };
  const view = {
    entity: 1,
    key: "k",
    get: () => undefined,
    rest: (component: ComponentType<object>) => rests[component.componentName],
    set: (): void => undefined,
    tween: (_component: ComponentType<object>, _to: object, options: object): MotionHandle => {
      calls.push({ call: "tween", options: { ...options } });

      return handle;
    },
    toRest: (_component: ComponentType<object>, options?: object): MotionHandle => {
      calls.push({ call: "toRest", options: { ...options } });

      return handle;
    },
    all: (): MotionHandle => handle,
    peer: () => undefined
  } as unknown as ViewHandle<unknown>;

  return { view, calls };
}

const sway: readonly MotionKeyframe[] = [
  { at: 0, Transform: { rotation: 0 } },
  { at: 0.5, Transform: { rotation: 0.05 } },
  { at: 1, Transform: { rotation: 0 } }
];

/** Every hook of a motion at once: pose enter and exit, a keyframe loop and a change hook. */
const everyHook: MotionSpec = {
  states: { small: { Transform: { scale: 0.8 } } },
  keyframes: { sway },
  loop: { track: "sway", ms: 1200 },
  on: { enter: "small", exit: "small", change: ["Transform"] }
};

/**
 * The labels the tracks of every hook of a motion carried, in hook order: enter, loop, exit, change.
 *
 * @param motion - What `defineMotion` returned.
 * @returns One entry per started track: the label, or `undefined` when its options had none.
 */
function labelsOfEveryHook(motion: ReturnType<typeof defineMotion>): Array<string | undefined> {
  const { view, calls } = createFakeView();

  motion.enter?.(view, {});
  motion.loop?.(view);
  motion.exit?.(view, {});
  motion.change?.Transform?.(view, {} as never, {} as never);

  return calls.map(entry =>
    Object.hasOwn(entry.options, "label") ? String(entry.options.label) : undefined
  );
}

describe("defineMotion id", () => {
  it("labels the tracks of enter, exit, loop and change after the id", () => {
    const motion = defineMotion({ id: "hud.card", ...everyHook });

    expect(motion.id).toBe("hud.card");
    expect(labelsOfEveryHook(motion)).toEqual([
      "hud.card.enter",
      "hud.card.loop",
      "hud.card.exit",
      "hud.card.change"
    ]);
  });

  it("labels the keyframe walks of enter and exit, one per lane", () => {
    const motion = defineMotion({
      id: "hud.card",
      keyframes: { drop: [{ at: 0, Transform: { dy: -50 }, Shape: { alpha: 0 } }, { at: 1 }] },
      on: { enter: "drop", exit: "drop" }
    });
    const { view, calls } = createFakeView();

    motion.enter?.(view, {});
    motion.exit?.(view, {});

    expect(calls.map(entry => entry.options.label)).toEqual([
      "hud.card.enter",
      "hud.card.enter",
      "hud.card.exit",
      "hud.card.exit"
    ]);
  });

  it("adds no id and no label key to a motion without an id", () => {
    const motion = defineMotion(everyHook);
    const { view, calls } = createFakeView();

    motion.enter?.(view, {});
    motion.loop?.(view);
    motion.exit?.(view, {});
    motion.change?.Transform?.(view, {} as never, {} as never);

    expect(Object.hasOwn(motion, "id")).toBe(false);
    expect(calls).toHaveLength(4);
    expect(calls.some(entry => Object.hasOwn(entry.options, "label"))).toBe(false);
  });

  it("refuses an id that is empty or not a string", () => {
    const message =
      '[game] defineMotion: id must be a non-empty string.\n  Give the motion an id such as "hud.card", or leave it out.';

    expect(() => defineMotion({ id: "", ...everyHook })).toThrow(message);
    expect(() => defineMotion({ id: 3 as never, ...everyHook })).toThrow(message);
  });

  it("keeps the loop fingerprint out of the label: equal loops under two ids print the same", () => {
    const one = defineMotion({ id: "hud.one", ...everyHook });
    const other = defineMotion({ id: "hud.other", ...everyHook });
    const none = defineMotion(everyHook);

    expect(printOf(one.loop)).toBeDefined();
    expect(printOf(one.loop)).toBe(printOf(other.loop));
    expect(printOf(one.loop)).toBe(printOf(none.loop));
  });
});
