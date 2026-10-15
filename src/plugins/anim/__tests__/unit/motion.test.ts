import { describe, expect, it } from "vitest";
import type { ComponentType, MotionHandle, ViewHandle } from "../../../world/types";
import { defineMotion, printOf } from "../../motion";
import type { MotionKeyframe } from "../../types";

type Call = { call: string; component: string; options?: unknown; to?: unknown };

/**
 * Creates a view handle that records what a motion hook asked it to do.
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
  const view = {
    entity: 1,
    key: "k",
    get: () => undefined,
    rest: () => undefined,
    set: (component: ComponentType<object>, patch: object): void => {
      calls.push({ call: "set", component: component.componentName, to: patch });
    },
    tween: (component: ComponentType<object>, to: object, options: object): MotionHandle => {
      calls.push({ call: "tween", component: component.componentName, to, options });

      return handle;
    },
    toRest: (component: ComponentType<object>, options?: object): MotionHandle => {
      calls.push({ call: "toRest", component: component.componentName, options });

      return handle;
    },
    all: (): MotionHandle => {
      calls.push({ call: "all", component: "" });

      return handle;
    },
    peer: () => undefined
  } as unknown as ViewHandle<unknown>;

  return { view, calls };
}

const buttonMotion = defineMotion({
  states: {
    hidden: { Transform: { scale: 0.8 }, Shape: { alpha: 0 } },
    pressed: { Transform: { scale: 0.95 } }
  },
  transition: { ms: 150, ease: "out" },
  on: { enter: "hidden", exit: "hidden", change: ["Transform"] }
});

describe("anim defineMotion", () => {
  it("sets the enter state and then comes to rest", () => {
    const { view, calls } = createFakeView();
    const motion = buttonMotion.enter?.(view, {});

    expect(calls.slice(0, 2)).toEqual([
      { call: "set", component: "Transform", to: { scale: 0.8 } },
      { call: "set", component: "Shape", to: { alpha: 0 } }
    ]);
    expect(calls.slice(2, 4)).toEqual([
      { call: "toRest", component: "Transform", options: { ms: 150, ease: "out" } },
      { call: "toRest", component: "Shape", options: { ms: 150, ease: "out" } }
    ]);
    expect(calls.at(-1)?.call).toBe("all");
    expect(motion).toBeDefined();
  });

  it("tweens to the exit state and leaves the rest pose alone", () => {
    const { view, calls } = createFakeView();

    buttonMotion.exit?.(view, {});

    expect(calls.some(entry => entry.call === "set")).toBe(false);
    expect(calls.slice(0, 2)).toEqual([
      {
        call: "tween",
        component: "Transform",
        to: { scale: 0.8 },
        options: { ms: 150, ease: "out" }
      },
      { call: "tween", component: "Shape", to: { alpha: 0 }, options: { ms: 150, ease: "out" } }
    ]);
  });

  it("gives one change hook per named component and leaves settle undefined", () => {
    const { view, calls } = createFakeView();

    expect(Object.keys(buttonMotion.change ?? {})).toEqual(["Transform"]);
    expect(buttonMotion.settle).toBeUndefined();

    buttonMotion.change?.Transform?.(view, {} as never, {} as never);

    expect(calls).toEqual([
      { call: "toRest", component: "Transform", options: { ms: 150, ease: "out" } }
    ]);
  });

  it("defaults the transition to 250 ms and ease out", () => {
    const { view, calls } = createFakeView();
    const motion = defineMotion({
      states: { hidden: { Transform: { scale: 0 } } },
      on: { change: ["Transform"] }
    });

    motion.change?.Transform?.(view, {} as never, {} as never);

    expect(calls).toEqual([
      { call: "toRest", component: "Transform", options: { ms: 250, ease: "out" } }
    ]);
  });

  it("omits the hooks the spec did not ask for", () => {
    const motion = defineMotion({ states: { hidden: {} }, on: { enter: "hidden" } });

    expect(motion.enter).toBeDefined();
    expect(motion.exit).toBeUndefined();
    expect(motion.change).toBeUndefined();
  });

  it("skips a state that names a component anim cannot resolve", () => {
    const { view, calls } = createFakeView();
    const motion = defineMotion({
      states: { hidden: { Unknown: { alpha: 0 } } as never },
      on: { enter: "hidden" }
    });

    motion.enter?.(view, {});

    expect(calls).toEqual([{ call: "all", component: "" }]);
  });
});

/** A card that grows in only when a commit adds it. */
const cardMotion = defineMotion({
  states: { small: { Transform: { scale: 0.8 } } },
  transition: { ms: 220, ease: "out" },
  on: { enter: "small", exit: "small" },
  when: "change"
});

