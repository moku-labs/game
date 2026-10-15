/**
 * @file renderer/host — the shader of distance-field (MSDF, SDF) bitmap text, with two fixes of Pixi 8.22.
 * The double alpha: Pixi's fragment step hands `calculateMSDFAlpha` the premultiplied vertex colour, the function
 * raises that alpha into the glyph coverage, and the shader template multiplies the coverage by the colour again, so a
 * label at alpha 0.5 draws at about 0.25. The renderer's own bitmap text pipe compiles the same shader with that one
 * step changed: the function gets the colour un-premultiplied at alpha 1, and every alpha, the label's, a parent's or
 * the world's, is applied once, by the template. The edge width (PX1): Pixi writes `uDistance` in CSS pixels, and the
 * shader spreads the glyph edge over that many device pixels, so text on a phone at resolution 2.8 is smeared. The
 * text's uniform group, which the renderer makes, answers Pixi's distance times the renderer's resolution, read at
 * every draw. The scale of the edge (K5): Pixi scales the distance by the text's group transform, which inside a render
 * group leaves out the group's own scale, and writes it only when the group's instructions are built. A kept picture
 * renders its view as a render group of its own, so a label of a view at world scale 0.25 drew four times sharper in
 * the picture than live; the group answers Pixi's distance per unit of scale times the text's world scale, read at the
 * draw too. The pipe is a subclass of Pixi's, put into Pixi's extension registry before `app.init()` under the same
 * name. No Pixi prototype and no Pixi instance is patched. Both backends: the WGSL program on WebGPU, the GLSL one on
 * WebGL.
 */
import type { PixiModule } from "../types";

/** Pixi's bitmap text pipe class, the base of the renderer's. */
type BitmapTextPipeClass = PixiModule["BitmapTextPipe"];

/** A compiled WebGPU program. */
type GpuProgram = InstanceType<PixiModule["GpuProgram"]>;

/** A compiled WebGL program. */
type GlProgram = ReturnType<PixiModule["compileHighShaderGlProgram"]>;

/** A Pixi shader: a program and its resources. */
type Shader = InstanceType<PixiModule["Shader"]>;

/** Pixi's bitmap text pipe, as the renderer's subclasses it. */
type BitmapTextPipe = InstanceType<BitmapTextPipeClass>;

/** A bitmap text, as Pixi's pipe draws it. */
type BitmapText = Parameters<BitmapTextPipe["addRenderable"]>[0];

/** The instructions Pixi's pipe adds a text to. */
type InstructionSet = Parameters<BitmapTextPipe["addRenderable"]>[1];

/** The linear part of a transform, as Pixi's matrices hold it. */
type Linear = { readonly a: number; readonly b: number; readonly c: number; readonly d: number };

/** What the uniforms of a text read of it: its transform against its render group, which Pixi scales by, and its world. */
type TextTransforms = { readonly groupTransform: Linear; readonly worldTransform: Linear };

/** The text whose distance Pixi writes now: the pipe holds it around Pixi's two writers, one object per pipe. */
type Writing = { text: TextTransforms | undefined };

/** A piece of Pixi's high shader, as `compileHighShaderGpuProgram` takes it. */
type ShaderBit = Parameters<PixiModule["compileHighShaderGpuProgram"]>[0]["bits"][number];

/** A GLSL piece of Pixi's high shader, as `compileHighShaderGlProgram` takes it. */
type ShaderBitGl = Parameters<PixiModule["compileHighShaderGlProgram"]>[0]["bits"][number];

/**
 * The fragment step of the renderer's WGSL SDF shader, in place of Pixi's
 * `calculateMSDFAlpha(outColor, vColor, …)`. The coverage is the glyph's alone and its gamma
 * leans on the true luma of the colour; the template's `outColor * vColor` applies the alpha.
 */
const SINGLE_ALPHA_STEP = `
            outColor = vec4<f32>(calculateMSDFAlpha(outColor, vec4<f32>(vColor.rgb / max(vColor.a, 1e-4), 1.0), localUniforms.uDistance));
        `;

/** The same fragment step in GLSL, for the WebGL program. */
const SINGLE_ALPHA_STEP_GL = `
            outColor = vec4(calculateMSDFAlpha(outColor, vec4(vColor.rgb / max(vColor.a, 1e-4), 1.0), uDistance));
        `;

/** The name of the renderer's local-uniform piece, apart from Pixi's in its shader cache. */
const TEXT_BIT_NAME = "local-uniform-msdf-single-alpha-bit";

/** The name of the renderer's SDF program, on both backends. */
const PROGRAM_NAME = "sdf-shader-single-alpha";

