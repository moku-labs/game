import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureFilter, NodeInfo } from "../../../flow/types";
import { Glow, Outline } from "../../filters/builtins";
import { gateChecks, kindStatus, pollChecks, startChecks } from "../../filters/check";
import { defineFilter } from "../../filters/define";
import type { FilterKind } from "../../filters/types";
import {
  Along,
  BAD_LOG,
  Bad,
  Hazy,
  Small,
  Smaller,
  Soft,
  SoftDim,
  Veiled
} from "../filter-fixtures";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the shader check, in every build. Every definition a registered
// kind can draw (its body, its stages, its fallback) is compiled once on the
// running backend when the renderer first draws: WebGPU answers when the
// compilation info resolves, WebGL at once or, with the parallel extension, on
// a later frame. A kind is pending until all of its own answered and broken
// when one failed. The load stage of a node entry waits for the answers.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const Tint = defineFilter("fx.tint", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return vec4<f32>(fu.amount); }",
  glsl: "void main() { finalColor = vec4(amount); }",
  uniforms: { amount: 1 }
});

/** The node the boot enters first. */
const NODE: NodeInfo = {
  path: "home",
  flow: "main",
  node: "home",
  rest: true,
  over: false,
  checkpoint: false,
  barrier: false,
  scene: "home"
};

/** Lets the compilation info resolve. */
async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

/**
 * A started mock on WebGPU with the device the WGSL check compiles on, in a production build.
 *
 * @param filters - The filters of the one feature.
 * @returns The mock.
 */
function gpuMock(filters: readonly FeatureFilter[] = [Tint]): MockEffects {
  const mock = createMockEffects();

  mock.renderer.device = mock.gpu.device;
  mock.features.push({ name: "fx", description: { filters } });
  mock.start();

  return mock;
}

/**
 * A started mock on the WebGL fallback: `host.gl()` answers the fake context.
 *
 * @param filters - The filters of the one feature.
 * @returns The mock.
 */
function glMock(filters: readonly FeatureFilter[] = [Tint]): MockEffects {
  const mock = gpuMock(filters);

  mock.renderer.kind = "webgl";
  mock.renderer.device = undefined;
  mock.renderer.gl = mock.gl.context;

  return mock;
}

/**
 * A registered kind of the mock.
 *
 * @param mock - The started mock.
 * @param id - The kind id.
 * @returns The kind.
 */
function kindOf(mock: MockEffects, id: string): FilterKind {
  const kind = mock.state.kinds.get(id);

  if (kind === undefined) throw new Error(`no kind ${id}`);

  return kind;
}

/**
 * Enters a node through the load stage the plugin registered.
 *
 * @param mock - The started mock.
 * @param signal - The node's abort signal.
 * @returns Whether the gate let the node go on yet, and the promise of the gate.
 */
function enter(
  mock: MockEffects,
  signal = new AbortController().signal
): { passed: () => boolean; done: Promise<void> } {
  const load = mock.enters.find(entry => entry.stage === "load");

  if (load === undefined) throw new Error("no load stage registered");

  let passed = false;
  const done = Promise.resolve(load.callback(NODE, { mode: "live", signal })).then(() => {
    passed = true;
  });

  return { passed: () => passed, done };
}

