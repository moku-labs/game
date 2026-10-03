/* eslint-disable unicorn/prefer-dom-node-remove, unicorn/no-null, sonarjs/public-static-readonly -- a Pixi container is not a DOM node, its `parent` is null, and the settings of the fake change per test */
/**
 * @file renderer plugin — the fake Pixi module the tests inject through `config.loadPixi`. Not a
 * test file: the projects only collect `*.test.ts`. It records what the renderer created,
 * destroyed and wrote, so a plain Bun test can assert the whole display tree.
 */
import type { PixiModule } from "../types";
import { createFakeElement, type FakeElement } from "./fake-dom";

/** The source behind a fake texture. `resolution` is 1 when left out, as Pixi's default. */
export type FakeSource = { width: number; height: number; destroyed: boolean; resolution?: number };

/** A fake Pixi rectangle: what a texture frame is made of. */
export class FakeRectangle {
  public x: number;
  public y: number;
  public width: number;
  public height: number;

  public constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
}

/** A fake Pixi texture. */
export class FakeTexture {
  /** Every texture the fake ever made, in creation order. */
  public static readonly made: FakeTexture[] = [];

  /** The 1x1 white texture the placeholder is drawn with. */
  public static readonly WHITE = new FakeTexture({
    source: { width: 1, height: 1, destroyed: false }
  });

  public source: FakeSource;
  public defaultBorders: { left: number; top: number; right: number; bottom: number } | undefined;
  /** The part of the source the texture shows. The whole source when no frame was given. */
  public frame: FakeRectangle;
  public destroyed = false;
  public destroyCalls = 0;
  /** What the last `destroy` was asked to do with the source. */
  public destroyedSource: boolean | undefined;
  private readonly framed: boolean;

  public constructor(options: {
    source?: FakeSource;
    frame?: FakeRectangle;
    defaultBorders?: { left: number; top: number; right: number; bottom: number };
  }) {
    this.source = options.source ?? { width: 64, height: 64, destroyed: false };
    this.defaultBorders = options.defaultBorders;
    this.framed = options.frame !== undefined;
    this.frame = options.frame ?? new FakeRectangle(0, 0, this.source.width, this.source.height);
    FakeTexture.made?.push(this);
  }

  /**
   * Makes a texture from a decoded image.
   *
   * @param image - Anything with a width and a height.
   * @param image.width - Pixel width.
   * @param image.height - Pixel height.
   * @returns A new texture over that image.
   */
  public static from(image: { width?: number; height?: number }): FakeTexture {
    return new FakeTexture({
      source: { width: image.width ?? 64, height: image.height ?? 64, destroyed: false }
    });
  }

  /** Width of the texture: its frame when it has one, else its source. */
  public get width(): number {
    return this.framed ? this.frame.width : this.source.width;
  }

  /** Height of the texture: its frame when it has one, else its source. */
  public get height(): number {
    return this.framed ? this.frame.height : this.source.height;
  }

  /**
   * Frees the texture, and its source when asked.
   *
   * @param destroySource - True to free the source too.
   */
  public destroy(destroySource?: boolean): void {
    this.destroyCalls += 1;
    this.destroyed = true;
    this.destroyedSource = destroySource === true;
    if (destroySource === true) this.source.destroyed = true;
  }
}

/** A point with the `set` of Pixi's observable point. */
export class FakePoint {
  public x: number;
  public y: number;

  public constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  /**
   * Writes both coordinates. One argument writes both, as Pixi does.
   *
   * @param x - New x.
   * @param y - New y; defaults to x.
   */
  public set(x: number, y = x): void {
    this.x = x;
    this.y = y;
  }
}

/**
 * A fake Pixi filter: the resources `effects` writes its uniforms into, the switch Pixi skips a
 * disabled filter by, and its destroy.
 */
export class FakeFilter {
  /** What the filter was built with. */
  public options: Record<string, unknown>;
  public resources: Record<string, unknown>;
  /** A disabled filter costs no pass, as Pixi's `enabled` does. */
  public enabled = true;
  public padding: number;
  public destroyed = false;

  public constructor(options: Record<string, unknown> = {}) {
    this.options = options;
    this.resources = (options.resources as Record<string, unknown> | undefined) ?? {};
    this.padding = typeof options.padding === "number" ? options.padding : 0;
  }

  /**
   * Builds a filter from its options, as Pixi's `Filter.from` does.
   *
   * @param options - The filter options.
   * @returns A new filter.
   */
  public static from(options: Record<string, unknown>): FakeFilter {
    return new FakeFilter(options);
  }