describe("anim defineMotion — when", () => {
  it("leaves the view at rest for a mount when it plays only for changes", () => {
    const { view, calls } = createFakeView();

    expect(cardMotion.enter?.(view, {}, undefined, "mount")).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("plays the enter for a change", () => {
    const { view, calls } = createFakeView();

    cardMotion.enter?.(view, {}, undefined, "change");

    expect(calls.map(entry => entry.call)).toEqual(["set", "toRest", "all"]);
  });

  it("plays the enter when no cause is passed", () => {
    const { view, calls } = createFakeView();

    cardMotion.enter?.(view, {});

    expect(calls.map(entry => entry.call)).toEqual(["set", "toRest", "all"]);
  });

  it("plays no exit for a mount when it plays only for changes", () => {
    const { view, calls } = createFakeView();

    expect(cardMotion.exit?.(view, {}, undefined, "mount")).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("plays the enter for a mount without when, as before", () => {
    const { view, calls } = createFakeView();

    buttonMotion.enter?.(view, {}, undefined, "mount");

    expect(calls.map(entry => entry.call)).toEqual(["set", "set", "toRest", "toRest", "all"]);
  });

  it("throws for an unknown when, in the house format", () => {
    expect(() =>
      defineMotion({ states: { small: {} }, on: { enter: "small" }, when: "sometimes" as never })
    ).toThrow('[game] Motion has when "sometimes".\n  Use "always" or "change".');
  });
});

/** A sway of 1200 ms: one swing to 0.05 rad and back. */
const SWAY: readonly MotionKeyframe[] = [
  { at: 0, Transform: { rotation: 0 } },
  { at: 0.5, Transform: { rotation: 0.05 } },
  { at: 1, Transform: { rotation: 0 } }
];

/**
 * The print of a sway loop with the given cycle and reduced-motion rule.
 *
 * @param loop - The cycle and, if any, the reduced-motion rule of the loop.
 * @param loop.ms - One cycle, in milliseconds.
 * @param loop.reduced - What reduced motion does to the loop.
 * @returns The print `defineMotion` stamped on the loop hook.
 */
function swayPrint(loop: { ms: number; reduced?: "cut" | "keep" }): string | undefined {
  return printOf(
    defineMotion({ keyframes: { sway: SWAY }, loop: { track: "sway", ...loop }, on: {} }).loop
  );
}

describe("anim defineMotion — the loop print", () => {
  it("gives two motions with equal loop data equal prints, whatever the key order", () => {
    const first = defineMotion({
      keyframes: { sway: SWAY },
      loop: { track: "sway", ms: 1200 },
      on: {}
    });
    const second = defineMotion({
      on: {},
      loop: { ms: 1200, track: "sway" },
      keyframes: {
        sway: [
          { Transform: { rotation: 0 }, at: 0 },
          { Transform: { rotation: 0.05 }, at: 0.5 },
          { Transform: { rotation: 0 }, at: 1 }
        ]
      }
    });

    expect(printOf(first.loop)).toBeTypeOf("string");
    expect(printOf(first.loop)).toBe(printOf(second.loop));
  });

  it("gives another print for another loop.ms or another loop.reduced", () => {
    expect(swayPrint({ ms: 1200 })).toBe(swayPrint({ ms: 1200, reduced: "cut" }));
    expect(swayPrint({ ms: 1200 })).not.toBe(swayPrint({ ms: 2400 }));
    expect(swayPrint({ ms: 1200 })).not.toBe(swayPrint({ ms: 1200, reduced: "keep" }));
  });

  it("gives no print to a loop whose keys hold a function ease", () => {
    const eased: readonly MotionKeyframe[] = [
      { at: 0, Transform: { rotation: 0 } },
      { at: 0.5, ease: t => t * t, Transform: { rotation: 0.05 } },
      { at: 1, Transform: { rotation: 0 } }
    ];

    expect(
      printOf(defineMotion({ keyframes: { sway: eased }, loop: { track: "sway" }, on: {} }).loop)
    ).toBeUndefined();
  });

  it("gives no print to a hand-written hook", () => {
    expect(printOf(() => undefined)).toBeUndefined();
    expect(printOf(undefined)).toBeUndefined();
  });
});
