import { describe, expect, it } from "vitest";
import { createEffectsState } from "../../state";

// ---------------------------------------------------------------------------
// Unit test: createEffectsState
// ---------------------------------------------------------------------------

describe("createEffectsState", () => {
  it("starts with empty particle and filter tables", () => {
    const state = createEffectsState();

    expect(state.emitters.size).toBe(0);
    expect(state.baked.size).toBe(0);
    expect(state.instances.size).toBe(0);
    expect(state.orphans.size).toBe(0);
    expect(state.kinds.size).toBe(0);
    expect(state.checks.size).toBe(0);
    expect(state.views.size).toBe(0);
    expect(state.broken.size).toBe(0);
    expect(state.warned.size).toBe(0);
    expect(state.removers).toEqual([]);
  });

  it("starts on no phone, no seed, no particles and no budget crossed", () => {
    const state = createEffectsState();

    expect(state.phone).toBe(false);
    expect(state.seedCounter).toBe(0);
    expect(state.particles).toBe(0);
    expect(state.over).toEqual({ particles: false, passes: false, fullScreen: false });
  });

  it("gives every app its own tables", () => {
    const first = createEffectsState();
    const second = createEffectsState();

    first.warned.add("emitter:fx.stars");
    first.broken.add("glow");
    first.checks.set("glow", "ok");
    first.removers.push(() => {});
    first.over.passes = true;

    expect(second.warned.size).toBe(0);
    expect(second.broken.size).toBe(0);
    expect(second.checks.size).toBe(0);
    expect(second.removers).toEqual([]);
    expect(second.over.passes).toBe(false);
    expect(second.views).not.toBe(first.views);
    expect(second.instances).not.toBe(first.instances);
  });
});
