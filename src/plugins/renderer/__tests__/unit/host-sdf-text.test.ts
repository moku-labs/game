import { afterEach, describe, expect, it, vi } from "vitest";
import { createSdfTextPipe, installSdfTextPipe } from "../../host/sdf-text";
import type { PixiModule } from "../../types";
import {
  createFakePixi,
  FakeBitmapTextPipe,
  FakeGlProgram,
  FakeGpuProgram,
  FakeMatrix,
  FakeSdfShader,
  FakeShader,
  FakeUniformGroup,
  fakeBatchSamplers,
  fakeColorBit,
  fakeColorBitGl,
  fakeExtensions,
  fakeLocalUniformMSDFBit,
  fakeLocalUniformMSDFBitGl,
  fakeMSDFBit,
  fakeMSDFBitGl,
  fakeRoundPixelsBit,
  fakeRoundPixelsBitGl,
  fakeShaderCompiler,
  fakeTextureBatchBit,
  fakeTextureBatchBitGl,
  WEBGL_PIPES,
  WEBGPU_PIPES
} from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test: the renderer's own bitmap text pipe. A subclass of Pixi's pipe,
// swapped in through the extension registry before init, whose SDF shader
// hands `calculateMSDFAlpha` the colour un-premultiplied, so every alpha is
// applied once: WGSL on WebGPU, GLSL on the WebGL fallback.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The fragment step Pixi 8.21 ships, which hands the premultiplied colour over. */
const pixiStep = "calculateMSDFAlpha(outColor, vColor, localUniforms.uDistance)";

/** The fragment step of the renderer: the colour un-premultiplied, at alpha 1. */
const singleAlphaStep =
  "calculateMSDFAlpha(outColor, vec4<f32>(vColor.rgb / max(vColor.a, 1e-4), 1.0), localUniforms.uDistance)";

/** The GLSL fragment step Pixi 8.21 ships, the same double alpha on WebGL. */
const pixiStepGl = "calculateMSDFAlpha(outColor, vColor, uDistance)";

/** The GLSL fragment step of the renderer: the colour un-premultiplied, at alpha 1. */
const singleAlphaStepGl =
  "calculateMSDFAlpha(outColor, vec4(vColor.rgb / max(vColor.a, 1e-4), 1.0), uDistance)";

/** What the fake pipe reads of its renderer. */
type PipeRenderer = { name: "webgpu" | "webgl"; limits: { maxBatchableTextures: number } };

/**
 * Builds the pipe on a fake renderer of one backend.
 *
 * @param pixi - The fake module.
 * @param name - The backend.
 * @returns The pipe.
 */
function pipeOn(pixi: PixiModule, name: "webgpu" | "webgl"): object {
  const Pipe = createSdfTextPipe(pixi);
  const renderer: PipeRenderer = { name, limits: { maxBatchableTextures: 16 } };

  return new Pipe(renderer as unknown as ConstructorParameters<typeof Pipe>[0]);
}

/**
 * Asks a pipe for the shader of one distance-field text, as Pixi does per text.
 *
 * @param pipe - The pipe.
 * @returns The shader.
 */
function shaderOf(pipe: object): FakeShader {
  return (pipe as { getSdfShader(): FakeShader }).getSdfShader();
}

/**
 * Yields the microtask queue, so a restore inside the renderer can finish.
 */
