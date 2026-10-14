import { afterEach, describe, expect, it, vi } from "vitest";
import { targetResolution } from "../../host/resolution";
import { createRendererState } from "../../state";
import type { Config } from "../../types";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit: the drawing resolution (spec 11 R2, contract C-d, LEAD-FIXES-4 item 1):
// one mechanism, applied on the resize path of the next frame; devicePixelRatio
// followed; `monitor.setResolution` overrides in every build; the config checked.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Yields the microtask queue, so a restore inside the renderer can finish. */
async function tick(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

/** A `matchMedia` whose queries a test fires by hand. */
function stubMatchMedia(): { queries: string[]; fire(): void; removed: number } {
  const armed: Array<{ query: string; listener: () => void }> = [];
  const media = {
    queries: [] as string[],
    removed: 0,
    fire: (): void => {
      const last = armed.pop();

      last?.listener();
    }
  };

  vi.stubGlobal("matchMedia", (query: string) => {
    media.queries.push(query);

    return {
      addEventListener: (_type: string, listener: () => void) => armed.push({ query, listener }),
      removeEventListener: () => {
        media.removed += 1;
      }
    };
  });

  return media;
}

/** One frame of the mock: the render phase applies what is pending. */
function frame(mock: MockRenderer): void {
  mock.runPhase("input");
  mock.runPhase("render");
}

describe("targetResolution", () => {
  it("takes the override over the device pixels under the cap", () => {
    expect(targetResolution({ dpr: 2.81, cap: 2, override: undefined })).toBe(2);
    expect(targetResolution({ dpr: 1.5, cap: 2, override: undefined })).toBe(1.5);
    expect(targetResolution({ dpr: 2.81, cap: 2, override: 1.75 })).toBe(1.75);
  });
});

describe("the devicePixelRatio follow", () => {
  it("draws at the new ratio under the cap from the next frame and arms itself for that ratio", async () => {
    const media = stubMatchMedia();
    const mock = createMockRenderer({ dpr: 1 });
    const heard = vi.fn();

    await mock.start();
    mock.modules.host.onResolution(heard);

    expect(media.queries).toEqual(["(resolution: 1dppx)"]);

    vi.stubGlobal("devicePixelRatio", 2.81);
    media.fire();

    expect(media.queries.at(-1)).toBe("(resolution: 2.81dppx)");

    frame(mock);

    const { renderer } = mock.pixi.last();

    expect(renderer.resolutions.at(-1)).toBe(2);
    expect(mock.api.host.resolution()).toBe(2);
    expect(heard).toHaveBeenCalledWith(1, 2, "dpr");
  });

  it("asks for nothing when the ratio did not change what is drawn", async () => {
    const media = stubMatchMedia();
    const mock = createMockRenderer({ dpr: 1 });

    await mock.start();

    const before = mock.pixi.last().renderer.resizes.length;

    media.fire();
    frame(mock);

    expect(mock.modules.host.resolutionPending()).toBe(false);
    expect(mock.pixi.last().renderer.resizes).toHaveLength(before);
  });

  it("drops its query when the renderer stops", async () => {
    const media = stubMatchMedia();
    const mock = createMockRenderer();

    await mock.start();
    mock.stop();

    expect(media.removed).toBe(1);
  });
});

describe("monitor.setResolution", () => {
  it("overrides the policy from the next frame, in a build without the agent flag too", async () => {
    const mock = createMockRenderer({ dpr: 2.81, config: { maxResolution: 4 } });
    const heard = vi.fn();

    await mock.start();
    mock.modules.host.onResolution(heard);

    expect(mock.api.host.resolution()).toBe(2.81);
    expect(mock.api.monitor.setResolution(2)).toBe(2);
    expect(mock.api.host.resolution()).toBe(2.81);

    frame(mock);

    expect(mock.api.host.resolution()).toBe(2);
    expect(heard).toHaveBeenCalledWith(2.81, 2, "debug");
    expect(mock.api.monitor.setResolution(undefined)).toBe(2.81);
  });

  it("applies a burst of changes as one resize at the last value", async () => {
    const mock = createMockRenderer({ dpr: 2 });

    await mock.start();

    const { renderer } = mock.pixi.last();
    const before = renderer.resizes.length;

    mock.api.monitor.setResolution(1.5);
    mock.api.monitor.setResolution(1.75);
    frame(mock);

    expect(renderer.resizes).toHaveLength(before + 1);
    expect(renderer.resolutions.at(-1)).toBe(1.75);
  });

  it("comes back at the override after a restore of the device", async () => {
    const mock = createMockRenderer({ dpr: 2 });

    await mock.start();
    mock.api.monitor.setResolution(1.25);
    frame(mock);
    mock.pixi.last().lose("unknown");
    await tick();

    expect(mock.pixi.last().initOptions?.resolution).toBe(1.25);
  });

  it("refuses a resolution outside 0.5 to 4", () => {
    const mock = createMockRenderer({ dom: false });
    const message =
      "[game] renderer.monitor.setResolution(5) needs a number from 0.5 to 4.\n" +
      "  Pass undefined to go back to maxResolution.";

    expect(() => mock.api.monitor.setResolution(5)).toThrow(new RangeError(message));
    expect(() => mock.api.monitor.setResolution(0.4)).toThrow(RangeError);
    expect(() => mock.api.monitor.setResolution(Number.NaN)).toThrow(RangeError);
    expect(mock.api.monitor.setResolution(0.5)).toBe(0.5);
  });
});

describe("the config checks", () => {
  const base = createMockRenderer({ dom: false }).ctx.config;
  const stateOf = (overrides: Partial<Config>) => () =>
    createRendererState({ config: { ...base, ...overrides } });

  it("refuse a resolution cap that is not a number above 0", () => {
    expect(stateOf({ maxResolution: 0 })).toThrow(
      "[game] renderer.maxResolution is 0.\n  Give a number above 0."
    );
    expect(stateOf({ maxResolution: Number.NaN })).toThrow("[game] renderer.maxResolution is NaN.");
  });

  it("refuse a budget that is neither rate nor a number above 0, naming rate", () => {
    const hint =
      '  Give the frame budget in milliseconds, or "rate" for one frame of the current rate.';

    expect(stateOf({ monitor: { budgetMs: 0, frames: 1024 } })).toThrow(
      `[game] renderer.monitor.budgetMs is 0.\n${hint}`
    );
    expect(stateOf({ monitor: { budgetMs: "fast" as unknown as "rate", frames: 1024 } })).toThrow(
      `[game] renderer.monitor.budgetMs is fast.\n${hint}`
    );
    expect(stateOf({ monitor: { budgetMs: "rate", frames: 1024 } })).not.toThrow();
    expect(stateOf({ monitor: { budgetMs: 8.3, frames: 2048 } })).not.toThrow();
  });

  it("refuse a ring that is not a whole number from 64 to 16384", () => {
    for (const frames of [63, 16_385, 100.5]) {
      expect(stateOf({ monitor: { budgetMs: "rate", frames } })).toThrow(
        `[game] renderer.monitor.frames is ${frames}.\n  Give a whole number from 64 to 16384.`
      );
    }
  });
});
