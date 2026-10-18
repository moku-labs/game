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
  const { a, b, c, d } = linear;

  // per draw: the square root of the squares, as Pixi's own; `Math.hypot` takes its arguments as a list.
  // eslint-disable-next-line unicorn/prefer-modern-math-apis -- the hot path's form, E1.
  return (Math.sqrt(a * a + b * b) + Math.sqrt(c * c + d * d)) / 2;
}

/**
 * The key the state of a text's `uDistance` hangs under on its uniforms: a symbol, not enumerable, so Pixi's walk of
 * the uniforms (`for…in` on WebGL) and a deep compare see the four uniforms alone.
 */
const DISTANCE = Symbol("sdf-text-distance");

/** What the `uDistance` accessor of one text reads and writes. */
type DistanceState = {
  /**
   * `[0]`: Pixi's last write, CSS px; `[1]`: that write per unit of the group scale it was made with, 0 when none is
   * known; `[2]`: the last answer of a read, `NaN` before the first. Doubles in a typed array: a write or a read of
   * them boxes nothing.
   */
  readonly cell: Float64Array;
  /** The text of Pixi's last write. */
  text: TextTransforms | undefined;
  /** The text whose distance Pixi writes now, held by the pipe. */
  readonly writing: Readonly<Writing>;
  /** What the device pixels per CSS pixel are read from at each draw: the renderer. */
  readonly density: { readonly resolution: number };
  /**
   * The last answer of a read, `cell[2]` as the number V8 boxed it into once; `undefined` before the first. A field that
   * starts as `undefined` keeps its numbers boxed, so it is handed back as it is: a double computed and returned to
   * Pixi's sync, which may not inline the getter, is boxed again at every draw (16 B a text a frame).
   */
  answer: number | undefined;
};

/** The local uniforms of one text in the order of the WGSL struct, the state of `uDistance` under its symbol. */
type TextUniforms = {
  uColor: Float32Array<ArrayBuffer>;
  uTransformMatrix: InstanceType<PixiModule["Matrix"]>;
  uDistance: number;
  uRound: number;
  readonly [DISTANCE]: DistanceState;
};

/**
 * Pixi's read of `uDistance`, at every upload: the distance per unit of scale at the text's world scale, or Pixi's last
 * write without one, times the renderer's resolution.
 *
 * @param this - The text's uniforms.
 * @returns The distance in device pixels.
 */
function readDistance(this: TextUniforms): number {
  const state = this[DISTANCE];
  const perScale = state.cell[1] ?? 0;
  const text = state.text;
  const css =
    text === undefined || perScale === 0
      ? (state.cell[0] ?? 0)
      : perScale * scaleOf(text.worldTransform);
  const distance = css * state.density.resolution;
  const answer = state.answer;

  // per draw: a still text hands back its last answer, boxed once. Compared through the cell, not the field: a number
  // compare would unbox the field, and V8 would box the return again.
  if (answer !== undefined && distance === state.cell[2]) return answer;

  state.cell[2] = distance;
  state.answer = distance;

  return distance;
}

/**
 * Pixi's write of `uDistance`, at a layout: the CSS distance and, while the pipe names the text, the distance per unit
 * of its group scale.
 *
 * @param this - The text's uniforms.
 * @param value - Pixi's distance, CSS px.
 */
function writeDistance(this: TextUniforms, value: number): void {
  const state = this[DISTANCE];
  const text = state.writing.text;
  const scale = text === undefined ? 0 : scaleOf(text.groupTransform);

  state.cell[0] = value;
  state.cell[1] = scale > 0 ? value / scale : 0;
  state.text = text;
}

/**
 * The `uDistance` of every text's uniforms: one pair of functions, so every uniforms object has the same hidden class
 * and Pixi's generated sync function reads it monomorphic. A pair made per text, or an accessor laid over Pixi's data
 * property, sends each object to dictionary mode. The getter hands a still text's answer back boxed once (`answer`):
 * Pixi's sync may not inline it.
 */
const DISTANCE_ACCESSOR: PropertyDescriptor = {
  enumerable: true,
  configurable: true,
  get: readDistance,
  set: writeDistance
};

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
 * The uniforms object is the renderer's own, made in one shape for every text with the one accessor pair
 * `DISTANCE_ACCESSOR`, in place of the one Pixi's group made.
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
  const values = group.uniforms;
  // Pixi's starting value, the one the group was made with, and no scale known.
  const state: DistanceState = {
    cell: Float64Array.of(4, 0, Number.NaN),
    text: undefined,
    writing,
    density,
    answer: undefined
  };
  const uniforms = {
    uColor: values.uColor,
    uTransformMatrix: values.uTransformMatrix,
    uRound: values.uRound
  };

  Object.defineProperty(uniforms, "uDistance", DISTANCE_ACCESSOR);
  Object.defineProperty(uniforms, DISTANCE, { value: state });
  group.uniforms = uniforms as TextUniforms;

  return group;
}

/**
 * The shader a text already draws with on one renderer: the custom shader of its graphics context.
 *
 * @param text - The text.
 * @param renderer - The renderer's uid, the key of the text's GPU data.
 * @returns The shader, or `undefined` before the text was laid out on that renderer.
 */
function shaderOf(text: BitmapText, renderer: number): Shader | undefined {
  const gpu: { readonly context: { readonly customShader?: Shader | null } } | undefined =
    text._gpuData[renderer];

  return gpu?.context.customShader ?? undefined;
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
 * as it is, so the registry files it under the same types and name. Every text gets a shader of its
 * own once, at its first layout, over the one shared program of its backend, and keeps it when it is laid out again
 * (Pixi asks for one at every layout); a WebGL shader also gets
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
     * The text Pixi lays out now: `getSdfShader` hands its own shader back, read at the call, so the text keeps it and no
     * shader is made. Pixi asks `getSdfShader()` at every layout of a text (twice for a new one) and keeps the answer
     * only for a context without a shader: a new shader each time was garbage (about 22 KB a text update), and on WebGL
     * it listened to the shared batch-sampler group for good, a leak.
     */
    private laying: BitmapText | undefined;

    /**
     * Adds a text to the instructions as Pixi does, naming it while Pixi writes its distance and lays it out.
     *
     * @param text - The text.
     * @param instructionSet - The instructions of its render group.
     */
    public override addRenderable(text: BitmapText, instructionSet: InstructionSet): void {
      this.writing.text = text;
      this.laying = text;
      super.addRenderable(text, instructionSet);
      this.laying = undefined;
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
     * The shader of one distance-field text, asked for each time Pixi lays the text out: the text's own when it has one,
     * else a new one.
     *
     * @returns The text's shader, or a new shader with its own local uniforms on the program of the backend.
     */
    protected override getSdfShader(): Shader | null {
      const own = this.laying === undefined ? undefined : shaderOf(this.laying, this._renderer.uid);

      if (own !== undefined) return own;

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