async function tick(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("createSdfTextPipe", () => {
  it("subclasses Pixi's bitmap text pipe and keeps its extension metadata object", () => {
    const pixi = createFakePixi();
    const Pipe = createSdfTextPipe(pixi.module);

    expect(Object.getPrototypeOf(Pipe)).toBe(FakeBitmapTextPipe);
    expect((Pipe as unknown as typeof FakeBitmapTextPipe).extension).toBe(
      FakeBitmapTextPipe.extension
    );
  });

  it("compiles Pixi's SDF bits with the alpha handed over once on WebGPU", () => {
    const pixi = createFakePixi();
    const shader = shaderOf(pipeOn(pixi.module, "webgpu"));
    const [compile] = fakeShaderCompiler.compiled;
    const textBit = compile?.bits[2];

    expect(shader).toBeInstanceOf(FakeShader);
    expect(shader).not.toBeInstanceOf(FakeSdfShader);
    expect(shader.gpuProgram).toBeInstanceOf(FakeGpuProgram);
    expect(compile?.bits).toEqual([
      fakeColorBit,
      fakeTextureBatchBit(16),
      textBit,
      fakeMSDFBit,
      fakeRoundPixelsBit
    ]);
    expect(textBit?.fragment?.main).toContain(singleAlphaStep);
    expect(textBit?.fragment?.main).not.toContain(pixiStep);
    // Everything but the fragment step is Pixi's own.
    expect(textBit?.vertex).toBe(fakeLocalUniformMSDFBit.vertex);
    expect(textBit?.fragment?.header).toBe(fakeLocalUniformMSDFBit.fragment.header);
    expect(textBit?.name).not.toBe(fakeLocalUniformMSDFBit.name);
  });

  it("gives every shader its own local uniforms at Pixi's starting values", () => {
    const pixi = createFakePixi();
    const pipe = pipeOn(pixi.module, "webgpu");
    const first = shaderOf(pipe).resources.localUniforms;
    const second = shaderOf(pipe).resources.localUniforms;

    expect(first).toBeInstanceOf(FakeUniformGroup);
    expect(first).not.toBe(second);
    expect((first as FakeUniformGroup).uniforms).toEqual({
      uColor: new Float32Array([1, 1, 1, 1]),
      uTransformMatrix: new FakeMatrix(),
      uDistance: 4,
      uRound: 0
    });
  });

  it("compiles the program once per texture count and shares it between shaders", () => {
    const pixi = createFakePixi();
    const pipe = pipeOn(pixi.module, "webgpu");
    const first = shaderOf(pipe);
    const second = shaderOf(pipe);

    expect(first).not.toBe(second);
    expect(second.gpuProgram).toBe(first.gpuProgram);
    expect(fakeShaderCompiler.compiled).toHaveLength(1);
  });

  it("compiles Pixi's GLSL SDF bits with the alpha handed over once on WebGL", () => {
    const pixi = createFakePixi();
    const shader = shaderOf(pipeOn(pixi.module, "webgl"));
    const [compile] = fakeShaderCompiler.compiledGl;
    const textBit = compile?.bits[2];

    expect(shader).toBeInstanceOf(FakeShader);
    expect(shader).not.toBeInstanceOf(FakeSdfShader);
    expect(shader.glProgram).toBeInstanceOf(FakeGlProgram);
    expect(shader.gpuProgram).toBeUndefined();
    expect(fakeShaderCompiler.compiled).toHaveLength(0);
    expect(compile?.bits).toEqual([
      fakeColorBitGl,
      fakeTextureBatchBitGl(16),
      textBit,
      fakeMSDFBitGl,
      fakeRoundPixelsBitGl
    ]);
    expect(textBit?.fragment?.main).toContain(singleAlphaStepGl);
    expect(textBit?.fragment?.main).not.toContain(pixiStepGl);
    // Everything but the fragment step is Pixi's own.
    expect(textBit?.vertex).toBe(fakeLocalUniformMSDFBitGl.vertex);
    expect(textBit?.fragment?.header).toBe(fakeLocalUniformMSDFBitGl.fragment.header);
    expect(textBit?.name).not.toBe(fakeLocalUniformMSDFBitGl.name);
  });

  it("gives a WebGL shader its own local uniforms and Pixi's batch samplers", () => {
    const pixi = createFakePixi();
    const pipe = pipeOn(pixi.module, "webgl");
    const first = shaderOf(pipe);
    const second = shaderOf(pipe);

    expect(first.resources.localUniforms).toBeInstanceOf(FakeUniformGroup);
    expect(first.resources.localUniforms).not.toBe(second.resources.localUniforms);
    expect((first.resources.localUniforms as FakeUniformGroup).uniforms).toEqual({
      uColor: new Float32Array([1, 1, 1, 1]),
      uTransformMatrix: new FakeMatrix(),
      uDistance: 4,
      uRound: 0
    });
    expect(first.resources.batchSamplers).toBe(fakeBatchSamplers(16));
    expect(second.glProgram).toBe(first.glProgram);
    expect(fakeShaderCompiler.compiledGl).toHaveLength(1);
  });

  it("keeps a WebGPU shader free of the WebGL program and samplers", () => {
    const pixi = createFakePixi();
    const shader = shaderOf(pipeOn(pixi.module, "webgpu"));

    expect(shader.glProgram).toBeUndefined();
    expect(shader.resources.batchSamplers).toBeUndefined();
    expect(fakeShaderCompiler.compiledGl).toHaveLength(0);
  });
});

describe("installSdfTextPipe", () => {
  it("swaps Pixi's pipe for the subclass under the same name on both backends, and back", () => {
    const pixi = createFakePixi();
    const off = installSdfTextPipe(pixi.module);
    const gpu = fakeExtensions.named(WEBGPU_PIPES, "bitmapText");

    expect(gpu).not.toBe(FakeBitmapTextPipe);
    expect(Object.getPrototypeOf(gpu)).toBe(FakeBitmapTextPipe);
    expect(fakeExtensions.named(WEBGL_PIPES, "bitmapText")).toBe(gpu);

    off();

    expect(fakeExtensions.named(WEBGPU_PIPES, "bitmapText")).toBe(FakeBitmapTextPipe);
    expect(fakeExtensions.named(WEBGL_PIPES, "bitmapText")).toBe(FakeBitmapTextPipe);
  });
});

describe("the host and the bitmap text pipe", () => {
  it("installs the pipe before init in a production build", async () => {
    const mock = createMockRenderer();

    await mock.start();

    const pipe = mock.pixi.last().textPipe;

    expect(pipe).not.toBe(FakeBitmapTextPipe);
    expect(Object.getPrototypeOf(pipe)).toBe(FakeBitmapTextPipe);
    expect(mock.ctx.state.host.uninstallSdfText).toBeTypeOf("function");
  });

  it("installs it on the WebGL fallback too", async () => {
    const mock = createMockRenderer({ kind: "webgl" });

    await mock.start();

    expect(Object.getPrototypeOf(mock.pixi.last().textPipe)).toBe(FakeBitmapTextPipe);
  });

  it("installs nothing while inert", async () => {
    const mock = createMockRenderer({ dom: false });

    await mock.start();

    expect(mock.ctx.state.host.uninstallSdfText).toBeUndefined();
    expect(fakeExtensions.named(WEBGPU_PIPES, "bitmapText")).toBe(FakeBitmapTextPipe);
  });

  it("reuses the installed pipe for the new application after a lost WebGPU device", async () => {
    const mock = createMockRenderer();

    await mock.start();

    const first = mock.pixi.last();

    first.lose("unknown");
    await tick();

    const second = mock.pixi.last();

    expect(second).not.toBe(first);
    expect(second.textPipe).toBe(first.textPipe);
  });

  it("swaps Pixi's own pipe back when the host stops", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.stop();

    expect(fakeExtensions.named(WEBGPU_PIPES, "bitmapText")).toBe(FakeBitmapTextPipe);
    expect(fakeExtensions.named(WEBGL_PIPES, "bitmapText")).toBe(FakeBitmapTextPipe);
    expect(mock.ctx.state.host.uninstallSdfText).toBeUndefined();
  });

  it("starts on Pixi's own pipe and warns when the module lacks the SDF pieces", async () => {
    const mock: MockRenderer = createMockRenderer({
      config: {
        loadPixi: () =>
          Promise.resolve({
            ...mock.pixi.module,
            BitmapTextPipe: undefined
          } as unknown as PixiModule)
      }
    });

    await mock.start();

    expect(mock.api.host.ready()).toBe(true);
    expect(mock.ctx.state.host.uninstallSdfText).toBeUndefined();
    expect(mock.pixi.last().textPipe).toBe(FakeBitmapTextPipe);
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: distance-field text applies its alpha twice",
      expect.objectContaining({ error: expect.any(TypeError) })
    );
  });
});
