/**
 * @file renderer/host — the shader of distance-field (MSDF, SDF) bitmap text. Pixi 8.21 applies
 * the alpha of such text twice: its fragment step hands `calculateMSDFAlpha` the premultiplied
 * vertex colour, the function raises that alpha into the glyph coverage, and the shader template
 * multiplies the coverage by the colour again, so a label at alpha 0.5 draws at about 0.25. The
 * renderer's own bitmap text pipe compiles the same shader with that one step changed: the
 * function gets the colour un-premultiplied at alpha 1, and every alpha, the label's, a parent's
 * or the world's, is applied once, by the template. The pipe is a subclass of Pixi's, put into
 * Pixi's extension registry before `app.init()` under the same name. No Pixi prototype and no
 * Pixi instance is patched. Both backends: the WGSL program on WebGPU, the GLSL one on WebGL.
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
 * Pixi's batch sampler slots, as Pixi's own `SdfShader` does.
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

    /**
     * The shader of one distance-field text, asked for each time Pixi lays the text out.
     *
     * @returns A new shader with its own local uniforms, on the program of the backend.
     */
    protected override getSdfShader(): Shader | null {
      const maxTextures = this._renderer.limits.maxBatchableTextures;

      if (this._renderer.name === "webgpu") {
        return new pixi.Shader({
          gpuProgram: gpuProgramFor(maxTextures),
          resources: { localUniforms: createLocalUniforms(pixi) }
        });
      }

      return new pixi.Shader({
        glProgram: glProgramFor(maxTextures),
        resources: {
          localUniforms: createLocalUniforms(pixi),
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