  /** Frees the filter. */
  public destroy(): void {
    this.destroyed = true;
  }
}

/** The fake of Pixi's `BlurFilter`. */
export class FakeBlurFilter extends FakeFilter {
  public readonly kind = "blur";
}

/** The fake of Pixi's `ColorMatrixFilter`. */
export class FakeColorMatrixFilter extends FakeFilter {
  public readonly kind = "colorMatrix";
}

/** The fake of Pixi's `NoiseFilter`. */
export class FakeNoiseFilter extends FakeFilter {
  public readonly kind = "noise";
}

/** The fake of Pixi's `DisplacementFilter`. */
export class FakeDisplacementFilter extends FakeFilter {
  public readonly kind = "displacement";
}

/** The fake of Pixi's `AlphaFilter`. */
export class FakeAlphaFilter extends FakeFilter {
  public readonly kind = "alpha";
}

/** The fake of Pixi's `GpuProgram`: it keeps the sources it was built from. */
export class FakeGpuProgram {
  public options: Record<string, unknown>;

  public constructor(options: Record<string, unknown>) {
    this.options = options;
  }

  /**
   * Builds a program, as Pixi's `GpuProgram.from` does.
   *
   * @param options - Name, vertex and fragment sources.
   * @returns A new program.
   */
  public static from(options: Record<string, unknown>): FakeGpuProgram {
    return new FakeGpuProgram(options);
  }
}

/** The fake of Pixi's `UniformGroup`: the values and the GPU buffer behind them. */
export class FakeUniformGroup {
  public uniforms: Record<string, unknown>;
  public isStatic = false;
  public buffer = {
    destroyed: false,
    destroy(): void {
      this.destroyed = true;
    }
  };

  public constructor(structures: Record<string, { value: unknown }>) {
    this.uniforms = Object.fromEntries(
      Object.entries(structures).map(([name, structure]) => [name, structure.value])
    );
  }
}

/** A fake Pixi container: the tree, the transform and the flags `sync` writes. */
export class FakeContainer {
  public label = "";
  public zIndex = 0;
  public sortableChildren = false;
  public visible = true;
  public alpha = 1;
  public rotation = 0;
  public destroyed = false;
  public position = new FakePoint();
  public scale = new FakePoint(1, 1);
  /** The local point that lands on `position`, as Pixi's `pivot` is. */
  public pivot = new FakePoint();
  public children: FakeContainer[] = [];
  public parent: FakeContainer | null = null;
  /** What clips this container's children, as Pixi's `mask` does. */
  public mask: FakeContainer | null = null;
  /** How often `zIndex` was written with a different number. */
  public zIndexWrites = 0;
  /** How often `filters` was assigned: Pixi copies the list and may rebuild the render group. */
  public filterWrites = 0;
  private heldFilters: readonly FakeFilter[] | null | undefined = undefined;

  /**
   * The filters drawn on this container and its children: `undefined` before the first write,
   * `null` after a clear, else a frozen copy, as Pixi keeps it.
   *
   * @returns The filters.
   */
  public get filters(): readonly FakeFilter[] | null | undefined {
    return this.heldFilters;
  }

  public set filters(value: FakeFilter | FakeFilter[] | null | undefined) {
    this.filterWrites += 1;

    if (value === null || value === undefined) {
      this.heldFilters = null;

      return;
    }

    this.heldFilters = Object.freeze(Array.isArray(value) ? [...value] : [value]);
  }

  /**
   * Appends a child.
   *
   * @param child - The child.
   * @returns The same child.
   */
  public addChild(child: FakeContainer): FakeContainer {
    child.parent?.removeChild(child);
    this.children.push(child);
    child.parent = this;

    return child;
  }

  /**
   * Inserts a child at an index.
   *
   * @param child - The child.
   * @param index - Where it goes.
   * @returns The same child.
   */
  public addChildAt(child: FakeContainer, index: number): FakeContainer {
    child.parent?.removeChild(child);
    this.children.splice(index, 0, child);
    child.parent = this;

    return child;
  }

  /**
   * Detaches a child.
   *
   * @param child - The child.
   */
  public removeChild(child: FakeContainer): void {
    const at = this.children.indexOf(child);

    if (at !== -1) this.children.splice(at, 1);
    child.parent = null;
  }

  /**
   * Takes every child out, as Pixi's does when `text` redraws a label.
   *
   * @returns The children that were in it, in order.
   */
  public removeChildren(): FakeContainer[] {
    const children = this.children.splice(0);

    for (const child of children) child.parent = null;

    return children;
  }

