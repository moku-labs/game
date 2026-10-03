import { afterEach, describe, expect, it, vi } from "vitest";
import { checkWgsl } from "../../filters/check";
import { defineFilter } from "../../filters/define";
import type { FilterKind } from "../../filters/types";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the dev WGSL check — pending until the compilation info
// resolves, one log per error with line and column, broken or ok; no device
// and production builds answer ok without asking
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const Tint = defineFilter("fx.tint", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return vec4<f32>(fu.amount); }",
  uniforms: { amount: 1 }
});

const kind: FilterKind = {
  id: "fx.tint",
  component: Tint,
  source: "wgsl",
  definition: Tint.filter,
  index: 7
};

/** Lets the compilation info resolve. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

/**
 * A started mock in a dev build.
 *
 * @returns The mock.
 */
function devMock(): MockEffects {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  const mock = createMockEffects();

  mock.start();

  return mock;
}

describe("checkWgsl", () => {
  it("is pending until the compilation info resolves, then ok", async () => {
    const mock = devMock();

    expect(checkWgsl(mock.ectx, kind)).toBe("pending");
    expect(checkWgsl(mock.ectx, kind)).toBe("pending");
    expect(mock.gpu.compiled).toEqual([Tint.filter.source]);

    await settle();

    expect(checkWgsl(mock.ectx, kind)).toBe("ok");
    expect(mock.gpu.compiled).toHaveLength(1);
    expect(mock.log.error).not.toHaveBeenCalled();
  });

  it("logs every error with its line and column and breaks the kind", async () => {
    const mock = devMock();

    mock.gpu.messages.push(
      { type: "error", lineNum: 40, linePos: 7, message: "struct member uMissing not found" },
      { type: "warning", lineNum: 2, linePos: 1, message: "unused variable" },
      { type: "error", lineNum: 41, linePos: 3, message: "expected ';'" }
    );

    checkWgsl(mock.ectx, kind);
    await settle();

    expect(mock.log.error).toHaveBeenCalledTimes(2);
    expect(mock.log.error).toHaveBeenCalledWith("effects:wgsl", {
      filter: "fx.tint",
      line: 40,
      column: 7,
      message: "struct member uMissing not found"
    });
    expect(mock.state.broken.has("fx.tint")).toBe(true);
    expect(checkWgsl(mock.ectx, kind)).toBe("broken");
  });

  it("answers ok when the device is gone, and never asks again", async () => {
    const mock = devMock();

    mock.renderer.device = undefined;

    expect(checkWgsl(mock.ectx, kind)).toBe("ok");

    mock.renderer.device = mock.gpu.device;
    expect(checkWgsl(mock.ectx, kind)).toBe("ok");
    await settle();
    expect(mock.gpu.compiled).toEqual([]);
  });

  it("answers ok when the compilation info cannot be read", async () => {
    const mock = devMock();
    const device = {
      createShaderModule: () => ({ getCompilationInfo: () => Promise.reject(new Error("lost")) })
    };

    mock.renderer.device = device as unknown as GPUDevice;
    expect(checkWgsl(mock.ectx, kind)).toBe("pending");
    await settle();

    expect(checkWgsl(mock.ectx, kind)).toBe("ok");
    expect(mock.state.broken.has("fx.tint")).toBe(false);
  });

  it("answers ok at once in a production build, with no device call", () => {
    const mock = createMockEffects();

    mock.start();

    expect(checkWgsl(mock.ectx, kind)).toBe("ok");
    expect(mock.gpu.compiled).toEqual([]);
  });

  it("answers ok for a Pixi-core kind without compiling", () => {
    const mock = devMock();
    const blur = mock.state.kinds.get("effects.blur");

    expect(blur === undefined ? "missing" : checkWgsl(mock.ectx, blur)).toBe("ok");
    expect(mock.gpu.compiled).toEqual([]);
  });
});
