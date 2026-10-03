import * as pixi from "pixi.js";
import { describe, expect, it } from "vitest";
import { createSdfTextPipe } from "../../host/sdf-text";

// ---------------------------------------------------------------------------
// Unit test against the real pixi.js module, no GPU: the pieces the renderer's
// bitmap text pipe builds on exist under the names and the WGSL it relies on,
// and the shader it compiles hands the alpha over once. The CI pin: a Pixi
// rename, or a Pixi that fixes the double alpha itself, fails here.
// ---------------------------------------------------------------------------

/** The step of Pixi 8.21's `localUniformMSDFBit` that hands the premultiplied colour over. */
const pixiStep = "calculateMSDFAlpha(outColor, vColor, localUniforms.uDistance)";

/** The step of the renderer: the colour un-premultiplied, at alpha 1. */
const singleAlphaStep =
  "calculateMSDFAlpha(outColor, vec4<f32>(vColor.rgb / max(vColor.a, 1e-4), 1.0), localUniforms.uDistance)";

/** The renderer a pipe is built with: the members the pipe and its hash read. */
const webgpuRenderer = {
  name: "webgpu",
  uid: 1,
  limits: { maxBatchableTextures: 16 },
  gc: { addResourceHash: (): void => undefined }
};

/**
 * Builds the renderer's pipe on a WebGPU renderer stub and asks it for the shader of one text.
 *
 * @returns The shader.
 */
function shaderOfOneText(): InstanceType<typeof pixi.Shader> {
  const Pipe = createSdfTextPipe(pixi);
  const pipe = new Pipe(webgpuRenderer as unknown as ConstructorParameters<typeof Pipe>[0]);

  return (pipe as unknown as { getSdfShader(): InstanceType<typeof pixi.Shader> }).getSdfShader();
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
      roundPixelsBit: pixi.roundPixelsBit
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

  it("carries the local uniforms the pipe and the graphics adaptor write", () => {
    const uniforms = shaderOfOneText().resources.localUniforms.uniforms;

    expect(uniforms.uDistance).toBe(4);
    expect(uniforms.uRound).toBe(0);
    expect(uniforms.uColor).toEqual(new Float32Array([1, 1, 1, 1]));
    expect(uniforms.uTransformMatrix).toBeInstanceOf(pixi.Matrix);
  });
});