  /**
   * The local bounds, as a `Display` object reports them.
   *
   * @returns A 100x100 box around the origin.
   */
  public getLocalBounds(): { x: number; y: number; width: number; height: number } {
    return { x: -50, y: -50, width: 100, height: 100 };
  }

  /**
   * Frees the object and, when asked, its children.
   *
   * @param options - Pixi's destroy options.
   * @param options.children - True to free the children too.
   * @param options.texture - True to free the texture too.
   */
  public destroy(options?: { children?: boolean; texture?: boolean }): void {
    this.destroyed = true;
    this.parent?.removeChild(this);
    if (options?.children !== true) return;

    // As Pixi does: take the children out first, then free them, so none is skipped.
    for (const child of this.children.splice(0)) {
      child.parent = null;
      child.destroy(options);
    }
  }
}

/** One particle of a fake particle container. */
export class FakeParticle {
  public texture: FakeTexture;
  public x = 0;
  public y = 0;

  public constructor(options: FakeTexture | { texture: FakeTexture }) {
    this.texture = options instanceof FakeTexture ? options : options.texture;
  }
}

/**
 * A fake Pixi particle container. As Pixi's: `addChild` throws, because particles are not
 * children, and the local bounds are the empty rectangle, because it measures no particle.
 */
export class FakeParticleContainer extends FakeContainer {
  public particleChildren: FakeParticle[] = [];

  /**
   * Refuses a child, as Pixi 8.21 does.
   *
   * @throws {Error} Always: particles are not children.
   */
  public override addChild(): FakeContainer {
    throw new Error(
      "ParticleContainer.addChild() is not available. Please use ParticleContainer.addParticle()"
    );
  }

  /**
   * The local bounds of a container that measures nothing: Pixi answers the zero rectangle.
   *
   * @returns The empty box at the origin.
   */
  public override getLocalBounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

/** What a fake bitmap text was built with: the text and Pixi's style options. */
export type FakeBitmapTextOptions = { text?: unknown; style?: Record<string, unknown> };

/** The fake of Pixi's `BitmapText`: one glyph run `text` builds, with the fields it writes. */
export class FakeBitmapText extends FakeContainer {
  public text: unknown;
  public style: Record<string, unknown>;
  public skew = new FakePoint();
  public tint = 0xff_ff_ff;
  public width = 0;
  public height = 0;

  public constructor(options: FakeBitmapTextOptions = {}) {
    super();
    this.text = options.text;
    this.style = options.style ?? {};
  }
}

/** A fake Pixi sprite. */
export class FakeSprite extends FakeContainer {
  public texture: FakeTexture;
  public tint = 0xff_ff_ff;
  public anchor = new FakePoint(0.5, 0.5);

  public constructor(texture: FakeTexture = FakeTexture.WHITE) {
    super();
    this.texture = texture;
  }
}

/**
 * A fake Pixi nine-slice sprite. The four slice widths hold a number only once the renderer wrote
 * one: no silent default, so a renderer that never copies the texture's borders fails its test.
 */
export class FakeNineSliceSprite extends FakeContainer {
  public texture: FakeTexture;
  public width = 0;
  public height = 0;
  public tint = 0xff_ff_ff;
  public leftWidth: number | undefined = undefined;
  public topHeight: number | undefined = undefined;
  public rightWidth: number | undefined = undefined;
  public bottomHeight: number | undefined = undefined;

  public constructor(options: { texture: FakeTexture }) {
    super();
    this.texture = options.texture;
  }
}

/** One path the fake graphics was asked to draw. A `moveTo` or `lineTo` has no size. */
export type FakeDrawOp = {
  op: "rect" | "roundRect" | "moveTo" | "lineTo" | "closePath" | "beginPath";
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};

/** A fill or a stroke style the fake graphics recorded. */
export type FakePaint = { color: number; alpha?: number; width?: number; pixelLine?: boolean };

/** A fake Pixi graphics: it records what was drawn and how often it was cleared. */
export class FakeGraphics extends FakeContainer {
  public tint = 0xff_ff_ff;
  /** How often the object was cleared, which is how often the renderer redrew it. */
  public clears = 0;
  public ops: FakeDrawOp[] = [];
  public fills: FakePaint[] = [];
  public strokes: FakePaint[] = [];

  /**
   * Drops every path, as a redraw does.
   *
   * @returns The same object, as Pixi's chainable API does.
   */
  public clear(): this {
    this.clears += 1;
    this.ops = [];
    this.fills = [];
    this.strokes = [];

    return this;
  }