describe("the check — every definition, every build, at the first drawn frame", () => {
  it("checks every kind, every stage and every fallback once, before any filtered view exists, in a production build", () => {
    const mock = gpuMock([Soft, Hazy]);

    expect(mock.gpu.compiled).toEqual([]);

    mock.frame();

    expect(mock.gpu.compiled).toEqual(
      [Glow, Outline, Soft, Small, Smaller, Along, Hazy, Bad, SoftDim].map(
        definition => definition.filter.source
      )
    );
    expect(mock.state.views.size).toBe(0);
  });

  it("compiles a stage shared by two kinds once, and two definitions with one id both", () => {
    const TwinA = defineFilter("fixture.twin", {
      wgsl: Small.filter.source,
      glsl: "void main() {}"
    });
    const TwinB = defineFilter("fixture.twin", {
      wgsl: `${Small.filter.source}\n`,
      glsl: "void main() {}"
    });
    const First = defineFilter("fixture.first", {
      wgsl: Small.filter.source,
      glsl: "void main() {}",
      inputs: { a: { stages: [TwinA], chain: () => [] } }
    });
    const Second = defineFilter("fixture.second", {
      wgsl: `${Small.filter.source}\n\n`,
      glsl: "void main() {}",
      inputs: { a: { stages: [TwinB], chain: () => [] } }
    });
    const mock = gpuMock([Soft, Veiled, First, Second]);

    mock.frame();

    const along = mock.gpu.compiled.filter(code => code === Along.filter.source);
    const twins = mock.gpu.compiled.filter(
      code => code === TwinA.filter.source || code === TwinB.filter.source
    );

    expect(along).toHaveLength(1);
    expect(twins).toEqual([TwinA.filter.source, TwinB.filter.source]);
  });

  it("keeps a kind pending until its body and every stage answered, and gives it no instance", async () => {
    const held = Promise.withResolvers<void>();
    const mock = gpuMock([Soft]);

    mock.gpu.waits.set(Along.filter.source, held.promise);
    mock.frame();
    await settle();

    expect(mock.state.checks.status.get(Soft.filter)).toBe("ok");
    expect(kindStatus(mock.ectx, kindOf(mock, "fixture.soft"))).toBe("pending");

    held.resolve();
    await settle();

    expect(kindStatus(mock.ectx, kindOf(mock, "fixture.soft"))).toBe("ok");
    expect(mock.state.ready.has("fixture.soft")).toBe(true);
  });

  it("answers every definition ok without compiling on a backend that draws nothing", () => {
    const mock = gpuMock();

    mock.renderer.kind = "none";
    mock.frame();

    expect(kindStatus(mock.ectx, kindOf(mock, "fx.tint"))).toBe("ok");
    expect(mock.gpu.compiled).toEqual([]);
    expect(mock.gl.created).toEqual([]);
  });

  it("is pending before the checks started, and answers ok for a Pixi-core kind at once", () => {
    const mock = gpuMock();

    expect(kindStatus(mock.ectx, kindOf(mock, "fx.tint"))).toBe("pending");
    expect(kindStatus(mock.ectx, kindOf(mock, "effects.blur"))).toBe("ok");
    expect(mock.gpu.compiled).toEqual([]);
  });

  it("logs effects:checks once, when the last definition answered", async () => {
    const mock = gpuMock([Soft, Hazy]);

    mock.gpu.answer = code =>
      code === Bad.filter.source
        ? [{ type: "error", lineNum: 12, linePos: 3, message: "unresolved 'missing'" }]
        : [];
    mock.frame();

    expect(mock.log.info).not.toHaveBeenCalledWith("effects:checks", expect.anything());

    await settle();
    mock.frame();

    expect(mock.log.info).toHaveBeenCalledExactlyOnceWith("effects:checks", {
      definitions: 9,
      broken: 1,
      ms: expect.any(Number)
    });
  });

  it("ignores an answer from before a stop", async () => {
    const held = Promise.withResolvers<void>();
    const mock = gpuMock();

    mock.gpu.messages.push({ type: "error", lineNum: 1, linePos: 1, message: "bad" });
    mock.gpu.waits.set(Tint.filter.source, held.promise);
    mock.frame();
    mock.stop();
    held.resolve();
    await settle();

    expect(mock.log.error).not.toHaveBeenCalled();
    expect(mock.state.checks.status.get(Tint.filter)).toBeUndefined();
    expect(mock.state.checks.started).toBe(false);
  });
});

describe("the check on WebGPU", () => {
  it("logs every error with its line and column under the definition's id and breaks the kind", async () => {
    const mock = gpuMock();

    mock.gpu.answer = code =>
      code === Tint.filter.source
        ? [
            { type: "error", lineNum: 40, linePos: 7, message: "struct member uMissing not found" },
            { type: "warning", lineNum: 2, linePos: 1, message: "unused variable" },
            { type: "error", lineNum: 41, linePos: 3, message: "expected ';'" }
          ]
        : [];
    mock.frame();
    await settle();

    expect(mock.log.error).toHaveBeenCalledWith("effects:wgsl", {
      filter: "fx.tint",
      line: 40,
      column: 7,
      message: "struct member uMissing not found"
    });
    expect(kindStatus(mock.ectx, kindOf(mock, "fx.tint"))).toBe("broken");
    expect(mock.log.error).toHaveBeenCalledWith("effects:broken", {
      filter: "fx.tint",
      reason: "compile",
      message:
        "The shader does not compile on this device: read the effects:wgsl or effects:glsl lines."
    });
    expect(mock.log.error).toHaveBeenCalledTimes(3);
    expect(kindStatus(mock.ectx, kindOf(mock, "effects.glow"))).toBe("ok");
  });

  it("answers ok when the device is gone, and when the compilation info cannot be read", async () => {
    const gone = gpuMock();

    gone.renderer.device = undefined;
    gone.frame();

    expect(kindStatus(gone.ectx, kindOf(gone, "fx.tint"))).toBe("ok");

    const unreadable = gpuMock();
    const device = {
      createShaderModule: () => ({ getCompilationInfo: () => Promise.reject(new Error("lost")) })
    };

    unreadable.renderer.device = device as unknown as GPUDevice;
    unreadable.frame();

    expect(kindStatus(unreadable.ectx, kindOf(unreadable, "fx.tint"))).toBe("pending");

    await settle();

    expect(kindStatus(unreadable.ectx, kindOf(unreadable, "fx.tint"))).toBe("ok");
    expect(unreadable.state.broken.size).toBe(0);
  });
});

