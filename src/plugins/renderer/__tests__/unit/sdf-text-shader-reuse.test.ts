import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdfTextStage } from "../sdf-text-stage";

// ---------------------------------------------------------------------------
// Unit: a distance-field text laid out again keeps its shader (A26 heap profile, 2026-10-18). Pixi's bitmap pipe asks
// `getSdfShader()` at every layout of a text and keeps the answer only for a context without a shader; a pipe that made
// a new shader each time left one shader, its bind groups and its resource accessors as garbage per text update, and on
// WebGL each one listened to the shared batch-sampler group for good.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the SDF shader of a text laid out again", () => {
  it("is the text's own: 50 updates make no shader", () => {
    const stage = sdfTextStage();
    const shader = stage.shader();

    for (let index = 0; index < 50; index += 1) stage.update(String(index % 10));

    expect(shader).toBeInstanceOf(pixi.Shader);
    expect(stage.shader()).toBe(shader);
    expect(stage.made()).toBe(1);
  });

  it("adds no listener to the shared batch samplers on WebGL", () => {
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => undefined }) });

    const stage = sdfTextStage("webgl");
    const samplers = pixi.getBatchSamplersUniformGroup(16);
    const listening = samplers.listenerCount("change");

    for (let index = 0; index < 50; index += 1) stage.update(String(index % 10));

    expect(samplers.listenerCount("change")).toBe(listening);
    expect(stage.made()).toBe(1);
  });
});