  /**
   * Records a rectangle.
   *
   * @param x - Left edge.
   * @param y - Top edge.
   * @param width - Width of the rectangle.
   * @param height - Height of the rectangle.
   * @returns The same object.
   */
  public rect(x: number, y: number, width: number, height: number): this {
    this.ops.push({ op: "rect", x, y, width, height, radius: 0 });

    return this;
  }

  /**
   * Records a rounded rectangle.
   *
   * @param x - Left edge.
   * @param y - Top edge.
   * @param width - Width of the rectangle.
   * @param height - Height of the rectangle.
   * @param radius - Corner radius.
   * @returns The same object.
   */
  public roundRect(x: number, y: number, width: number, height: number, radius: number): this {
    this.ops.push({ op: "roundRect", x, y, width, height, radius });

    return this;
  }

  /**
   * Records the start of a new line.
   *
   * @param x - Where the line starts, x.
   * @param y - Where the line starts, y.
   * @returns The same object.
   */
  public moveTo(x: number, y: number): this {
    this.ops.push({ op: "moveTo", x, y, width: 0, height: 0, radius: 0 });

    return this;
  }

  /**
   * Records a line to a point.
   *
   * @param x - Where the line ends, x.
   * @param y - Where the line ends, y.
   * @returns The same object.
   */
  public lineTo(x: number, y: number): this {
    this.ops.push({ op: "lineTo", x, y, width: 0, height: 0, radius: 0 });

    return this;
  }

  /**
   * Records the close of the current line back to where it started.
   *
   * @returns The same object.
   */
  public closePath(): this {
    this.ops.push({ op: "closePath", x: 0, y: 0, width: 0, height: 0, radius: 0 });

    return this;
  }

  /**
   * Records the start of a new path: what a fill or a stroke after it paints.
   *
   * @returns The same object.
   */
  public beginPath(): this {
    this.ops.push({ op: "beginPath", x: 0, y: 0, width: 0, height: 0, radius: 0 });

    return this;
  }

  /**
   * Records a fill of the last path.
   *
   * @param style - Colour of the fill.
   * @returns The same object.
   */
  public fill(style: FakePaint): this {
    this.fills.push(style);

    return this;
  }

  /**
   * Records a stroke of the last path.
   *
   * @param style - Colour and width of the stroke.
   * @returns The same object.
   */
  public stroke(style: FakePaint): this {
    this.strokes.push(style);

    return this;
  }
}

/** What a fake bitmap font was built from. The three metrics are read as Pixi reads them. */
export type FakeFontData = {
  chars: Record<string, unknown>;
  pages: unknown[];
  fontFamily?: string;
  lineHeight?: number;
  baseLineOffset?: number;
  fontSize?: number;
};

/** A fake Pixi bitmap font. */
export class FakeBitmapFont {
  /** Every font the fake module ever built, in creation order. */
  public static readonly made: FakeBitmapFont[] = [];

  public data: FakeFontData;
  public textures: FakeTexture[];
  public destroyed = false;
  /** Where Pixi starts the first line: `lineHeight - base` of the file. */
  public baseLineOffset: number;
  public lineHeight: number;
  /** Pixi centres a line by `(lineHeight - fontMetrics.fontSize) / 2`. */
  public fontMetrics: { ascent: number; descent: number; fontSize: number };

  public constructor(options: { data: FakeFontData; textures: FakeTexture[] }) {
    this.data = options.data;
    this.textures = options.textures;
    this.baseLineOffset = options.data.baseLineOffset ?? 0;
    this.lineHeight = options.data.lineHeight ?? 0;
    this.fontMetrics = { ascent: 0, descent: 0, fontSize: options.data.fontSize ?? 0 };
    FakeBitmapFont.made?.push(this);
  }

