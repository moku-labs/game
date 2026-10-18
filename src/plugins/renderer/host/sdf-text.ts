/**
 * @file renderer/host — the bitmap text pipe of distance-field (MSDF, SDF) text and the install of the three pieces
 * that draw it in a batch. Pixi 8.22 gives every distance-field label a shader of its own, which makes its graphics
 * context unbatchable: a draw per label. The renderer's pipe, a subclass of Pixi's, hands Pixi no shader
 * (`getSdfShader()` answers `null`), so the context stays batchable, forces it batchable at any length (Pixi's
 * `"auto"` gives up at 50 glyphs, and a context without a shader would then draw the glyph atlas as a plain texture),
 * and keeps the edge of the text's glyphs on its proxy graphics under `SDF`: Pixi's distance at scale 1, measured
 * again only when the font family or size changes. `host/sdf-batcher.ts` packs and draws them. `installSdfText` puts
 * the batcher, this pipe and the routing batch pipe into Pixi's extension registry before `app.init()`, under Pixi's
 * own names. No Pixi prototype and no Pixi instance is patched.
 */
import type { PixiModule } from "../types";
import { createSdfBatcher, createSdfBatcherPipe, SDF, type SdfGlyphs } from "./sdf-batcher";

/** Pixi's bitmap text pipe class, the base of the renderer's. */
type BitmapTextPipeClass = PixiModule["BitmapTextPipe"];

/** Pixi's bitmap text pipe, as the renderer's subclasses it. */
type BitmapTextPipe = InstanceType<BitmapTextPipeClass>;

/** A bitmap text, as Pixi's pipe draws it. */
type BitmapText = Parameters<BitmapTextPipe["addRenderable"]>[0];

/** The instructions Pixi's pipe adds a text to. */
type InstructionSet = Parameters<BitmapTextPipe["addRenderable"]>[1];

/** The graphics a text is drawn through, with the edge of its glyphs. */
type TextProxy = ReturnType<BitmapTextPipe["initGpuText"]> & { [SDF]: SdfGlyphs };

/** What the glyph edge reads of a text's style. */
type GlyphStyle = { readonly fontFamily: string | string[]; readonly fontSize: number };

/** What the glyph edge reads of a bitmap font in Pixi's cache. */
type DistanceFont = {
  readonly baseRenderedFontSize: number;
  readonly distanceField?: { readonly type: string; readonly range: number };
};

/** The suffix of a bitmap font's key in Pixi's cache, the one `_updateDistanceField` reads. */
const CACHE_SUFFIX = "-bitmap";

/**
 * Measures the edge of a text's glyphs again when its font family or size changed since: Pixi's distance at scale 1
 * from the font in Pixi's cache, 0 for a font without a distance field or not in the cache.
 *
 * @param pixi - The loaded Pixi module.
 * @param glyphs - The text's glyph record.
 * @param style - The text's style.
 */
function measureGlyphs(pixi: PixiModule, glyphs: SdfGlyphs, style: GlyphStyle): void {
  const family = style.fontFamily;
  const size = style.fontSize;

  // per text update: a family and size that did not change keep the number; a key is made only when they do.
  if (family === glyphs.family && size === glyphs.size) return;

  const key = `${String(family)}${CACHE_SUFFIX}`;
  // `has` first: Pixi's `get` warns about a key it does not hold.
  const font: DistanceFont | undefined = pixi.Cache.has(key) ? pixi.Cache.get(key) : undefined;
  const field = font?.distanceField;

  glyphs.family = family;
  glyphs.size = size;
  // Pixi's formula: the range over the font's scale (`baseRenderedFontSize / fontSize`).
  glyphs.perScale =
    font === undefined || field === undefined || field.type === "none"
      ? 0
      : field.range * (1 / (font.baseRenderedFontSize / size));
}

