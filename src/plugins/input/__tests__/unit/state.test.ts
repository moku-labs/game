import { describe, expect, it } from "vitest";
import { createInputState } from "../../state";
import type { Config } from "../../types";

const config: Config = {
  tapSlopPx: 12,
  longPressMs: 450,
  dragStartPx: 8,
  swipeMinPx: 48,
  swipeMaxMs: 300,
  heldScale: 1
};

describe("createInputState", () => {
  it("starts idle with an empty sample queue and no pointer", () => {
    const state = createInputState({ config });

    expect(state.samples).toEqual([]);
    expect(state.phase).toBe("idle");
    expect(state.pointerId).toBeUndefined();
    expect(state.entity).toBeUndefined();
    expect(state.key).toBeUndefined();
    expect(state.pressedMs).toBe(0);
    expect(state.hovered).toBeUndefined();
  });

  it("starts with a zeroed start point and grab offset and no resources held", () => {
    const state = createInputState({ config });

    expect(state.start).toEqual({ x: 0, y: 0 });
    expect(state.grabOffset).toEqual({ x: 0, y: 0 });
    expect(state.unmute).toBeUndefined();
    expect(state.restScale).toBeUndefined();
    expect(state.canvas).toBeUndefined();
    expect(state.offFrame).toBeUndefined();
    expect(state.detach).toBeUndefined();
  });

  it("gives every app its own state", () => {
    const first = createInputState({ config });
    const second = createInputState({ config });

    first.samples.push({
      kind: "down",
      pointerType: "touch",
      pointerId: 1,
      clientX: 0,
      clientY: 0
    });

    expect(second.samples).toEqual([]);
    expect(first.start).not.toBe(second.start);
  });
});

describe("createInputState and the tap listeners", () => {
  it("starts with no tap listener and no wake", () => {
    const state = createInputState({ config });

    expect(state.tapListeners).toEqual([]);
    expect(state.wake).toBeUndefined();
  });

  it("gives every app its own listener list", () => {
    const first = createInputState({ config });
    const second = createInputState({ config });

    first.tapListeners.push(() => undefined);

    expect(second.tapListeners).toEqual([]);
  });
});