  /** Frees the font. */
  public destroy(): void {
    this.destroyed = true;
  }
}

/** The fake of Pixi's global asset cache, where a bitmap font is registered under its name. */
export const fakeCache = {
  /** Everything the renderer put into the cache. */
  entries: new Map<string, unknown>(),

  /**
   * Tells whether a key is cached.
   *
   * @param key - The cache key.
   * @returns True when something is stored under it.
   */
  has(key: string): boolean {
    return fakeCache.entries.has(key);
  },

  /**
   * Stores a value.
   *
   * @param key - The cache key.
   * @param value - What to store.
   */
  set(key: string, value: unknown): void {
    fakeCache.entries.set(key, value);
  },

  /**
   * Drops a key.
   *
   * @param key - The cache key.
   */
  remove(key: string): void {
    fakeCache.entries.delete(key);
  }
};

/** The fake of Pixi's BMFont text parser: it reads the `info face=...` format. */
export const fakeTextParser = {
  /**
   * Tells whether the string is in the BMFont text format.
   *
   * @param data - The file contents.
   * @returns True for a file that starts with an `info` block.
   */
  test(data: string): boolean {
    return typeof data === "string" && data.startsWith("info ");
  },

  /**
   * Reads the font data out of a BMFont text file.
   *
   * @param text - The file contents.
   * @returns The font data, with the face as its family.
   */
  parse(text: string): FakeFontData {
    return {
      chars: { text: true },
      pages: ["page.png"],
      fontFamily: (text.split("\n")[0] ?? "").slice(5)
    };
  }
};

/** The fake of Pixi's BMFont XML parser. */
export const fakeXmlParser = {
  /**
   * Tells whether the string is BMFont XML.
   *
   * @param data - The file contents.
   * @returns True for a file that starts with a tag.
   */
  test(data: string): boolean {
    return typeof data === "string" && data.startsWith("<");
  },

  /**
   * Reads the font data out of a BMFont XML file.
   *
   * @param xml - The file contents.
   * @returns The font data, with the tag count as its page list.
   */
  parse(xml: string): FakeFontData {
    return { chars: { xml: true }, pages: ["page.png"], fontFamily: xml.slice(0, 6) };
  }
};

/** A texture source the fake GPU holds, with the fields the memory estimate reads. */
export type FakeManagedSource = { pixelWidth: number; pixelHeight: number; mipLevelCount: number };

/** The PNG data URL the fake extract answers: the base64 of the PNG signature. */
export const FAKE_PNG = "data:image/png;base64,iVBORw0KGgo=";

/** Pixi's `ExtensionType.WebGPUPipesAdaptor`: the batch and graphics adaptors register here. */
export const WEBGPU_PIPES_ADAPTOR = "webgpu-pipes-adaptor";

/** Pixi's `ExtensionType.WebGPUSystem`: the encoder system registers here. */
export const WEBGPU_SYSTEM = "webgpu-system";

/** The graphics context of a fake graphics object: how many batches its instructions hold. */
export type FakeGraphicsContext = { instructionSize: number };

/**
 * What the fake draw classes draw on: the native draw count, and the graphics context system the
 * graphics adaptor reads its instructions from, as Pixi's `renderer.graphicsContext`.
 */
export type FakeDrawTarget = {
  /** Native draws issued so far: one per `drawIndexed`, `draw` or indirect draw. */
  drawn: number;
  graphicsContext: {
    getContextRenderData(context: FakeGraphicsContext): {
      instructions: { instructionSize: number };
    };
  };
};

/**
 * Creates a draw target with no draw yet.
 *
 * @returns The target the fake draw classes count on.
 */
export function createDrawTarget(): FakeDrawTarget {
  return {
    drawn: 0,
    graphicsContext: {
      getContextRenderData: context => ({
        instructions: { instructionSize: context.instructionSize }
      })
    }
  };
}

/** The fake of Pixi's `GpuBatchAdaptor`: one native draw per batch. */
export class FakeGpuBatchAdaptor {
  public static extension = { type: [WEBGPU_PIPES_ADAPTOR], name: "batch" };

  /**
   * Draws one batch.
   *
   * @param batchPipe - The batcher pipe; its renderer takes the draw.
   * @param batchPipe.renderer - The renderer drawn on.
   * @param _batch - The batch.
   */
  public execute(batchPipe: { renderer: FakeDrawTarget }, _batch: unknown): void {
    batchPipe.renderer.drawn += 1;
  }
}

/** The fake of Pixi's `GpuGraphicsAdaptor`: one native draw per instruction of the context. */
export class FakeGpuGraphicsAdaptor {
  public static extension = { type: [WEBGPU_PIPES_ADAPTOR], name: "graphics" };

  /**
   * Draws one graphics object.
   *
   * @param graphicsPipe - The graphics pipe; its renderer takes the draws.
   * @param graphicsPipe.renderer - The renderer drawn on.
   * @param renderable - The graphics object.
   * @param renderable.context - Its graphics context.
   */
  public execute(
    graphicsPipe: { renderer: FakeDrawTarget },
    renderable: { context: FakeGraphicsContext }
  ): void {
    const renderer = graphicsPipe.renderer;

    renderer.drawn += renderer.graphicsContext.getContextRenderData(
      renderable.context
    ).instructions.instructionSize;
  }
}

/** The fake of Pixi's `GpuEncoderSystem`: one native draw per `draw` and per `drawIndirect`. */
export class FakeGpuEncoderSystem {
  public static extension = { type: [WEBGPU_SYSTEM], name: "encoder", priority: 1 };

