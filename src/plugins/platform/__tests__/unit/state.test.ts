import { describe, expect, it } from "vitest";
import { createPlatformState } from "../../state";

describe("createPlatformState", () => {
  it("starts asleep, with nothing subscribed and nothing warned", () => {
    const state = createPlatformState();

    expect(state.awake).toBe(false);
    expect(state.offs).toEqual([]);
    expect(state.warned.size).toBe(0);
  });

  it("gives every app its own collections", () => {
    const first = createPlatformState();
    const second = createPlatformState();

    first.warned.add("buzz");

    expect(second.warned.size).toBe(0);
    expect(second.offs).not.toBe(first.offs);
  });
});
