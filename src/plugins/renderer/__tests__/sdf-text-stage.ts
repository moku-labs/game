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

/**
 * Builds the renderer's pipe on a renderer stub of one backend and a text on it, laid out once.
 *
 * @param backend - `"webgpu"` or `"webgl"`.
 * @returns The stage.
 */
export function sdfTextStage(backend: "webgpu" | "webgl" = "webgpu"): SdfTextStage {
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
    resolution: 1,
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
    made: () => made
  };
}