  public renderer: FakeDrawTarget;

  public constructor(renderer: FakeDrawTarget) {
    this.renderer = renderer;
  }

  /**
   * Draws a mesh, a tiling sprite, particles or a filter quad.
   *
   * @param _options - The draw options.
   */
  public draw(_options: unknown): void {
    this.renderer.drawn += 1;
  }

  /**
   * Draws with parameters read from a GPU buffer.
   *
   * @param _options - The draw options.
   */
  public drawIndirect(_options: unknown): void {
    this.renderer.drawn += 1;
  }
}

/** A class Pixi's extension registry takes: it carries its `extension` metadata. */
export type FakeExtensionClass = { extension: { type: readonly string[]; name: string } };

/** The fake extension registry: the named lists and the calls Pixi's `extensions` answers. */
export type FakeExtensions = {
  lists: Map<string, Array<{ name: string; ref: FakeExtensionClass }>>;
  add(...classes: FakeExtensionClass[]): FakeExtensions;
  remove(...classes: FakeExtensionClass[]): FakeExtensions;
  named(type: string, name: string): FakeExtensionClass | undefined;
  reset(): void;
};

/**
 * The fake of Pixi's global extension registry, with the named lists `WebGPURenderer` reads its
 * adaptors and systems from: `add` keeps the first class of a name, `remove` frees the name.
 */
export const fakeExtensions: FakeExtensions = {
  /** The named list of every extension type. */
  lists: new Map<string, Array<{ name: string; ref: FakeExtensionClass }>>(),

  /**
   * Registers classes under their names; a name that is taken keeps its class, as in Pixi.
   *
   * @param classes - The classes to register.
   * @returns The registry.
   */
  add(...classes: FakeExtensionClass[]): FakeExtensions {
    for (const ref of classes) {
      for (const type of ref.extension.type) {
        const list = fakeExtensions.lists.get(type) ?? [];

        if (!list.some(entry => entry.name === ref.extension.name)) {
          list.push({ name: ref.extension.name, ref });
        }

        fakeExtensions.lists.set(type, list);
      }
    }

    return fakeExtensions;
  },

  /**
   * Frees the names of these classes, whichever class holds them now, as in Pixi.
   *
   * @param classes - The classes whose names go.
   * @returns The registry.
   */
  remove(...classes: FakeExtensionClass[]): FakeExtensions {
    for (const ref of classes) {
      for (const type of ref.extension.type) {
        const list = fakeExtensions.lists.get(type) ?? [];
        const at = list.findIndex(entry => entry.name === ref.extension.name);

        if (at !== -1) list.splice(at, 1);
      }
    }

    return fakeExtensions;
  },

  /**
   * The class registered under a name.
   *
   * @param type - The extension type.
   * @param name - The name.
   * @returns The class, or `undefined` when the name is free.
   */
  named(type: string, name: string): FakeExtensionClass | undefined {
    return fakeExtensions.lists.get(type)?.find(entry => entry.name === name)?.ref;
  },

  /** Empties the registry and registers Pixi's own three draw classes, as importing Pixi does. */
  reset(): void {
    fakeExtensions.lists.clear();
    fakeExtensions.add(FakeGpuBatchAdaptor, FakeGpuGraphicsAdaptor, FakeGpuEncoderSystem);
  }
};

fakeExtensions.reset();

/**
 * What one fake frame draws under WebGPU, through the classes registered at init: `batches`
 * batch executes, one graphics execute per entry of `graphics` with that many instructions,
 * `draws` encoder draws and `indirect` indirect draws.
 */
export type FakeScene = { batches: number; graphics: number[]; draws: number; indirect: number };

/** The three draw classes an application found in the registry at `init`, as Pixi does. */
export type FakeDrawClasses = {
  batch: typeof FakeGpuBatchAdaptor;
  graphics: typeof FakeGpuGraphicsAdaptor;
  encoder: typeof FakeGpuEncoderSystem;
};

/** The compilation messages of a fake shader module: always none. */
export type FakeCompilationInfo = { messages: unknown[] };

/** The shader module the fake device compiles: it reports no message. */
export type FakeShaderModule = { getCompilationInfo(): Promise<FakeCompilationInfo> };

/** The fake WebGPU device: its `lost` promise and the WGSL compile `effects` checks in dev. */
export type FakeGpuDevice = {
  lost: Promise<{ reason: string }>;
  createShaderModule(descriptor: { code: string }): FakeShaderModule;
};

/**
 * Compiles a WGSL source the fake way: every source compiles with no message.
 *
 * @param _descriptor - The source, as Pixi hands it to the device.
 * @param _descriptor.code - The WGSL code.
 * @returns A module whose compilation info has no message.
 */
function compileShader(_descriptor: { code: string }): FakeShaderModule {
  return { getCompilationInfo: () => Promise.resolve({ messages: [] }) };
}

/** What the fake renderer recorded. */
export type FakeRenderer = FakeDrawTarget & {
  name: "webgpu" | "webgl";
  renders: number;
  /** Native draws of the last `render`. */
  frameDraws: number;
  resizes: Array<{ width: number; height: number }>;
  gpu?: { device: FakeGpuDevice };
  /** The GPU texture sources, as Pixi's `renderer.texture.managedTextures`. */
  texture: { managedTextures: FakeManagedSource[] };
  /** Pixi's extract system: `base64` records its options and answers `FAKE_PNG`. */
  extract: { calls: unknown[]; base64(options: unknown): Promise<string> };
  render(stage: FakeContainer): void;
  resize(width: number, height: number): void;
};

/**
 * Draws one fake frame through the instances a WebGPU application made at init.
 *
 * @param renderer - The renderer drawn on.
 * @param classes - The draw classes found at init.
 * @param scene - What the frame draws.
 */
function drawScene(renderer: FakeRenderer, classes: FakeDrawClasses, scene: FakeScene): void {
  const pipe = { renderer };
  const batch = new classes.batch();
  const graphics = new classes.graphics();
  const encoder = new classes.encoder(renderer);

  for (let index = 0; index < scene.batches; index += 1) batch.execute(pipe, {});
  for (const instructionSize of scene.graphics) {
    graphics.execute(pipe, { context: { instructionSize } });
  }
  for (let index = 0; index < scene.draws; index += 1) encoder.draw({});
  for (let index = 0; index < scene.indirect; index += 1) encoder.drawIndirect({});
}

/** What `createFakePixi` sets for every application, because a Pixi class takes no options. */
export type FakeSettings = { kind: "webgpu" | "webgl"; failInit: boolean; scene: FakeScene };

/**
 * A scene that draws nothing.
 *
 * @returns The empty scene.
 */
function emptyScene(): FakeScene {
  return { batches: 0, graphics: [], draws: 0, indirect: 0 };
}

/** A fake Pixi application. */
export class FakeApplication {
  /** Set by `createFakePixi`, because a Pixi class takes no constructor options. */
  public static settings: FakeSettings = { kind: "webgpu", failInit: false, scene: emptyScene() };
  /** Every application ever created by the current fake module. */
  public static instances: FakeApplication[] = [];

