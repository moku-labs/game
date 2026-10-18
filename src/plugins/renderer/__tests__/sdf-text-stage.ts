/**
 * @file renderer — distance-field bitmap text on the renderer's pipes over the real pixi.js module, no GPU: a
 * distance-field font made from data, and a renderer stub with the members the pipes read. `sdfTextStage` lays one
 * text out through the renderer's text pipe alone (Pixi's graphics pipe stubbed); `sdfBatchStage` builds the chain a
 * render group runs: the renderer's text pipe, Pixi's own graphics pipe and context system, the renderer's routing
 * batch pipe and its SDF batcher, registered in Pixi's batcher registry until `remove()`. Not a test file: the unit
 * and the perf files of the SDF text share it.
 */
import * as pixi from "pixi.js";
import { vi } from "vitest";
import {
  createSdfBatcher,
  createSdfBatcherPipe,
  SDF,
  type SdfGlyphBatcher
} from "../host/sdf-batcher";
import { createSdfTextPipe } from "../host/sdf-text";
import type { PixiModule } from "../types";

/** The font family of the stages' distance-field font: range 4 at a base size of 32. */
export const SDF_FAMILY = "sdf-stage";

/** The font family of the stages' plain bitmap font, without a distance field. */
export const PLAIN_FAMILY = "sdf-stage-plain";

/** The module the pipes are built from: the real one. */
const module = pixi as unknown as PixiModule;

/** A bitmap text of a stage. */
export type StageText = InstanceType<typeof pixi.BitmapText>;

/** A bitmap text of the stage and what drawing it needs. */
export type SdfTextStage = {
  text: StageText;
  /** Lays the text out as Pixi does when its text changed, through the renderer's pipe, as a render group collects it. */
  update(next: string): void;
  /** The shader the text's graphics context draws with: none. */
  shader(): unknown;
  /** Shaders made so far. */
  made(): number;
};

/** One element a batcher draws: a glyph quad of a text, as Pixi's graphics pipe hands it over. */
export type StageElement = InstanceType<typeof pixi.BatchableGraphics>;

/** The renderer stub of the batch stage: its resolution is read through a getter, as Pixi's view answers it. */
export type StageRenderer = {
  readonly uid: number;
  resolution: number;
  view: { resolution: number };
};

/** The chain of a render group over the real Pixi, with the renderer's text and batch pipes. */
export type SdfBatchStage = {
  renderer: StageRenderer;
  textPipe: InstanceType<PixiModule["BitmapTextPipe"]>;
  batchPipe: InstanceType<PixiModule["BatcherPipe"]>;
  contexts: InstanceType<typeof pixi.GraphicsContextSystem>;
  /** A text of the stage's distance-field font, or of `family`. */
  label(text: string, options?: { size?: number; family?: string }): StageText;
  /**
   * A rebuild of one render group: `buildStart`, every text added through the text pipe, `buildEnd`; into the given
   * instruction set, emptied first, or a new one.
   */
  build(
    texts: readonly StageText[],
    into?: InstanceType<typeof pixi.InstructionSet>
  ): InstanceType<typeof pixi.InstructionSet>;
  /** The batch instructions of a build. */
  batches(set: InstanceType<typeof pixi.InstructionSet>): Array<InstanceType<typeof pixi.Batch>>;
  /** The glyph elements of a text, as its graphics hands them to a batcher. */
  elements(text: StageText): StageElement[];
  /** The SDF batcher of a build's first SDF batch. */
  sdfBatcher(set: InstanceType<typeof pixi.InstructionSet>): SdfGlyphBatcher;
  /** Every batch drawn, as a frame executes them. */
  draw(set: InstanceType<typeof pixi.InstructionSet>): void;
  /** Takes the batcher out of Pixi's registry. */
  remove(): void;
};

/**
 * The glyphs of a font: the ten digits and the ten first lower-case letters, on Pixi's white texture.
 *
 * @returns The glyph table Pixi's font data takes.
 */
function glyphTable(): Record<string, object> {
  const chars: Record<string, object> = {};

  for (const char of "0123456789abcdefghij") {
    chars[char] = {
      id: char.codePointAt(0),
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

  return chars;
}

/**
 * Installs a font of the stages once, under the key Pixi's text pipe reads.
 *
 * @param family - The family.
 * @param type - Its distance field: `"msdf"` with a range of 4, or `"none"`.
 */
function installFont(family: string, type: "msdf" | "none"): void {
  if (pixi.Cache.has(`${family}-bitmap`)) return;

  const font = new pixi.BitmapFont({
    data: {
      pages: [{ id: 0, file: "" }],
      chars: glyphTable(),
      fontSize: 32,
      lineHeight: 36,
      baseLineOffset: 26,
      fontFamily: family,
      distanceField: { type, range: type === "none" ? 0 : 4 }
    },
    textures: [pixi.Texture.WHITE]
  } as unknown as ConstructorParameters<typeof pixi.BitmapFont>[0]);

  pixi.Cache.set(`${family}-bitmap`, font);
}

/**
 * Gives Pixi's GLSL compile a document: a `GlProgram` asks a canvas for the highest fragment precision, and a canvas
 * without WebGL answers `mediump`. A test unstubs it.
 */
export function stubCanvasDocument(): void {
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => undefined }) });
}

