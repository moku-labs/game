import { describe, expect, it } from "vitest";
import type { ComponentType, MotionHandle, ViewHandle } from "../../../world/types";
import { defineMotion } from "../../motion";

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