  public stage = new FakeContainer();
  /** The CSS-pixel rectangle of the canvas, as Pixi's `app.screen`. */
  public screen = new FakeRectangle(0, 0, 1080, 1920);
  public canvas: FakeElement = createFakeElement("canvas");
  public renderer!: FakeRenderer;
  public initOptions: Record<string, unknown> | undefined;
  /** The draw classes a WebGPU application took from the registry at init; none on WebGL. */
  public drawClasses: FakeDrawClasses | undefined;
  public destroyed = false;
  public destroyArgs: unknown[] = [];
  private loseDevice: ((info: { reason: string }) => void) | undefined;
  private failDevice: ((error: Error) => void) | undefined;

  public constructor() {
    FakeApplication.instances.push(this);
  }

  /**
   * Creates the renderer, or rejects when the fake was told to fail. A WebGPU renderer takes its
   * draw classes from the extension registry by name, as Pixi's `WebGPURenderer` does.
   *
   * @param options - What the renderer asked Pixi for.
   * @returns Resolves when the application is up.
   */
  public async init(options: Record<string, unknown>): Promise<void> {
    this.initOptions = options;

    await Promise.resolve();

    if (FakeApplication.settings.failInit) {
      throw new Error("fake pixi: no adapter");
    }

    const renderer: FakeRenderer = {
      ...createDrawTarget(),
      name: FakeApplication.settings.kind,
      renders: 0,
      frameDraws: 0,
      resizes: [],
      texture: { managedTextures: [] },
      extract: {
        calls: [],
        base64: (options: unknown) => {
          renderer.extract.calls.push(options);

          return Promise.resolve(FAKE_PNG);
        }
      },
      render: () => {
        const before = renderer.drawn;

        renderer.renders += 1;
        if (this.drawClasses !== undefined) {
          drawScene(renderer, this.drawClasses, FakeApplication.settings.scene);
        }
        renderer.frameDraws = renderer.drawn - before;
      },
      resize: (width: number, height: number) => {
        renderer.resizes.push({ width, height });
      }
    };

    if (FakeApplication.settings.kind === "webgpu") {
      renderer.gpu = {
        device: {
          lost: new Promise<{ reason: string }>((resolve, reject) => {
            this.loseDevice = resolve;
            this.failDevice = reject;
          }),
          createShaderModule: compileShader
        }
      };
      this.drawClasses = {
        batch: fakeExtensions.named(WEBGPU_PIPES_ADAPTOR, "batch") as typeof FakeGpuBatchAdaptor,
        graphics: fakeExtensions.named(
          WEBGPU_PIPES_ADAPTOR,
          "graphics"
        ) as typeof FakeGpuGraphicsAdaptor,
        encoder: fakeExtensions.named(WEBGPU_SYSTEM, "encoder") as typeof FakeGpuEncoderSystem
      };
    }

    this.renderer = renderer;
  }

