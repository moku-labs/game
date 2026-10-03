import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSdfTextPipe } from "../../host/sdf-text";

// ---------------------------------------------------------------------------
// Unit test against the real pixi.js module, no GPU: the pieces the renderer's
// bitmap text pipe builds on exist under the names, the WGSL and the GLSL it
// relies on, and the shader it compiles hands the alpha over once on both
// backends. The CI pin: a Pixi rename, or a Pixi that fixes the double alpha
// itself, fails here.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The step of Pixi 8.21's `localUniformMSDFBit` that hands the premultiplied colour over. */
const pixiStep = "calculateMSDFAlpha(outColor, vColor, localUniforms.uDistance)";

/** The step of the renderer: the colour un-premultiplied, at alpha 1. */
const singleAlphaStep =
  "calculateMSDFAlpha(outColor, vec4<f32>(vColor.rgb / max(vColor.a, 1e-4), 1.0), localUniforms.uDistance)";

/** The GLSL step of Pixi 8.21's `localUniformMSDFBitGl`: the same double alpha on WebGL. */
const pixiStepGl = "calculateMSDFAlpha(outColor, vColor, uDistance)";

/** The GLSL step of the renderer: the colour un-premultiplied, at alpha 1. */
const singleAlphaStepGl =
  "calculateMSDFAlpha(outColor, vec4(vColor.rgb / max(vColor.a, 1e-4), 1.0), uDistance)";

/**
 * The renderer a pipe is built with: the members the pipe and its hash read.
 *
 * @param name - The backend.
 * @returns The renderer stub.
 */
function rendererOf(name: "webgpu" | "webgl") {
  return {
    name,
    uid: 1,
    limits: { maxBatchableTextures: 16 },
    gc: { addResourceHash: (): void => undefined }
  };
}

/**
 * Builds the renderer's pipe on a renderer stub and asks it for the shader of one text.
 *
 * @param name - The backend of the stub; WebGPU when left out.
 * @returns The shader.
 */
function shaderOfOneText(name: "webgpu" | "webgl" = "webgpu"): InstanceType<typeof pixi.Shader> {
  const Pipe = createSdfTextPipe(pixi);
  const pipe = new Pipe(rendererOf(name) as unknown as ConstructorParameters<typeof Pipe>[0]);

  return (pipe as unknown as { getSdfShader(): InstanceType<typeof pixi.Shader> }).getSdfShader();
}

/**
 * Gives Pixi's GLSL compile a document: a `GlProgram` asks a canvas for the highest fragment
 * precision, and a canvas without WebGL answers `mediump`.
 */
function stubCanvasDocument(): void {
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => undefined }) });
}

describe("the bitmap text pipe of the real Pixi module", () => {
  it("registers under the name the renderer swaps, on both backends", () => {
    expect(pixi.BitmapTextPipe.extension).toEqual({
      type: [pixi.ExtensionType.WebGLPipes, pixi.ExtensionType.WebGPUPipes],
      name: "bitmapText"
    });
    expect(typeof pixi.BitmapTextPipe.prototype["getSdfShader" as never]).toBe("function");
  });

  it("hands the premultiplied colour to calculateMSDFAlpha, the step the renderer replaces", () => {
    expect(pixi.localUniformMSDFBit.fragment.main).toContain(pixiStep);
    expect(pixi.mSDFBit.fragment.header).toContain(
      "fn calculateMSDFAlpha(msdfColor:vec4<f32>, shapeColor:vec4<f32>, distance:f32) -> f32"
    );
    expect(pixi.mSDFBit.fragment.header).toContain("pow(shapeColor.a * alpha, gamma)");
  });

  it("hands the premultiplied colour over in GLSL too, the step the renderer replaces on WebGL", () => {
    expect(pixi.localUniformMSDFBitGl.fragment.main).toContain(pixiStepGl);
    expect(pixi.mSDFBitGl.fragment.header).toContain(
      "float calculateMSDFAlpha(vec4 msdfColor, vec4 shapeColor, float distance)"
    );
    expect(pixi.mSDFBitGl.fragment.header).toContain("pow(shapeColor.a * alpha, gamma)");
  });

  it("exports every name the pipe builds with", () => {
    const exported = {
      BitmapTextPipe: pixi.BitmapTextPipe,
      Shader: pixi.Shader,
      Matrix: pixi.Matrix,
      UniformGroup: pixi.UniformGroup,
      compileHighShaderGpuProgram: pixi.compileHighShaderGpuProgram,
      colorBit: pixi.colorBit,
      generateTextureBatchBit: pixi.generateTextureBatchBit,
      localUniformMSDFBit: pixi.localUniformMSDFBit,
      mSDFBit: pixi.mSDFBit,
      roundPixelsBit: pixi.roundPixelsBit,
      compileHighShaderGlProgram: pixi.compileHighShaderGlProgram,
      colorBitGl: pixi.colorBitGl,
      generateTextureBatchBitGl: pixi.generateTextureBatchBitGl,
      localUniformMSDFBitGl: pixi.localUniformMSDFBitGl,
      mSDFBitGl: pixi.mSDFBitGl,
      roundPixelsBitGl: pixi.roundPixelsBitGl,
      getBatchSamplersUniformGroup: pixi.getBatchSamplersUniformGroup
    };

    for (const [name, value] of Object.entries(exported)) expect(value, name).toBeDefined();
  });

  it("is subclassed with the identical metadata object", () => {
    const Pipe = createSdfTextPipe(pixi);

    expect(Object.getPrototypeOf(Pipe)).toBe(pixi.BitmapTextPipe);
    expect(Pipe.extension).toBe(pixi.BitmapTextPipe.extension);
  });

  it("compiles a WebGPU shader whose fragment applies the alpha once", () => {
    const shader = shaderOfOneText();
    const fragment = shader.gpuProgram.fragment?.source;

    expect(fragment).toContain(singleAlphaStep);
    expect(fragment).not.toContain(pixiStep);
    // The template applies the alpha once, at the end: the coverage times vColor.
    expect(fragment).toContain("outColor * vColor");
    expect(shader.glProgram).toBeUndefined();
  });

  it("compiles a WebGL shader whose fragment applies the alpha once", () => {
    stubCanvasDocument();

    const shader = shaderOfOneText("webgl");
    const fragment = shader.glProgram.fragment;

    expect(fragment).toContain(singleAlphaStepGl);
    expect(fragment).not.toContain(pixiStepGl);
    // The template applies the alpha once, at the end: the coverage times vColor.
    expect(fragment).toContain("finalColor = outColor * vColor");
    expect(shader.gpuProgram).toBeUndefined();
    expect(shader.resources.batchSamplers).toBe(pixi.getBatchSamplersUniformGroup(16));
  });

  it("carries the local uniforms the pipe and the graphics adaptor write", () => {
    const uniforms = shaderOfOneText().resources.localUniforms.uniforms;

    expect(uniforms.uDistance).toBe(4);
    expect(uniforms.uRound).toBe(0);
    expect(uniforms.uColor).toEqual(new Float32Array([1, 1, 1, 1]));
    expect(uniforms.uTransformMatrix).toBeInstanceOf(pixi.Matrix);
  });
});
