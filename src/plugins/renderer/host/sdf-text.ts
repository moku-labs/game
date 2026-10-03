/**
 * @file renderer/host — the shader of distance-field (MSDF, SDF) bitmap text. Pixi 8.21 applies
 * the alpha of such text twice: its fragment step hands `calculateMSDFAlpha` the premultiplied
 * vertex colour, the function raises that alpha into the glyph coverage, and the shader template
 * multiplies the coverage by the colour again, so a label at alpha 0.5 draws at about 0.25. The
 * renderer's own bitmap text pipe compiles the same shader with that one step changed: the
 * function gets the colour un-premultiplied at alpha 1, and every alpha, the label's, a parent's
 * or the world's, is applied once, by the template. The pipe is a subclass of Pixi's, put into
 * Pixi's extension registry before `app.init()` under the same name. No Pixi prototype and no
 * Pixi instance is patched. WebGPU only: on WebGL the pipe hands out Pixi's own shader.
 */
import type { PixiModule } from "../types";

/** Pixi's bitmap text pipe class, the base of the renderer's. */
type BitmapTextPipeClass = PixiModule["BitmapTextPipe"];

/** A compiled WebGPU program. */
type GpuProgram = InstanceType<PixiModule["GpuProgram"]>;

/** A Pixi shader: a program and its resources. */
type Shader = InstanceType<PixiModule["Shader"]>;

/** A piece of Pixi's high shader, as `compileHighShaderGpuProgram` takes it. */
type ShaderBit = Parameters<PixiModule["compileHighShaderGpuProgram"]>[0]["bits"][number];

/** The vertex colour un-premultiplied, at alpha 1: what the coverage of a glyph is computed with. */
const UNPREMULTIPLIED = "vec4<f32>(vColor.rgb / max(vColor.a, 1e-4), 1.0)";

/**
 * The fragment step of the renderer's SDF shader, in place of Pixi's
 * `calculateMSDFAlpha(outColor, vColor, …)`. The coverage is the glyph's alone and its gamma
 * leans on the true luma of the colour; the template's `outColor * vColor` applies the alpha.
 */
const SINGLE_ALPHA_STEP = `
            outColor = vec4<f32>(calculateMSDFAlpha(outColor, ${UNPREMULTIPLIED}, localUniforms.uDistance));
        `;

/**
 * The local uniforms of one text, in the order of the WGSL struct, at Pixi's starting values. The
 * pipe writes `uDistance`, the graphics adaptor the rest, before every draw.
 *
 * @param pixi - The loaded Pixi module.
 * @returns A new uniform group.
 */
function createLocalUniforms(pixi: PixiModule): InstanceType<PixiModule["UniformGroup"]> {
  return new pixi.UniformGroup({
    uColor: { value: new Float32Array([1, 1, 1, 1]), type: "vec4<f32>" },
    uTransformMatrix: { value: new pixi.Matrix(), type: "mat3x3<f32>" },
    uDistance: { value: 4, type: "f32" },
    uRound: { value: 0, type: "f32" }
  });
}

/**
 * The compile step of the renderer's SDF program: Pixi's `SdfShader` bits with the fragment step
 * of the local-uniform piece replaced, compiled once per batch texture limit and shared by every
 * text after. Its own function, because lint rule L5 refuses a collection built inside an
 * exported declaration.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The program for a texture limit, compiled the first time it is asked for.
 */
function programCache(pixi: PixiModule): (maxTextures: number) => GpuProgram {
  const base = pixi.localUniformMSDFBit;
  const textBit: ShaderBit = {
    ...base,
    name: "local-uniform-msdf-single-alpha-bit",
    fragment: { ...base.fragment, main: SINGLE_ALPHA_STEP }
  };
  const programs = new Map<number, GpuProgram>();

  return (maxTextures: number): GpuProgram => {
    const known = programs.get(maxTextures);

    if (known !== undefined) return known;

    const program = pixi.compileHighShaderGpuProgram({
      name: "sdf-shader-single-alpha",
      bits: [
        pixi.colorBit,
        pixi.generateTextureBatchBit(maxTextures),
        textBit,
        pixi.mSDFBit,
        pixi.roundPixelsBit
      ]
    });

    programs.set(maxTextures, program);

    return program;
  };
}

/**
 * Builds the renderer's bitmap text pipe from the module object. It is made at call time, because
 * Pixi's pipe arrives with the lazily loaded module. It keeps the base's `static extension` object
 * as it is, so the registry files it under the same types and name. Every WebGPU text gets a new
 * shader, as from Pixi's pipe, over the one shared program of `programCache`.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The pipe class.
 */
export function createSdfTextPipe(pixi: PixiModule): BitmapTextPipeClass {
  const programFor = programCache(pixi);

  /** Pixi's bitmap text pipe, with an SDF shader that applies the alpha once on WebGPU. */
  class SingleAlphaBitmapTextPipe extends pixi.BitmapTextPipe {
    public static override readonly extension = pixi.BitmapTextPipe.extension;

    /**
     * The shader of one distance-field text, asked for each time Pixi lays the text out.
     *
     * @returns A new shader with its own local uniforms: the renderer's on WebGPU, Pixi's own on
     *   WebGL.
     */
    protected override getSdfShader(): Shader | null {
      const renderer = this._renderer;

      if (renderer.name !== "webgpu") return super.getSdfShader();

      return new pixi.Shader({
        gpuProgram: programFor(renderer.limits.maxBatchableTextures),
        resources: { localUniforms: createLocalUniforms(pixi) }
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