  /**
   * Resolves the `device.lost` promise of this application.
   *
   * @param reason - Why the device went away.
   */
  public lose(reason = "unknown"): void {
    this.loseDevice?.({ reason });
  }

  /**
   * Rejects the `device.lost` promise, as a browser that cannot say what happened does.
   *
   * @param error - What went wrong.
   */
  public fail(error: Error): void {
    this.failDevice?.(error);
  }

  /**
   * Frees the application.
   *
   * @param rendererOptions - Pixi's renderer destroy options.
   * @param options - Pixi's scene destroy options.
   */
  public destroy(rendererOptions?: unknown, options?: unknown): void {
    this.destroyed = true;
    this.destroyArgs = [rendererOptions, options];
    this.stage.destroy({ children: true, texture: false });
    this.canvas.remove();
  }
}

/** The fake module plus the handles a test drives it with. */
export type FakePixi = {
  module: PixiModule;
  applications: FakeApplication[];
  /** The application created last. */
  last(): FakeApplication;
  settings: FakeSettings;
};

/**
 * Creates the fake Pixi module. The extension registry starts over with Pixi's own draw classes.
 *
 * @param options - Which backend to report, whether `init` should reject, what a frame draws.
 * @param options.kind - The backend the fake renderer reports.
 * @param options.failInit - True to make `init` reject, as an unsupported device does.
 * @param options.scene - What every WebGPU frame draws; nothing when left out.
 * @returns The module to pass to `config.loadPixi`, and the recorded applications.
 */
export function createFakePixi(
  options: { kind?: "webgpu" | "webgl"; failInit?: boolean; scene?: Partial<FakeScene> } = {}
): FakePixi {
  FakeApplication.instances = [];
  FakeApplication.settings = {
    kind: options.kind ?? "webgpu",
    failInit: options.failInit ?? false,
    scene: { ...emptyScene(), ...options.scene }
  };
  FakeBitmapFont.made.length = 0;
  fakeCache.entries.clear();
  fakeExtensions.reset();

  const module = {
    Application: FakeApplication,
    Container: FakeContainer,
    Sprite: FakeSprite,
    NineSliceSprite: FakeNineSliceSprite,
    Texture: FakeTexture,
    Rectangle: FakeRectangle,
    Graphics: FakeGraphics,
    BitmapFont: FakeBitmapFont,
    BitmapText: FakeBitmapText,
    Cache: fakeCache,
    bitmapFontTextParser: fakeTextParser,
    bitmapFontXMLStringParser: fakeXmlParser,
    Filter: FakeFilter,
    GpuProgram: FakeGpuProgram,
    UniformGroup: FakeUniformGroup,
    BlurFilter: FakeBlurFilter,
    ColorMatrixFilter: FakeColorMatrixFilter,
    NoiseFilter: FakeNoiseFilter,
    DisplacementFilter: FakeDisplacementFilter,
    AlphaFilter: FakeAlphaFilter,
    ParticleContainer: FakeParticleContainer,
    Particle: FakeParticle,
    extensions: fakeExtensions,
    GpuBatchAdaptor: FakeGpuBatchAdaptor,
    GpuGraphicsAdaptor: FakeGpuGraphicsAdaptor,
    GpuEncoderSystem: FakeGpuEncoderSystem
  } as unknown as PixiModule;

  return {
    module,
    applications: FakeApplication.instances,
    last: () => {
      const app = FakeApplication.instances.at(-1);

      if (app === undefined) throw new Error("fake pixi: no application was created");

      return app;
    },
    settings: FakeApplication.settings
  };
}
