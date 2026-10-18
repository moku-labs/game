import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RateChange } from "../../../time/types";
import type { Entity } from "../../../world/types";
import { Shape, Transform } from "../../components";
import { rendererPlugin } from "../../index";
import type { PixiContainer } from "../../types";
import { type Drawn, startDrawn } from "../demand-harness";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit: the render scale of the adaptive frame rate in the renderer (change
// 2026-10-18-memory-render B2): `time:rate` carries the scale the rule chose, the
// canvas draws at that share of its resolution from the next frame, a player's
// resolution wins, the default is on for phones only, and a kept picture is
// retaken once per change.
// ---------------------------------------------------------------------------

/** The `adaptiveScale` the plugin declares as its default. */
const ENGINE_DEFAULT = rendererPlugin.spec.config?.adaptiveScale ?? false;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A switch of the adaptive rule that leaves the rate at 120 and sets the scale.
 *
 * @param scale - The scale after it.
 * @returns The payload of `time:rate`.
 */
function scaledTo(scale: number): RateChange {
  return {
    from: 120,
    to: 120,
    reason: scale < 1 ? "missed" : "headroom",
    mode: "auto",
    displayHz: 120,
    thermal: "none",
    window: { drawn: 40, missed: 9, heavy: 0 },
    dwellMs: 5000,
    scale
  };
}

/**
 * One frame of the mock: the render phase applies what is pending.
 *
 * @param mock - The mock renderer.
 */
function frame(mock: MockRenderer): void {
  mock.runPhase("input");
  mock.runPhase("render");
}

/**
 * Stubs `matchMedia` for a device whose pointer is coarse or not.
 *
 * @param coarse - True for a touch screen.
 */
function stubPointer(coarse: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }));
}

describe("the scale of the adaptive frame rate", () => {
  it("draws at that share of the device resolution from the next frame, with reason rate", async () => {
    const mock = createMockRenderer({ dpr: 2.81 });
    const heard = vi.fn();

    await mock.start();
    mock.modules.host.onResolution(heard);
    mock.hooks["time:rate"](scaledTo(0.85));

    expect(mock.api.host.resolution()).toBe(2);

    frame(mock);

    expect(mock.api.host.resolution()).toBe(1.7);
    expect(heard).toHaveBeenLastCalledWith(2, 1.7, "rate");

    mock.hooks["time:rate"](scaledTo(1));
    frame(mock);

    expect(mock.api.host.resolution()).toBe(2);
  });

  it("a player's resolution wins: the rule gets no scale while it holds, and the floor back after", async () => {
    const mock = createMockRenderer({
      dpr: 2,
      config: { adaptiveScale: { floor: 0.75, devices: "all" } }
    });
    const allow = vi.spyOn(mock.time, "allowScale");

    await mock.start();

    expect(allow).toHaveBeenLastCalledWith(0.75);

    mock.hooks["time:rate"](scaledTo(0.75));
    frame(mock);
    expect(mock.api.host.resolution()).toBe(1.5);

    mock.api.monitor.setResolution(1.75);
    expect(allow).toHaveBeenLastCalledWith(1);
    frame(mock);
    expect(mock.api.host.resolution()).toBe(1.75);

    // The rule withdrew its scale: back on the policy, the canvas draws at the whole device resolution.
    mock.api.monitor.setResolution(undefined);
    expect(allow).toHaveBeenLastCalledWith(0.75);
    frame(mock);
    expect(mock.api.host.resolution()).toBe(2);
  });

  it.each([
    { device: "a phone", coarse: true, width: 390, floor: 0.75 },
    { device: "a laptop with a mouse", coarse: false, width: 390, floor: 1 },
    { device: "a tablet", coarse: true, width: 1024, floor: 1 }
  ])("the default allows the rule a scale down to $floor on $device", async ({
    coarse,
    width,
    floor
  }) => {
    stubPointer(coarse);
    const mock = createMockRenderer({
      width,
      height: 1366,
      config: { adaptiveScale: ENGINE_DEFAULT }
    });
    const allow = vi.spyOn(mock.time, "allowScale");

    await mock.start();

    expect(allow).toHaveBeenCalledWith(floor);
  });

  it("adaptiveScale false allows none, on a phone too", async () => {
    stubPointer(true);
    const mock = createMockRenderer({ width: 390, height: 844, config: { adaptiveScale: false } });
    const allow = vi.spyOn(mock.time, "allowScale");

    await mock.start();

    expect(allow).toHaveBeenCalledWith(1);
  });
});

/**
 * The renders of an entity's stage-1 picture since a point of the log.
 *
 * @param drawn - The running renderer.
 * @param top - The top of its view.
 * @param from - The log length to count from.
 * @returns The count.
 */
function takes(drawn: Drawn, top: PixiContainer, from: number): number {
  const label = `kept:${top.label}#1`;

  return drawn.stage
    .targets()
    .slice(from)
    .filter(call => call.target?.source.label === label).length;
}

/**
 * Tells whether a view is drawn from its picture: its top hidden.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns True while it is kept.
 */
function keptNow(drawn: Drawn, entity: Entity): boolean {
  const view = drawn.mock.ctx.state.sync.views.get(entity);

  return view !== undefined && !(view.wrapper ?? view.object).renderable;
}

describe("a kept picture at a new scale", () => {
  // Bug: a scale that flaps retakes every kept picture each time, three in a row send them live for good.
  it("is retaken once per change and stays kept", async () => {
    const drawn = await startDrawn({ onDemand: false });
    const filter = new pixi.AlphaFilter();

    // `effects` hands its filters "inherit": they draw at the canvas resolution, so a new one is a new picture.
    filter.resolution = "inherit";

    const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.mock.api.sync.filters.set(entity, [{ filter, passes: 1, cache: "local" }]);
    drawn.frames(4);

    const view = drawn.mock.ctx.state.sync.views.get(entity);
    const top = view?.wrapper ?? view?.object;

    if (top === undefined) throw new Error("no view");

    expect(keptNow(drawn, entity)).toBe(true);

    const from = drawn.stage.targets().length;

    drawn.mock.hooks["time:rate"](scaledTo(0.85));
    drawn.frames(10);

    expect(takes(drawn, top, from)).toBe(1);
    expect(keptNow(drawn, entity)).toBe(true);

    drawn.mock.hooks["time:rate"](scaledTo(1));
    drawn.frames(10);

    expect(takes(drawn, top, from)).toBe(2);
    expect(keptNow(drawn, entity)).toBe(true);
    drawn.oracle.expectPicturesCurrent();
    drawn.mock.stop();
  });
});
