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

/** The step of Pixi 8.22's `localUniformMSDFBit` that hands the premultiplied colour over. */
const pixiStep = "calculateMSDFAlpha(outColor, vColor, localUniforms.uDistance)";

/** The step of the renderer: the colour un-premultiplied, at alpha 1. */
const singleAlphaStep =
  "calculateMSDFAlpha(outColor, vec4<f32>(vColor.rgb / max(vColor.a, 1e-4), 1.0), localUniforms.uDistance)";

/** The GLSL step of Pixi 8.22's `localUniformMSDFBitGl`: the same double alpha on WebGL. */
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
    resolution: 1,
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

/** A renderer stub whose resolution a test changes: the canvas of a phone at 2.81. */
type DenseRenderer = ReturnType<typeof rendererOf> & { resolution: number };

/**
 * Builds the renderer's pipe on a renderer stub at a resolution.
 *
 * @param resolution - Device pixels per CSS pixel.
 * @returns The pipe, its renderer and Pixi's own `_updateDistanceField` bound to the pipe.
 */
function densePipe(resolution: number): {
  renderer: DenseRenderer;
  shader(): InstanceType<typeof pixi.Shader>;
  updateDistanceField(text: unknown): void;
} {
  const Pipe = createSdfTextPipe(pixi);
  const renderer: DenseRenderer = { ...rendererOf("webgpu"), resolution };
  const pipe = new Pipe(
    renderer as unknown as ConstructorParameters<typeof Pipe>[0]
  ) as unknown as {
    getSdfShader(): InstanceType<typeof pixi.Shader>;
    _updateDistanceField(text: unknown): void;
  };

  return {
    renderer,
    shader: () => pipe.getSdfShader(),
    updateDistanceField: text => pipe._updateDistanceField(text)
  };
}

/**
 * A distance-field text as Pixi's `_updateDistanceField` reads it: its laid-out graphics on the renderer of uid 1
 * with the shader whose uniforms Pixi writes, its style, and an identity group transform. Its font goes into Pixi's
 * cache: `distanceField.range` 4 at a `baseRenderedFontSize` of 32, the text at 32.
 *
 * @param uniforms - The uniforms Pixi writes `uDistance` into.
 * @returns The text, and the remover of its font.
 */
function distanceText(uniforms: object): { text: unknown; remove(): void } {
  const key = "sdf-pin-bitmap";

  pixi.Cache.set(key, { baseRenderedFontSize: 32, distanceField: { range: 4, type: "msdf" } });

  return {
    text: {
      _gpuData: {
        1: { context: { customShader: { resources: { localUniforms: { uniforms } } } } }
      },
      _style: { fontFamily: "sdf-pin", fontSize: 32 },
      groupTransform: new pixi.Matrix()
    },
    remove: () => pixi.Cache.remove(key)
  };
}

describe("the edge width of distance-field text (PX1)", () => {
  // Pin: when this fails, Pixi multiplies by the resolution itself and the engine's factor must go.
  it("Pixi still writes uDistance in CSS pixels: the day it multiplies by the resolution, remove the engine's factor", () => {
    const written: number[] = [];
    const recorder = {
      set uDistance(value: number) {
        written.push(value);
      }
    };
    const { text, remove } = distanceText(recorder);

    densePipe(2.81).updateDistanceField(text);
    remove();

    expect(written).toEqual([4]);
  });

  // Bug: on a phone at 2.81 the glyph edge is smeared over three device pixels.
  it("the engine's text uniform reads Pixi's distance times the resolution", () => {
    const pipe = densePipe(2.81);
    const uniforms = pipe.shader().resources.localUniforms.uniforms as { uDistance: number };
    const { text, remove } = distanceText(uniforms);

    pipe.updateDistanceField(text);
    remove();

    expect(uniforms.uDistance).toBeCloseTo(11.24, 10);

    // A resolution change of the canvas (C-d) needs nothing more: the next read follows it.
    pipe.renderer.resolution = 2;

    expect(uniforms.uDistance).toBe(8);
  });

  // Bug: a Pixi that copies the values once would upload 4 for ever, whatever the getter answers.
  it("Pixi reads uniforms by property when it uploads them", () => {
    const group = densePipe(2.81).shader().resources.localUniforms as InstanceType<
      typeof pixi.UniformGroup
    >;
    const ubo = new pixi.GpuUboSystem();

    (group.uniforms as { uDistance: number }).uDistance = 4;
    ubo.syncUniformGroup(group);

    const distance = ubo
      .getUniformGroupData(group)
      .layout.uboElements.find(element => element.data.name === "uDistance");
    const data = group.buffer?.data as Float32Array;

    expect(distance).toBeDefined();
    expect(data[(distance?.offset ?? 0) / 4]).toBeCloseTo(11.24, 5);
  });
});

