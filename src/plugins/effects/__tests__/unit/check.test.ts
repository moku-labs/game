import { afterEach, describe, expect, it, vi } from "vitest";
import { checkShader } from "../../filters/check";
import { defineFilter } from "../../filters/define";
import type { FilterKind } from "../../filters/types";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the dev shader check on the running backend. WebGPU: pending
// until the compilation info resolves, one log per error with line and column.
// WebGL: compiled at once, one log per error line of the info log. Broken or
// ok; no device or context, nothing drawing and production builds answer ok
// without asking
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const Tint = defineFilter("fx.tint", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return vec4<f32>(fu.amount); }",
  glsl: "void main() { finalColor = vec4(amount); }",
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

/**
 * A started mock in a dev build on the WebGL fallback: `host.gl()` answers the fake context.
 *
 * @returns The mock.
 */
function devGlMock(): MockEffects {
  const mock = devMock();

  mock.renderer.kind = "webgl";
  mock.renderer.device = undefined;
  mock.renderer.gl = mock.gl.context;

  return mock;
}

describe("checkShader on WebGPU", () => {
  it("is pending until the compilation info resolves, then ok", async () => {
    const mock = devMock();

    expect(checkShader(mock.ectx, kind)).toBe("pending");
    expect(checkShader(mock.ectx, kind)).toBe("pending");
    expect(mock.gpu.compiled).toEqual([Tint.filter.source]);

    await settle();

    expect(checkShader(mock.ectx, kind)).toBe("ok");
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

    checkShader(mock.ectx, kind);
    await settle();

    expect(mock.log.error).toHaveBeenCalledTimes(2);
    expect(mock.log.error).toHaveBeenCalledWith("effects:wgsl", {
      filter: "fx.tint",
      line: 40,
      column: 7,
      message: "struct member uMissing not found"
    });
    expect(mock.state.broken.has("fx.tint")).toBe(true);
    expect(checkShader(mock.ectx, kind)).toBe("broken");
  });

  it("answers ok when the device is gone, and never asks again", async () => {
    const mock = devMock();

    mock.renderer.device = undefined;

    expect(checkShader(mock.ectx, kind)).toBe("ok");

    mock.renderer.device = mock.gpu.device;
    expect(checkShader(mock.ectx, kind)).toBe("ok");
    await settle();
    expect(mock.gpu.compiled).toEqual([]);
  });

  it("answers ok when the compilation info cannot be read", async () => {
    const mock = devMock();
    const device = {
      createShaderModule: () => ({ getCompilationInfo: () => Promise.reject(new Error("lost")) })
    };

    mock.renderer.device = device as unknown as GPUDevice;
    expect(checkShader(mock.ectx, kind)).toBe("pending");
    await settle();

    expect(checkShader(mock.ectx, kind)).toBe("ok");
    expect(mock.state.broken.has("fx.tint")).toBe(false);
  });

  it("answers ok at once in a production build, with no device call", () => {
    const mock = createMockEffects();

    mock.start();

    expect(checkShader(mock.ectx, kind)).toBe("ok");
    expect(mock.gpu.compiled).toEqual([]);
  });

  it("answers ok for a Pixi-core kind without compiling", () => {
    const mock = devMock();
    const blur = mock.state.kinds.get("effects.blur");

    expect(blur === undefined ? "missing" : checkShader(mock.ectx, blur)).toBe("ok");
    expect(mock.gpu.compiled).toEqual([]);
  });
});

describe("checkShader on WebGL", () => {
  it("compiles the GLSL at once, answers ok and deletes the shader", () => {
    const mock = devGlMock();

    expect(checkShader(mock.ectx, kind)).toBe("ok");
    expect(mock.gl.created).toEqual([mock.gl.context.FRAGMENT_SHADER]);
    expect(mock.gl.compiled).toEqual([Tint.filter.glsl]);
    expect(mock.gl.deleted).toBe(1);

    expect(checkShader(mock.ectx, kind)).toBe("ok");
    expect(mock.gl.compiled).toHaveLength(1);
    expect(mock.gpu.compiled).toEqual([]);
    expect(mock.log.error).not.toHaveBeenCalled();
  });

  it("logs every error line of the info log with its line and breaks the kind", () => {
    const mock = devGlMock();

    mock.gl.status = false;
    // Chrome's form: one line per error, then a NUL.
    mock.gl.log =
      "ERROR: 0:18: 'amount2' : undeclared identifier\n" +
      "ERROR: 0:19: '=' : syntax error\n" +
      "ERROR: 2 compilation errors.  No code generated.\n\u0000";

    expect(checkShader(mock.ectx, kind)).toBe("broken");
    expect(mock.log.error).toHaveBeenCalledTimes(2);
    expect(mock.log.error).toHaveBeenNthCalledWith(1, "effects:glsl", {
      filter: "fx.tint",
      line: 18,
      message: "'amount2' : undeclared identifier"
    });
    expect(mock.log.error).toHaveBeenNthCalledWith(2, "effects:glsl", {
      filter: "fx.tint",
      line: 19,
      message: "'=' : syntax error"
    });
    expect(mock.state.broken.has("fx.tint")).toBe(true);
    expect(mock.gl.deleted).toBe(1);

    expect(checkShader(mock.ectx, kind)).toBe("broken");
    expect(mock.gl.compiled).toHaveLength(1);
  });

  it("logs a failed compile whose log has no error line as one error at line 0", () => {
    const mock = devGlMock();

    mock.gl.status = false;
    mock.gl.log = "  internal compiler failure \n\u0000";

    expect(checkShader(mock.ectx, kind)).toBe("broken");
    expect(mock.log.error).toHaveBeenCalledExactlyOnceWith("effects:glsl", {
      filter: "fx.tint",
      line: 0,
      message: "internal compiler failure"
    });
  });

  it("logs a failed compile with an empty log as one error that says so", () => {
    const mock = devGlMock();

    mock.gl.status = false;

    expect(checkShader(mock.ectx, kind)).toBe("broken");
    expect(mock.log.error).toHaveBeenCalledExactlyOnceWith("effects:glsl", {
      filter: "fx.tint",
      line: 0,
      message: "The GLSL did not compile and the driver said nothing."
    });
  });

  it("answers ok when the context is gone or makes no shader, and never asks again", () => {
    const gone = devGlMock();

    gone.renderer.gl = undefined;
    expect(checkShader(gone.ectx, kind)).toBe("ok");

    gone.renderer.gl = gone.gl.context;
    expect(checkShader(gone.ectx, kind)).toBe("ok");
    expect(gone.gl.created).toEqual([]);

    const lost = devGlMock();

    lost.gl.makesShaders = false;
    expect(checkShader(lost.ectx, kind)).toBe("ok");
    expect(lost.gl.compiled).toEqual([]);
    expect(lost.gl.deleted).toBe(0);
  });

  it("answers ok at once in a production build, with no compile", () => {
    const mock = createMockEffects();

    mock.start();
    mock.renderer.kind = "webgl";
    mock.renderer.gl = mock.gl.context;

    expect(checkShader(mock.ectx, kind)).toBe("ok");
    expect(mock.gl.created).toEqual([]);
  });

  it("answers ok without compiling while nothing draws", () => {
    const mock = devMock();

    mock.renderer.kind = "none";

    expect(checkShader(mock.ectx, kind)).toBe("ok");
    expect(mock.gpu.compiled).toEqual([]);
    expect(mock.gl.created).toEqual([]);
  });
});