/**
 * Builds the renderer's text pipe on a renderer stub of one backend and a text on it, laid out once.
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

  installFont(SDF_FAMILY, "msdf");

  const Pipe = createSdfTextPipe({ ...module, Shader: CountedShader } as unknown as PixiModule);
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
  const text = new pixi.BitmapText({ text: "0", style: { fontFamily: SDF_FAMILY, fontSize: 32 } });
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

/** The batch adaptor of the stage: Pixi's calls, which draw nothing without a GPU. */
const adaptor = { start: (): void => undefined, execute: (): void => undefined };

/**
 * Builds the chain of a render group over the real Pixi: the renderer's text pipe, Pixi's graphics pipe and context
 * system, the renderer's routing batch pipe, and the SDF batcher in Pixi's registry. Stubs the canvas document for
 * Pixi's GLSL compile: a test unstubs it.
 *
 * @param resolution - The renderer's resolution.
 * @returns The stage.
 */
export function sdfBatchStage(resolution = 1): SdfBatchStage {
  installFont(SDF_FAMILY, "msdf");
  installFont(PLAIN_FAMILY, "none");
  stubCanvasDocument();

  const view = { resolution };
  const renderer = {
    name: "webgpu",
    uid: 1,
    _roundPixels: 0,
    view,
    get resolution(): number {
      return view.resolution;
    },
    set resolution(value: number) {
      view.resolution = value;
    },
    limits: { maxBatchableTextures: 16 },
    gc: { addResourceHash: (): void => undefined, now: 0 },
    runners: { contextChange: { add: (): void => undefined } },
    renderPipes: {} as Record<string, unknown>,
    graphicsContext: undefined as unknown
  };
  const asRenderer = renderer as unknown as ConstructorParameters<typeof pixi.GraphicsPipe>[0];
  const contexts = new pixi.GraphicsContextSystem(asRenderer);
  const graphics = new pixi.GraphicsPipe(
    asRenderer,
    adaptor as unknown as ConstructorParameters<typeof pixi.GraphicsPipe>[1]
  );
  const Batcher = createSdfBatcher(module);
  const BatchPipe = createSdfBatcherPipe(module);
  const TextPipe = createSdfTextPipe(module);
  const batchPipe = new BatchPipe(asRenderer, adaptor);
  const textPipe = new TextPipe(asRenderer);

  pixi.extensions.add(Batcher);
  renderer.graphicsContext = contexts;
  renderer.renderPipes = { graphics, batch: batchPipe, bitmapText: textPipe };

  return {
    renderer,
    textPipe,
    batchPipe,
    contexts,
    label: (text, options = {}) =>
      new pixi.BitmapText({
        text,
        style: { fontFamily: options.family ?? SDF_FAMILY, fontSize: options.size ?? 32 }
      }),
    build: (texts, into) => {
      const set = into ?? new pixi.InstructionSet();

      set.reset();
      batchPipe.buildStart(set);
      for (const text of texts) textPipe.addRenderable(text, set);
      batchPipe.buildEnd(set);

      return set;
    },
    batches: set =>
      set.instructions
        .slice(0, set.instructionSize)
        .filter(
          (instruction): instruction is InstanceType<typeof pixi.Batch> =>
            instruction.renderPipeId === "batch"
        ),
    elements: text => {
      const proxy = (text._gpuData as Record<number, InstanceType<typeof pixi.Graphics>>)[1];
      const data = proxy?._gpuData[1] as { batches: StageElement[] } | undefined;

      return data?.batches ?? [];
    },
    sdfBatcher: set => {
      const batch = set.instructions
        .slice(0, set.instructionSize)
        .find(
          (instruction): instruction is InstanceType<typeof pixi.Batch> =>
            instruction.renderPipeId === "batch" &&
            (instruction as InstanceType<typeof pixi.Batch>).batcher.name === "moku-sdf"
        );

      if (batch === undefined) throw new Error("sdf stage: the build has no SDF batch");

      return batch.batcher as SdfGlyphBatcher;
    },
    draw: set => {
      for (let index = 0; index < set.instructionSize; index += 1) {
        const instruction = set.instructions[index];

        if (instruction?.renderPipeId === "batch") {
          batchPipe.execute(instruction as InstanceType<typeof pixi.Batch>);
        }
      }
    },
    remove: () => {
      pixi.extensions.remove(Batcher);
    }
  };
}

/**
 * The glyph record a text's proxy carries under `SDF`.
 *
 * @param text - A text the renderer's pipe laid out.
 * @returns The record, or `undefined` before the pipe made the proxy.
 */
export function glyphsOf(text: StageText): { perScale: number } | undefined {
  const proxy = (text._gpuData as Record<number, { [SDF]?: { perScale: number } }>)[1];

  return proxy?.[SDF];
}