/** The renderer's pipe on a stub whose graphics pipe takes a text's proxy, so Pixi's own `updateRenderable` runs. */
type DrawingPipe = {
  getSdfShader(): InstanceType<typeof pixi.Shader>;
  updateRenderable(text: unknown): void;
};

/**
 * Builds the renderer's pipe on a renderer stub whose graphics pipe takes the text's proxy, so Pixi's own
 * `updateRenderable` runs: it syncs the proxy and writes `uDistance` through `_updateDistanceField`.
 *
 * @param resolution - Device pixels per CSS pixel.
 * @returns The pipe.
 */
function drawingPipe(resolution: number): DrawingPipe {
  const Pipe = createSdfTextPipe(pixi);
  const renderer = {
    ...rendererOf("webgpu"),
    resolution,
    renderPipes: { graphics: { updateRenderable: (): void => undefined } }
  };

  return new Pipe(
    renderer as unknown as ConstructorParameters<typeof Pipe>[0]
  ) as unknown as DrawingPipe;
}

/**
 * A view at a scale with one label in it, on a stage that is a render group: real Pixi containers whose transforms
 * Pixi's own `updateRenderGroupTransforms` brings up to date, as a render does first. The label is laid out by the
 * pipe: its proxy holds the shader the pipe made, and its font is in Pixi's cache (`distanceField.range` 4 at a
 * `baseRenderedFontSize` of 32, the label at 32).
 *
 * @param pipe - The pipe.
 * @param scale - The view's scale.
 * @returns The view, the label, the update of every transform and the label's uniforms.
 */
function labelledView(pipe: DrawingPipe, scale: number) {
  const shader = pipe.getSdfShader();
  const stage = new pixi.Container();
  const view = new pixi.Container();
  const label = Object.assign(new pixi.Container(), {
    _gpuData: { 1: { context: { customShader: shader } } },
    _style: { fontFamily: "sdf-pin", fontSize: 32 }
  });

  pixi.Cache.set("sdf-pin-bitmap", {
    baseRenderedFontSize: 32,
    distanceField: { range: 4, type: "msdf" }
  });
  stage.enableRenderGroup();
  view.scale.set(scale);
  stage.addChild(view);
  view.addChild(label);

  /** Brings every transform up to date, the child groups' too. */
  const update = (): void => {
    if (stage.renderGroup !== null) pixi.updateRenderGroupTransforms(stage.renderGroup, true);
  };

  update();

  return {
    view,
    label,
    update,
    uniforms: shader.resources.localUniforms.uniforms as { uDistance: number }
  };
}

describe("the edge width of distance-field text in a render group (K5)", () => {
  afterEach(() => {
    pixi.Cache.remove("sdf-pin-bitmap");
  });

  // Bug: a kept picture renders its view as a render group of its own (Pixi's `render` makes its root one), so the
  // label's group transform leaves out the view's world scale 0.25 and the picture drew its glyph edges four times
  // sharper than the live frame (merge-game's Play button: `renderer:stale-picture`, 844 pixels).
  it("draws a label inside its view's picture with the edge width it has live", () => {
    const pipe = drawingPipe(1);
    const scene = labelledView(pipe, 0.25);

    pipe.updateRenderable(scene.label);

    const live = scene.uniforms.uDistance;

    scene.view.enableRenderGroup();
    scene.update();
    pipe.updateRenderable(scene.label);

    expect(live).toBeCloseTo(1, 10);
    expect(scene.uniforms.uDistance).toBeCloseTo(1, 10);
  });

  // Bug: Pixi writes the distance only when the group's instructions are built, so a label whose view scaled since
  // (a picture retaken after a scale, a popup that grew) drew the edge of the old scale while the live frame, rebuilt,
  // drew the new one.
  it("follows the label's world scale at each draw, without Pixi writing the distance again", () => {
    const pipe = drawingPipe(2);
    const scene = labelledView(pipe, 0.5);

    pipe.updateRenderable(scene.label);

    expect(scene.uniforms.uDistance).toBeCloseTo(4, 10);

    scene.view.scale.set(0.75);
    scene.update();

    expect(scene.uniforms.uDistance).toBeCloseTo(6, 10);
  });
});
