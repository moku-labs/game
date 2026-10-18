/**
 * @file renderer — a bitmap text on the renderer's SDF pipe over the real pixi.js module, no GPU: a distance-field font
 * made from data, a renderer stub with the members the pipe and Pixi's graphics pipe read, and a counter of the shaders
 * made. Not a test file: the unit and the perf files of the SDF text share it.
 */
import * as pixi from "pixi.js";
import { createSdfTextPipe } from "../host/sdf-text";
import type { PixiModule } from "../types";

/** The font family of the stage's distance-field font. */
const FAMILY = "sdf-stage";

/** A bitmap text of the stage and what drawing it needs. */
export type SdfTextStage = {
  text: InstanceType<typeof pixi.BitmapText>;
  /** Lays the text out as Pixi does when its text changed, through the renderer's pipe, as a render group collects it. */
  update(next: string): void;
  /** The shader the text's graphics context draws with. */
  shader(): unknown;
  /** Shaders the pipe made so far. */
  made(): number;
  /** Lays out another text of this text's font on the same pipe, once, and answers it. */
  add(text: string): InstanceType<typeof pixi.BitmapText>;
};

/**
 * Installs the stage's distance-field font once: ten digits on Pixi's white texture, an MSDF range of 4.
 */
function installFont(): void {
  if (pixi.Cache.has(`${FAMILY}-bitmap`)) return;

  const chars: Record<string, object> = {};

  for (let digit = 0; digit < 10; digit += 1) {
    chars[String(digit)] = {
      id: 48 + digit,
      page: 0,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      xOffset: 0,
      yOffset: 0,
      xAdvance: 20,
      kerning: {}
    };
  }

  const font = new pixi.BitmapFont({
    data: {
      pages: [{ id: 0, file: "" }],
      chars,
      fontSize: 32,
      lineHeight: 36,
      baseLineOffset: 26,
      fontFamily: FAMILY,
      distanceField: { type: "msdf", range: 4 }
    },
    textures: [pixi.Texture.WHITE]
  } as unknown as ConstructorParameters<typeof pixi.BitmapFont>[0]);

  pixi.Cache.set(`${FAMILY}-bitmap`, font);
}

/** The uniform group of a text's shader, as Pixi's ubo system syncs it. */
type TextUniformGroup = InstanceType<typeof pixi.UniformGroup>;

/**
 * The distance-field texts of one pipe, laid out once each, and one frame of their local uniforms as Pixi draws them:
 * the graphics pipe writes the transform, the rounding and the colour, then the ubo system's generated function reads
 * every uniform, `uDistance` through the renderer's accessor, into the frame's uniform buffer. The renderer draws at a
 * phone's resolution, so every distance is a fraction, as on the A26.
 *
 * @param count - The texts.
 * @returns One frame of the sync of every text.
 */
export function sdfSyncStage(count: number): () => void {
  const stage = sdfTextStage("webgpu", 2.8);
  const texts = [stage.text];
  const drawn: Array<{
    text: InstanceType<typeof pixi.BitmapText>;
    group: TextUniformGroup;
    offset: number;
  }> = [];

  for (let index = 1; index < count; index += 1) {
    texts.push(stage.add(String(index % 10)));
  }

  for (const text of texts) {
    const shader = (text._gpuData as Record<number, { context: { customShader: pixi.Shader } }>)[1]
      ?.context.customShader;
    const group = shader?.resources.localUniforms as TextUniformGroup | undefined;

    if (group === undefined) throw new Error("sdf stage: a text has no local uniforms");

    drawn.push({ text, group, offset: drawn.length * 64 });
  }

  const ubo = new pixi.GpuUboSystem();
  const data = new Float32Array(64 * count);
  const white = 0xff_ff_ff_ff;

  return () => {
    for (const { text, group, offset } of drawn) {
      const uniforms = group.uniforms;

      uniforms.uTransformMatrix = text.groupTransform;
      uniforms.uRound = 0;
      pixi.color32BitToUniform(white, uniforms.uColor as Float32Array, 0);
      ubo.syncUniformGroup(group, data, offset);
    }
  };
}

/**
 * Builds the renderer's pipe on a renderer stub of one backend and a text on it, laid out once.
 *
 * @param backend - `"webgpu"` or `"webgl"`.
 * @param resolution - The renderer's resolution.
 * @returns The stage.
 */
export function sdfTextStage(backend: "webgpu" | "webgl" = "webgpu", resolution = 1): SdfTextStage {
  let made = 0;

  /** Pixi's shader, counted. */
  class CountedShader extends pixi.Shader {
    public constructor(options: ConstructorParameters<typeof pixi.Shader>[0]) {
      super(options);
      made += 1;
    }
  }

  installFont();

  const module = { ...pixi, Shader: CountedShader } as unknown as PixiModule;
  const Pipe = createSdfTextPipe(module);
  const renderer = {
    name: backend,
    uid: 1,
    resolution,
    limits: { maxBatchableTextures: 16 },
    gc: { addResourceHash: (): void => undefined, now: 0 },
    renderPipes: {
      graphics: {
        addRenderable: (): void => undefined,
        updateRenderable: (): void => undefined,
        validateRenderable: (): boolean => false
      }
    }
  };
  const pipe = new Pipe(renderer as unknown as ConstructorParameters<typeof Pipe>[0]);
  const text = new pixi.BitmapText({ text: "0", style: { fontFamily: FAMILY, fontSize: 32 } });
  const instructions = {} as Parameters<typeof pipe.addRenderable>[1];
  const gpuData = text._gpuData as Record<
    number,
    { context: { customShader: unknown } } | undefined
  >;

  // As a render group collects it: added, then its view update taken.
  pipe.addRenderable(text, instructions);
  text.didViewUpdate = false;

  return {
    text,
    update: next => {
      text.text = next;
      pipe.addRenderable(text, instructions);
      text.didViewUpdate = false;
    },
    shader: () => gpuData[1]?.context.customShader,
    made: () => made,
    add: next => {
      const other = new pixi.BitmapText({
        text: next,
        style: { fontFamily: FAMILY, fontSize: 32 }
      });

      pipe.addRenderable(other, instructions);
      other.didViewUpdate = false;

      return other;
    }
  };
}