/**
 * The scale of a transform as Pixi's `_updateDistanceField` measures it: the mean length of its two axes. Pure.
 *
 * @param linear - The linear part of a transform.
 * @returns The scale.
 * @example
 * ```ts
 * scaleOf({ a: 0.25, b: 0, c: 0, d: 0.25 }); // 0.25
 * ```
 */
function scaleOf(linear: Linear): number {
  return (Math.hypot(linear.a, linear.b) + Math.hypot(linear.c, linear.d)) / 2;
}

/**
 * The local uniforms of one text, in the order of the WGSL struct, at Pixi's starting values. The
 * pipe writes `uDistance`, the graphics adaptor the rest, before every draw.
 *
 * Pixi writes `uDistance` in CSS pixels (`AbstractBitmapTextPipe._updateDistanceField`: the scale
 * of the text's group transform times the font's range over its scale), while the shader measures
 * the glyph edge in device pixels, so at a resolution above 1 the edge is smeared over that many
 * more pixels. The group's `uDistance` is therefore an accessor: Pixi's write keeps the CSS value,
 * every read answers it times `density.resolution`, and Pixi reads the uniform by property each
 * time it uploads it, on both backends. The resolution is read at the draw, so a change of
 * resolution needs nothing more.
 *
 * The scale is the text's world scale, read at the draw as well. Pixi's group transform is the
 * text against its render group, which leaves out the group's own scale: a kept picture renders its
 * view as a render group of its own, so its labels would draw with other edges than live. And Pixi
 * writes the distance only when the group's instructions are built, so a label whose view scaled
 * since would keep the edge of the old scale. A write of Pixi made while the pipe names the text
 * keeps the distance per unit of the group scale it was made with; a read answers that times the
 * text's world scale. A write without a text, or at a group scale of 0, is answered as Pixi wrote it.
 *
 * @param pixi - The loaded Pixi module.
 * @param density - What the device pixels per CSS pixel are read from at each draw: the renderer.
 * @param density.resolution - The renderer's resolution, read at each upload.
 * @param writing - The text whose distance Pixi writes now, held by the pipe.
 * @returns A new uniform group.
 */
function createLocalUniforms(
  pixi: PixiModule,
  density: { readonly resolution: number },
  writing: Readonly<Writing>
): InstanceType<PixiModule["UniformGroup"]> {
  const group = new pixi.UniformGroup({
    uColor: { value: new Float32Array([1, 1, 1, 1]), type: "vec4<f32>" },
    uTransformMatrix: { value: new pixi.Matrix(), type: "mat3x3<f32>" },
    uDistance: { value: 4, type: "f32" },
    uRound: { value: 0, type: "f32" }
  });
  // Pixi's starting value, the one the group was made with.
  let css = 4;
  // The text of Pixi's last write, and the distance per unit of its group scale then; 0 when none is known.
  let text: TextTransforms | undefined;
  let perScale = 0;

  Object.defineProperty(group.uniforms, "uDistance", {
    enumerable: true,
    get: (): number =>
      (text === undefined || perScale === 0 ? css : perScale * scaleOf(text.worldTransform)) *
      density.resolution,
    set: (value: number): void => {
      const scale = writing.text === undefined ? 0 : scaleOf(writing.text.groupTransform);

      css = value;
      text = writing.text;
      perScale = scale > 0 ? value / scale : 0;
    }
  });

  return group;
}

/**
 * Keeps one compiled program per batch texture limit: compiled the first time a limit is asked
 * for, shared by every text after. Its own function, because lint rule L5 refuses a collection
 * built inside an exported declaration.
 *
 * @param compile - Compiles the program of one texture limit.
 * @returns The program for a texture limit.
 */
function cachedBy<Program>(
  compile: (maxTextures: number) => Program
): (maxTextures: number) => Program {
  const programs = new Map<number, Program>();

  return (maxTextures: number): Program => {
    const known = programs.get(maxTextures);

    if (known !== undefined) return known;

    const program = compile(maxTextures);

    programs.set(maxTextures, program);

    return program;
  };
}

/**
 * The compile step of the renderer's WGSL SDF program: Pixi's `SdfShader` bits with the fragment
 * step of the local-uniform piece replaced.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The WebGPU program for a texture limit.
 */
function gpuProgramCache(pixi: PixiModule): (maxTextures: number) => GpuProgram {
  const base = pixi.localUniformMSDFBit;
  const textBit: ShaderBit = {
    ...base,
    name: TEXT_BIT_NAME,
    fragment: { ...base.fragment, main: SINGLE_ALPHA_STEP }
  };

  return cachedBy(maxTextures =>
    pixi.compileHighShaderGpuProgram({
      name: PROGRAM_NAME,
      bits: [
        pixi.colorBit,
        pixi.generateTextureBatchBit(maxTextures),
        textBit,
        pixi.mSDFBit,
        pixi.roundPixelsBit
      ]
    })
  );
}

