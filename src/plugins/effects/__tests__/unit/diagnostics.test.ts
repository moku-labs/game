import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api as RendererApi } from "../../../renderer/types";
import { defineFilter } from "../../filters/define";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: app.effects.diagnostics — the switches of a debug build over the
// mock kernel: the agent rule, the known kinds, the off list, the log and the
// monitor's `switch` event
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const Frost = defineFilter("casefile.frost", {
  wgsl: `
@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, uv);
}`,
  glsl: `
void main() {
  finalColor = texture(uTexture, vTextureCoord);
}`
});

/**
 * A started mock with the feature filter `casefile.frost`.
 *
 * @returns The started mock.
 */
function started(): MockEffects {
  const mock = createMockEffects();

  mock.features.push({ name: "casefile", description: { filters: [Frost] } });
  mock.start();

  return mock;
}

/**
 * The monitor's `event` spy of the mock renderer.
 *
 * @param mock - The mock.
 * @returns The spy.
 */
function monitorEvent(mock: MockEffects) {
  const renderer = mock.ctx.require({ name: "renderer" } as never) as RendererApi;

  return vi.mocked(renderer.monitor.event);
}

describe("effects.diagnostics", () => {
  it("without the agent flag disable and enable answer false and change nothing", () => {
    const mock = started();
    const { diagnostics } = mock.api;

    expect(diagnostics.disable("effects.glow")).toBe(false);
    expect(diagnostics.enable("effects.glow")).toBe(false);
    expect(diagnostics.disabled()).toEqual([]);
    expect(mock.state.diagnostics.off.size).toBe(0);
    expect(mock.log.info).not.toHaveBeenCalled();
    expect(monitorEvent(mock)).not.toHaveBeenCalled();
  });

  it("disable of a known kind answers true, lists it in disabled(), logs once and writes one switch event to the monitor; a second disable logs nothing", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const mock = started();
    const { diagnostics } = mock.api;

    expect(diagnostics.disable("effects.glow")).toBe(true);
    expect(diagnostics.disabled()).toEqual(["effects.glow"]);
    expect(diagnostics.disable("effects.glow")).toBe(true);
    expect(vi.mocked(mock.log.info).mock.calls).toEqual([
      ["effects:diagnostics", { kind: "effects.glow", on: false }]
    ]);
    expect(monitorEvent(mock).mock.calls).toEqual([
      ["switch", { kind: "effects.glow", on: false }]
    ]);

    expect(diagnostics.enable("effects.glow")).toBe(true);
    expect(diagnostics.disabled()).toEqual([]);
    expect(monitorEvent(mock).mock.calls.at(-1)).toEqual([
      "switch",
      { kind: "effects.glow", on: true }
    ]);
  });

  it("switches under a DEV-only stub too: a game's test that stubs the dev flag", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const mock = started();

    expect(mock.api.diagnostics.disable("casefile.frost")).toBe(true);
    expect(mock.api.diagnostics.disabled()).toEqual(["casefile.frost"]);
  });

  it("an unknown kind answers false and warns once per id", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const mock = started();
    const { diagnostics } = mock.api;

    expect(diagnostics.disable("fx.nope")).toBe(false);
    expect(diagnostics.enable("fx.nope")).toBe(false);
    expect(diagnostics.disable("fx.other")).toBe(false);
    expect(vi.mocked(mock.log.warn).mock.calls).toEqual([
      ["effects:diagnostics-unknown", { kind: "fx.nope" }],
      ["effects:diagnostics-unknown", { kind: "fx.other" }]
    ]);
    expect(diagnostics.disabled()).toEqual([]);
  });

  it("disabled() keeps the order of kinds(), and is the same array until a change", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const mock = started();
    const { diagnostics } = mock.api;

    diagnostics.disable("casefile.frost");
    diagnostics.disable("effects.glow");

    const off = diagnostics.disabled();

    expect(off).toEqual(["effects.glow", "casefile.frost"]);
    expect(Object.isFrozen(off)).toBe(true);
    diagnostics.disable("effects.glow");
    expect(diagnostics.disabled()).toBe(off);
    diagnostics.enable("effects.glow");
    expect(diagnostics.disabled()).not.toBe(off);
    expect(diagnostics.disabled()).toEqual(["casefile.frost"]);
  });

  it("kinds() is empty before start and lists built-ins then feature filters after; a stop empties it and every switch", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const mock = createMockEffects();

    mock.features.push({ name: "casefile", description: { filters: [Frost] } });

    expect(mock.api.diagnostics.kinds()).toEqual([]);

    mock.start();

    const kinds = mock.api.diagnostics.kinds();

    expect(kinds).toEqual([
      "effects.glow",
      "effects.outline",
      "effects.blur",
      "effects.colorMatrix",
      "effects.noise",
      "effects.displacement",
      "effects.alpha",
      "casefile.frost"
    ]);
    expect(mock.api.diagnostics.kinds()).toBe(kinds);

    mock.api.diagnostics.disable("effects.glow");
    mock.stop();

    expect([mock.api.diagnostics.kinds(), mock.api.diagnostics.disabled()]).toEqual([[], []]);
    expect(mock.state.diagnostics.off.size).toBe(0);
  });
});