describe("the check on WebGL", () => {
  it("compiles the GLSL at once, answers ok and deletes the shader", () => {
    const mock = glMock();

    mock.frame();

    expect(mock.gl.compiled).toEqual([Glow.filter.glsl, Outline.filter.glsl, Tint.filter.glsl]);
    expect(mock.gl.deleted).toBe(3);
    expect(kindStatus(mock.ectx, kindOf(mock, "fx.tint"))).toBe("ok");
    expect(mock.gpu.compiled).toEqual([]);
    expect(mock.log.error).not.toHaveBeenCalled();
  });

  it("logs every error line of the info log with its line and breaks the kind", () => {
    const mock = glMock();

    mock.gl.fails = source => source === Tint.filter.glsl;
    // Chrome's form: one line per error, then a NUL.
    mock.gl.log =
      "ERROR: 0:18: 'amount2' : undeclared identifier\n" +
      "ERROR: 0:19: '=' : syntax error\n" +
      "ERROR: 2 compilation errors.  No code generated.\n\u0000";
    mock.frame();

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
    expect(mock.log.error).toHaveBeenCalledTimes(2);
    expect(kindStatus(mock.ectx, kindOf(mock, "fx.tint"))).toBe("broken");
    expect(mock.gl.deleted).toBe(3);
  });

  it("logs a failed compile whose log has no error line as one error at line 0, and an empty log as one that says so", () => {
    const odd = glMock();

    odd.gl.fails = source => source === Tint.filter.glsl;
    odd.gl.log = "  internal compiler failure \n\u0000";
    odd.frame();

    expect(odd.log.error).toHaveBeenCalledExactlyOnceWith("effects:glsl", {
      filter: "fx.tint",
      line: 0,
      message: "internal compiler failure"
    });

    const silent = glMock();

    silent.gl.fails = source => source === Tint.filter.glsl;
    silent.frame();

    expect(silent.log.error).toHaveBeenCalledExactlyOnceWith("effects:glsl", {
      filter: "fx.tint",
      line: 0,
      message: "The GLSL did not compile and the driver said nothing."
    });
  });

  it("answers ok when the context is gone or makes no shader", () => {
    const gone = glMock();

    gone.renderer.gl = undefined;
    gone.frame();

    expect(kindStatus(gone.ectx, kindOf(gone, "fx.tint"))).toBe("ok");
    expect(gone.gl.created).toEqual([]);

    const lost = glMock();

    lost.gl.makesShaders = false;
    lost.frame();

    expect(kindStatus(lost.ectx, kindOf(lost, "fx.tint"))).toBe("ok");
    expect(lost.gl.compiled).toEqual([]);
  });

  it("breaks a kind whose stage does not compile and logs it under the stage's id, once", () => {
    const mock = glMock([Soft, Hazy]);

    mock.gl.fails = source => source.includes("missing");
    mock.gl.log = BAD_LOG;
    mock.frame();

    expect(kindStatus(mock.ectx, kindOf(mock, "fixture.hazy"))).toBe("broken");
    expect(kindStatus(mock.ectx, kindOf(mock, "fixture.hazy"))).toBe("broken");
    expect(kindStatus(mock.ectx, kindOf(mock, "fixture.soft"))).toBe("ok");
    expect(vi.mocked(mock.log.error).mock.calls).toEqual([
      [
        "effects:glsl",
        { filter: "fixture.bad", line: 12, message: "'missing' : undeclared identifier" }
      ],
      [
        "effects:broken",
        {
          filter: "fixture.hazy",
          reason: "compile",
          stage: "fixture.bad",
          fallback: "fixture.softDim",
          message:
            'Its stage "fixture.bad" does not compile on this device: read the effects:wgsl or effects:glsl lines.'
        }
      ]
    ]);
  });

  it("logs a fallback that fails its own check under the fallback's id, once", () => {
    const mock = glMock([Veiled, Hazy]);

    mock.gl.fails = source => source === SoftDim.filter.glsl;
    mock.frame();

    expect(mock.log.error).toHaveBeenCalledWith("effects:broken", {
      filter: "fixture.softDim",
      reason: "compile",
      message:
        "The shader does not compile on this device: read the effects:wgsl or effects:glsl lines."
    });
    expect(
      vi.mocked(mock.log.error).mock.calls.filter(call => call[0] === "effects:broken")
    ).toHaveLength(1);
    expect(kindStatus(mock.ectx, kindOf(mock, "fixture.veiled"))).toBe("ok");
  });

  it("compiles in parallel when the driver can, and answers on a later frame", () => {
    const mock = glMock();

    mock.gl.parallel = true;
    mock.frame();

    expect(mock.state.checks.gl).toHaveLength(3);
    expect(kindStatus(mock.ectx, kindOf(mock, "fx.tint"))).toBe("pending");

    mock.frame();

    expect(kindStatus(mock.ectx, kindOf(mock, "fx.tint"))).toBe("pending");

    mock.gl.done = true;
    mock.frame();

    expect(mock.state.checks.gl).toHaveLength(0);
    expect(mock.gl.deleted).toBe(3);
    expect(kindStatus(mock.ectx, kindOf(mock, "fx.tint"))).toBe("ok");
  });

  it("answers a parallel compile ok when the context is lost meanwhile", () => {
    const mock = glMock();

    mock.gl.parallel = true;
    mock.frame();
    // eslint-disable-next-line unicorn/no-null -- a lost context answers null.
    mock.gl.done = null;
    pollChecks(mock.ectx);

    expect(kindStatus(mock.ectx, kindOf(mock, "fx.tint"))).toBe("ok");
    expect(mock.gl.deleted).toBe(3);
  });
});