/**
 * The compile step of the renderer's GLSL SDF program: Pixi's `SdfShader` GL bits with the same
 * fragment step replaced.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The WebGL program for a texture limit.
 */
function glProgramCache(pixi: PixiModule): (maxTextures: number) => GlProgram {
  const base = pixi.localUniformMSDFBitGl;
  const textBit: ShaderBitGl = {
    ...base,
    name: TEXT_BIT_NAME,
    fragment: { ...base.fragment, main: SINGLE_ALPHA_STEP_GL }
  };

  return cachedBy(maxTextures =>
    pixi.compileHighShaderGlProgram({
      name: PROGRAM_NAME,
      bits: [
        pixi.colorBitGl,
        pixi.generateTextureBatchBitGl(maxTextures),
        textBit,
        pixi.mSDFBitGl,
        pixi.roundPixelsBitGl
      ]
    })
  );
}

/**
 * Builds the renderer's bitmap text pipe from the module object. It is made at call time, because
 * Pixi's pipe arrives with the lazily loaded module. It keeps the base's `static extension` object
 * as it is, so the registry files it under the same types and name. Every text gets a new shader,
 * as from Pixi's pipe, over the one shared program of its backend; a WebGL shader also gets
 * Pixi's batch sampler slots, as Pixi's own `SdfShader` does. Its `uDistance` answers Pixi's CSS
 * distance at the text's world scale times the renderer's resolution: the pipe names the text
 * while Pixi's `addRenderable` and `updateRenderable`, the two that write the distance, run.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The pipe class.
 */
export function createSdfTextPipe(pixi: PixiModule): BitmapTextPipeClass {
  const gpuProgramFor = gpuProgramCache(pixi);
  const glProgramFor = glProgramCache(pixi);

  /** Pixi's bitmap text pipe, with an SDF shader that applies the alpha once. */
  class SingleAlphaBitmapTextPipe extends pixi.BitmapTextPipe {
    public static override readonly extension = pixi.BitmapTextPipe.extension;

    /** The text whose distance Pixi writes now, read by the uniforms of every text of this pipe. */
    private readonly writing: Writing = { text: undefined };

    /**
     * Adds a text to the instructions as Pixi does, naming it while Pixi writes its distance.
     *
     * @param text - The text.
     * @param instructionSet - The instructions of its render group.
     */
    public override addRenderable(text: BitmapText, instructionSet: InstructionSet): void {
      this.writing.text = text;
      super.addRenderable(text, instructionSet);
      this.writing.text = undefined;
    }

    /**
     * Updates a text as Pixi does, naming it while Pixi writes its distance.
     *
     * @param text - The text.
     */
    public override updateRenderable(text: BitmapText): void {
      this.writing.text = text;
      super.updateRenderable(text);
      this.writing.text = undefined;
    }

    /**
     * The shader of one distance-field text, asked for each time Pixi lays the text out.
     *
     * @returns A new shader with its own local uniforms, on the program of the backend.
     */
    protected override getSdfShader(): Shader | null {
      const maxTextures = this._renderer.limits.maxBatchableTextures;
      // The canvas's resolution, read at each draw: the edge width in device pixels.
      const density = this._renderer;

      if (this._renderer.name === "webgpu") {
        return new pixi.Shader({
          gpuProgram: gpuProgramFor(maxTextures),
          resources: { localUniforms: createLocalUniforms(pixi, density, this.writing) }
        });
      }

      return new pixi.Shader({
        glProgram: glProgramFor(maxTextures),
        resources: {
          localUniforms: createLocalUniforms(pixi, density, this.writing),
          batchSamplers: pixi.getBatchSamplersUniformGroup(maxTextures)
        }
      });
    }
  }

  return SingleAlphaBitmapTextPipe;
}

/**
 * Swaps Pixi's bitmap text pipe for the renderer's in the module's extension registry: `remove`
 * frees the name on both backends, `add` puts the subclass in under it. Every application made
 * afterwards draws its distance-field text with it. The registry is global to the module object,
 * so the remover matters: it swaps Pixi's own pipe back.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The remover.
 * @throws {TypeError} When the module has no `BitmapTextPipe` to subclass.
 */
export function installSdfTextPipe(pixi: PixiModule): () => void {
  const pipe = createSdfTextPipe(pixi);

  pixi.extensions.remove(pixi.BitmapTextPipe);
  pixi.extensions.add(pipe);

  return (): void => {
    pixi.extensions.remove(pipe);
    pixi.extensions.add(pixi.BitmapTextPipe);
  };
}