/**
 * Builds the renderer's bitmap text pipe from the module object, at call time, because Pixi's pipe arrives with the
 * lazily loaded module. It keeps the base's `static extension` object, so the registry files it under the same types
 * and name. Every text's proxy graphics gets a batchable context and its glyph record when Pixi makes it; the record is
 * brought up to date before Pixi adds or updates the text, so the batcher packs the edge of the text's font.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The pipe class.
 */
export function createSdfTextPipe(pixi: PixiModule): BitmapTextPipeClass {
  /** Pixi's bitmap text pipe, with distance-field text drawn by the renderer's batcher. */
  class SdfTextPipe extends pixi.BitmapTextPipe {
    public static override readonly extension = pixi.BitmapTextPipe.extension;

    /**
     * Makes a text's proxy graphics as Pixi does, batchable at any length, with the edge of its glyphs.
     *
     * @param text - The text.
     * @returns The proxy.
     */
    public override initGpuText(text: BitmapText): TextProxy {
      const proxy = super.initGpuText(text) as TextProxy;
      // One shape for every proxy: the record's fields are all there from the start, the number a double.
      const glyphs: SdfGlyphs = { perScale: Number.NaN, family: undefined, size: Number.NaN };

      proxy.context.batchMode = "batch";
      proxy[SDF] = glyphs;
      measureGlyphs(pixi, glyphs, text._style);

      return proxy;
    }

    /**
     * Adds a text to the instructions as Pixi does, its glyph edge measured first.
     *
     * @param text - The text.
     * @param instructionSet - The instructions of its render group.
     */
    public override addRenderable(text: BitmapText, instructionSet: InstructionSet): void {
      this.measure(text);
      super.addRenderable(text, instructionSet);
    }

    /**
     * Updates a text as Pixi does, its glyph edge measured first.
     *
     * @param text - The text.
     */
    public override updateRenderable(text: BitmapText): void {
      this.measure(text);
      super.updateRenderable(text);
    }

    /**
     * No shader: Pixi then leaves the text's context without one, and batchable.
     *
     * @returns `null`.
     */
    protected override getSdfShader(): null {
      // eslint-disable-next-line unicorn/no-null -- Pixi's abstract signature answers `SdfShader | null`.
      return null;
    }

    /**
     * Measures the glyph edge of a text Pixi made a proxy for already; a new text's proxy measures its own.
     *
     * @param text - The text.
     */
    private measure(text: BitmapText): void {
      const proxy = text._gpuData[this._renderer.uid] as TextProxy | undefined;

      if (proxy !== undefined) measureGlyphs(pixi, proxy[SDF], text._style);
    }
  }

  return SdfTextPipe;
}

/**
 * Installs the three pieces of batched distance-field text in the module's extension registry: the batcher under its
 * own name, and the bitmap text pipe and the batch pipe under Pixi's, on both backends. Every application made
 * afterwards draws distance-field text with them. Every class is built before the registry is touched, so a module
 * without the pieces throws with the registry as it was. The registry is global to the module object, so the remover
 * matters: it swaps Pixi's own pipes back and leaves the batcher, which a pooled element may still name. A counting batch pipe of the monitor, which extends the routing pipe, is
 * installed after this one, in its place.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The remover.
 * @throws {TypeError} When the module has no `Batcher`, `BitmapTextPipe` or `BatcherPipe` to subclass.
 */
export function installSdfText(pixi: PixiModule): () => void {
  const batcher = createSdfBatcher(pixi);
  const textPipe = createSdfTextPipe(pixi);
  const batchPipe = createSdfBatcherPipe(pixi);

  pixi.extensions.remove(pixi.BitmapTextPipe, pixi.BatcherPipe);
  pixi.extensions.add(batcher, textPipe, batchPipe);

  return (): void => {
    // The batcher stays registered: Pixi looks batchers up by name when an instruction set meets one, and pooled
    // elements keep the "moku-sdf" name, so another application on this module still finds it.
    pixi.extensions.remove(textPipe, batchPipe);
    pixi.extensions.add(pixi.BitmapTextPipe, pixi.BatcherPipe);
  };
}