describe("the gate — the load stage of a node entry", () => {
  it("holds the first node until every registered kind's check answered, then logs how long it waited", async () => {
    const held = Promise.withResolvers<void>();
    const mock = gpuMock([Soft]);

    mock.gpu.waits.set(Soft.filter.source, held.promise);

    const entry = enter(mock);

    await settle();

    // The gate starts the checks itself: no frame has to run first.
    expect(mock.state.checks.started).toBe(true);
    expect(entry.passed()).toBe(false);

    held.resolve();
    await entry.done;

    expect(entry.passed()).toBe(true);
    expect(mock.log.info).toHaveBeenCalledWith("effects:mount-waited", {
      node: "home",
      ms: expect.any(Number)
    });
  });

  it("waits for nothing when the renderer draws nothing", async () => {
    const mock = gpuMock();

    mock.renderer.ready = false;

    await enter(mock).done;

    expect(mock.state.checks.started).toBe(false);
    expect(mock.log.info).not.toHaveBeenCalledWith("effects:mount-waited", expect.anything());
  });

  it("waits for nothing at a node entered after the checks settled", async () => {
    const mock = gpuMock();

    mock.frame();
    await settle();

    const entry = enter(mock);

    await Promise.resolve();
    await Promise.resolve();

    expect(entry.passed()).toBe(true);
    expect(mock.log.info).not.toHaveBeenCalledWith("effects:mount-waited", expect.anything());
  });

  it("lets an aborted node stop waiting", async () => {
    const mock = gpuMock();
    const abort = new AbortController();

    mock.gpu.waits.set(Tint.filter.source, new Promise(() => undefined));

    const entry = enter(mock, abort.signal);

    await settle();

    expect(entry.passed()).toBe(false);

    abort.abort();
    await entry.done;

    expect(entry.passed()).toBe(true);
    expect(mock.log.info).not.toHaveBeenCalledWith("effects:mount-waited", expect.anything());
  });

  it("starts nothing twice when the gate and the first frame both ask", async () => {
    const mock = gpuMock();

    startChecks(mock.ectx);
    await gateChecks(mock.ectx, NODE, { signal: new AbortController().signal });
    mock.frame();

    expect(mock.gpu.compiled.filter(code => code === Tint.filter.source)).toHaveLength(1);
  });
});
