/* eslint-disable unicorn/prefer-dom-node-remove, unicorn/no-null, sonarjs/public-static-readonly -- a Pixi container is not a DOM node, its `parent` is null, and the settings of the fake change per test */
/**
 * @file renderer plugin — the fake Pixi module the tests inject through `config.loadPixi`. Not a
 * test file: the projects only collect `*.test.ts`. It records what the renderer created,
 * destroyed and wrote, so a plain Bun test can assert the whole display tree.
 */
import type { PixiModule } from "../types";
import { createFakeElement, type FakeElement } from "./fake-dom";

/**
 * The source behind a fake texture. `resolution` is 1 when left out, as Pixi's default. A test
 * writes the first three; the texture adds the rest, so the renderer can let go of the bind
 * groups Pixi keeps: `released` lists the events whose listeners were removed, the ones of the
 * style as `"style:<event>"`.
 */
export type FakeSource = {
  width: number;
  height: number;
  destroyed: boolean;
  resolution?: number;
  /** The real pixels across, as Pixi's `TextureSource.pixelWidth`; a pooled texture has it. */
  pixelWidth?: number;
  /** The real pixels down, as Pixi's `TextureSource.pixelHeight`; a pooled texture has it. */
  pixelHeight?: number;
  /** Whether Pixi would generate the mip chain on upload; `from` always writes it. */
  autoGenerateMipmaps?: boolean;
  released?: string[];
  style?: { removeAllListeners(event: string): void };
  removeAllListeners?(event: string): void;
};

/**
 * Gives a source the two `removeAllListeners` of a Pixi source and of its style, once: a slice
 * shares the source of its page.
 *
 * @param source - The source a test wrote, or one another texture already took.
 * @returns The same source.
 */
function listening(source: FakeSource): FakeSource {
  if (source.released !== undefined) return source;

  const released: string[] = [];

  source.released = released;
  source.style = {
    removeAllListeners: (event: string): void => {
      released.push(`style:${event}`);
    }
  };
  source.removeAllListeners = (event: string): void => {
    released.push(event);
  };

  return source;
}

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

/** A decoded image as the fake reads it: anything with a width and a height. */
type FakeImage = { width?: number; height?: number };

/** A fake Pixi texture. */
export class FakeTexture {
  /** Every texture the fake ever made, in creation order. */
  public static readonly made: FakeTexture[] = [];

  /** The 1x1 white texture the placeholder is drawn with. */
  public static readonly WHITE = new FakeTexture({
    source: { width: 1, height: 1, destroyed: false }
  });

  /** The empty texture, as Pixi's `Texture.EMPTY`: what a filter's unbound input names point at. */
  public static readonly EMPTY = new FakeTexture({
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
  /** What the source had let go of when `destroy` ran. */
  public releasedBeforeDestroy: string[] | undefined;
  private readonly framed: boolean;

  public constructor(options: {
    source?: FakeSource;
    frame?: FakeRectangle;
    defaultBorders?: { left: number; top: number; right: number; bottom: number };
  }) {
    this.source = listening(options.source ?? { width: 64, height: 64, destroyed: false });
    this.defaultBorders = options.defaultBorders;
    this.framed = options.frame !== undefined;
    this.frame = options.frame ?? new FakeRectangle(0, 0, this.source.width, this.source.height);
    FakeTexture.made?.push(this);
  }

  /**
   * Makes a texture from a decoded image, or from Pixi's options form `{ resource, ...options }`.
   *
   * @param input - The image, anything with a width and a height, or the options around it.
   * @returns A new texture over that image; its source records `autoGenerateMipmaps`.
   */
  public static from(
    input: FakeImage | { resource: FakeImage; autoGenerateMipmaps?: boolean }
  ): FakeTexture {
    const options = "resource" in input ? input : { resource: input };

    return new FakeTexture({
      source: {
        width: options.resource.width ?? 64,
        height: options.resource.height ?? 64,
        destroyed: false,
        autoGenerateMipmaps: options.autoGenerateMipmaps === true
      }
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
    this.releasedBeforeDestroy = [...(this.source.released ?? [])];
    if (destroySource === true) this.source.destroyed = true;
  }
}

/**
 * The fake of Pixi's `TexturePool`: a request of a frame at a resolution gets a texture whose
 * backing is the next power of two of the real pixels, as Pixi's `getOptimalTexture` sizes it, and
 * a returned texture is handed out again for the same backing. Every take, return and clear is
 * recorded; `clear(true)` destroys the idle textures, as Pixi's does.
 */
export class FakeTexturePool {
  /** Every texture handed out, in order. */
  public readonly taken: FakeTexture[] = [];
  /** Every texture given back, in order. */
  public readonly returned: FakeTexture[] = [];
  /** Every options object `getOptimalTexture` was handed, in order. */
  public readonly requests: object[] = [];
  /** The argument of every `clear`, in order. */
  public readonly clears: Array<boolean | undefined> = [];
  /** Told after every `clear`: a test drops the GPU sources its scripted idle targets stood for. */
  public onClear: (() => void) | undefined;
  private readonly free: FakeTexture[] = [];

  /**
   * Forgets every idle texture and destroys it unless told not to, as Pixi's `clear` does.
   *
   * @param destroyTextures - False keeps the textures alive; destroyed otherwise.
   */
  public clear(destroyTextures?: boolean): void {
    this.clears.push(destroyTextures);

    for (const texture of this.free.splice(0)) {
      if (destroyTextures !== false) texture.destroy(true);
    }

    this.onClear?.();
  }

  /**
   * Hands out a pooled texture of a frame at a resolution, as Pixi's does (8.21+: an options object).
   *
   * @param options - The frame in CSS pixels and the resolution.
   * @param options.width - Frame width.
   * @param options.height - Frame height.
   * @param options.resolution - Real pixels per CSS pixel; 1 when left out.
   * @returns The texture.
   */
  public getOptimalTexture(options: {
    width: number;
    height: number;
    resolution?: number;
  }): FakeTexture {
    const resolution = options.resolution ?? 1;
    const pixelWidth = nextPow2(Math.ceil(options.width * resolution - 1e-6));
    const pixelHeight = nextPow2(Math.ceil(options.height * resolution - 1e-6));
    const at = this.free.findIndex(
      texture =>
        texture.source.pixelWidth === pixelWidth && texture.source.pixelHeight === pixelHeight
    );
    const texture =
      at === -1
        ? new FakeTexture({
            source: { width: 0, height: 0, destroyed: false, pixelWidth, pixelHeight }
          })
        : (this.free.splice(at, 1)[0] as FakeTexture);

    texture.source.resolution = resolution;
    texture.source.width = pixelWidth / resolution;
    texture.source.height = pixelHeight / resolution;
    texture.frame = new FakeRectangle(0, 0, options.width, options.height);
    this.requests.push(options);
    this.taken.push(texture);

    return texture;
  }

  /**
   * Takes a texture back.
   *
   * @param texture - A texture `getOptimalTexture` handed out.
   */
  public returnTexture(texture: FakeTexture): void {
    this.returned.push(texture);
    this.free.push(texture);
  }
}

/**
 * The next power of two at or above a number, as Pixi's pool sizes a backing.
 *
 * @param value - Real pixels, at least 1.
 * @returns The power of two.
 */
function nextPow2(value: number): number {
  let size = 1;

  while (size < value) size *= 2;

  return size;
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
 * The fake of Pixi's `Bounds`: the four edges `getBounds` fills, empty after `clear`, as Pixi's
 * are (`minX` Infinity, `maxX` -Infinity).
 */
export class FakeBounds {
  public minX = Number.POSITIVE_INFINITY;
  public minY = Number.POSITIVE_INFINITY;
  public maxX = Number.NEGATIVE_INFINITY;
  public maxY = Number.NEGATIVE_INFINITY;

  /**
   * Empties the box.
   *
   * @returns The same box.
   */
  public clear(): this {
    this.minX = Number.POSITIVE_INFINITY;
    this.minY = Number.POSITIVE_INFINITY;
    this.maxX = Number.NEGATIVE_INFINITY;
    this.maxY = Number.NEGATIVE_INFINITY;

    return this;
  }

  /**
   * Sets the four edges.
   *
   * @param minX - Left.
   * @param minY - Top.
   * @param maxX - Right.
   * @param maxY - Bottom.
   */
  public set(minX: number, minY: number, maxX: number, maxY: number): void {
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
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
  /** Drawn or left out with its transform kept, as Pixi's `renderable` is. */
  public renderable = true;
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
   * The bounds in the stage's space, the fake way: the local bounds moved by the positions of the
   * chain, no scale, no rotation. A box of no area is Pixi's empty one, the zero rectangle.
   *
   * @param _skipUpdate - Pixi's switch; the fake always walks the chain.
   * @param bounds - The box to fill.
   * @returns The same box.
   */
  public getBounds(_skipUpdate: boolean, bounds: FakeBounds = new FakeBounds()): FakeBounds {
    const local = this.getLocalBounds();
    let x = local.x + this.position.x;
    let y = local.y + this.position.y;

    for (let node = this.parent; node !== null; node = node.parent) {
      x += node.position.x;
      y += node.position.y;
    }

    if (local.width <= 0 || local.height <= 0) bounds.set(0, 0, 0, 0);
    else bounds.set(x, y, x + local.width, y + local.height);

    return bounds;
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
   * Refuses a child, as Pixi 8.22 does.
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
  const data = { instructions: { instructionSize: 0 } };

  return {
    drawn: 0,
    graphicsContext: {
      getContextRenderData: context => {
        data.instructions.instructionSize = context.instructionSize;

        return data;
      }
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

/** Pixi's `ExtensionType.WebGLSystem`: the WebGL texture system and the filter system register here. */
export const WEBGL_SYSTEM = "webgl-system";

/** A render target as the pass rules read it: Pixi's public `RenderTarget` fields. */
export type FakeRenderTarget = {
  isRoot: boolean;
  pixelWidth: number;
  pixelHeight: number;
  label?: string;
  colorTexture?: { label?: string };
};

/** The fake of Pixi's `SystemRunner`: items are called by the runner's name, in order. */
export class FakeRunner {
  public readonly items: object[] = [];

  public constructor(private readonly name: string) {}

  /**
   * Adds an item.
   *
   * @param item - An object with a method of the runner's name.
   * @returns The runner.
   */
  public add(item: object): this {
    this.items.push(item);

    return this;
  }

  /**
   * Removes an item.
   *
   * @param item - The item.
   * @returns The runner.
   */
  public remove(item: object): this {
    const at = this.items.indexOf(item);

    if (at !== -1) this.items.splice(at, 1);

    return this;
  }

  /**
   * Calls the method of the runner's name on every item.
   *
   * @param args - What the runner hands its items.
   */
  public emit(...args: unknown[]): void {
    // eslint-disable-next-line unicorn/no-useless-spread -- an item may remove itself while it is called
    for (const item of [...this.items]) {
      const method: unknown = Reflect.get(item, this.name);

      if (typeof method === "function") Reflect.apply(method, item, args);
    }
  }
}

/** The pass encoder the fake encoder answers for every pass. */
const PASS_ENCODER = Object.freeze({ label: "pass encoder" });

/** A fake GPU render target: its descriptor, as Pixi builds one for every pass. */
export type FakeGpuRenderTarget = { descriptor: Record<string, unknown> };

/** The fake of Pixi's `GpuEncoderSystem`: one native draw per `draw` and per `drawIndirect`. */
export class FakeGpuEncoderSystem {
  public static extension = { type: [WEBGPU_SYSTEM], name: "encoder", priority: 1 };

  public renderer: FakeDrawTarget;
  /** Pixi's command encoder of the render call. */
  public commandEncoder: unknown = { label: "command encoder" };
  /** What the encoder did, in order: passes begun and finished, submits. */
  public readonly calls: string[] = [];

  public constructor(renderer: FakeDrawTarget) {
    this.renderer = renderer;
  }

  /** Records the calls of the encoder; off for the allocation probe, which draws 20 000 frames. */
  public record = true;

  /**
   * Begins a render pass on a GPU render target.
   *
   * @param _gpuRenderTarget - The target with its descriptor.
   * @returns The pass encoder, one object for every pass.
   */
  public beginRenderPass(_gpuRenderTarget: FakeGpuRenderTarget): unknown {
    if (this.record) this.calls.push("begin");

    return PASS_ENCODER;
  }

  /** Ends the running pass; repeat-safe. */
  public finishRenderPass(): void {
    if (this.record) this.calls.push("finish");
  }

  /** Submits the command buffer of the render call. */
  public postrender(): void {
    if (this.record) this.calls.push("submit");
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

/** The fake of Pixi's `FilterSystem`: every apply of every filter, both backends. */
export class FakeFilterSystem {
  public static extension = { type: [WEBGL_SYSTEM, WEBGPU_SYSTEM], name: "filter" };
  /** Runs inside every apply, where Pixi begins the passes of the filter. */
  public static onApply: (() => void) | undefined = undefined;

  /** The filters applied, in order. */
  public readonly applied: unknown[] = [];

  /**
   * Applies one filter.
   *
   * @param filter - The filter.
   * @param _input - Its input texture.
   * @param _output - Its output.
   * @param _clear - Whether the output is cleared.
   */
  public applyFilter(filter: unknown, _input: unknown, _output: unknown, _clear: boolean): void {
    this.applied.push(filter);
    FakeFilterSystem.onApply?.();
  }
}

/** A texture source as the upload counting reads it. */
export type FakeUploadSource = {
  uploadMethodId: string;
  resource: unknown;
  pixelWidth: number;
  pixelHeight: number;
};

/** The fake of Pixi's `GpuTextureSystem`: `onSourceUpdate` uploads a source. */
export class FakeGpuTextureSystem {
  public static extension = { type: [WEBGPU_SYSTEM], name: "texture" };

  /** The sources uploaded, in order. */
  public readonly uploaded: FakeUploadSource[] = [];

  /**
   * Uploads a source.
   *
   * @param source - The source.
   */
  protected onSourceUpdate(source: FakeUploadSource): void {
    this.uploaded.push(source);
  }
}

/** The fake of Pixi's `GlTextureSystem`: `onSourceUpdate` uploads a source. */
export class FakeGlTextureSystem {
  public static extension = { type: [WEBGL_SYSTEM], name: "texture" };

  /** The sources uploaded, in order. */
  public readonly uploaded: FakeUploadSource[] = [];

  /**
   * Uploads a source.
   *
   * @param source - The source.
   */
  protected onSourceUpdate(source: FakeUploadSource): void {
    this.uploaded.push(source);
  }
}

/** Pixi's `ExtensionType.WebGLPipes`: the bitmap text pipe registers here and under WebGPU. */
export const WEBGL_PIPES = "webgl-pipes";

/** Pixi's `ExtensionType.WebGPUPipes`: the bitmap text pipe registers here and under WebGL. */
export const WEBGPU_PIPES = "webgpu-pipes";

/**
 * The fake of Pixi's `BatcherPipe`: Pixi calls `buildStart` once per instruction rebuild of a render group, the one
 * method the rebuild counter overrides.
 */
export class FakeBatcherPipe {
  public static extension = { type: [WEBGL_PIPES, WEBGPU_PIPES], name: "batch" };

  /** Instruction rebuilds begun on this pipe. */
  public builds = 0;

  /**
   * Begins one rebuild of a render group's instruction list.
   *
   * @param _instructionSet - The instruction set being rebuilt.
   */
  public buildStart(_instructionSet: unknown): void {
    this.builds += 1;
  }
}

/** The fake of Pixi's `Matrix`: the identity. */
export class FakeMatrix {
  public a = 1;
  public b = 0;
  public c = 0;
  public d = 1;
  public tx = 0;
  public ty = 0;
}

/** What a fake shader is built from: Pixi's `Shader` options the renderer passes. */
export type FakeShaderOptions = {
  gpuProgram?: unknown;
  glProgram?: unknown;
  resources?: Record<string, unknown>;
};

/** The fake of Pixi's `Shader`: the programs and the resources it was built with. */
export class FakeShader {
  public gpuProgram: unknown;
  public glProgram: unknown;
  public resources: Record<string, unknown>;

  public constructor(options: FakeShaderOptions) {
    this.gpuProgram = options.gpuProgram;
    this.glProgram = options.glProgram;
    this.resources = options.resources ?? {};
  }
}

/** The fake of Pixi's `GlProgram`: the options of the compile it came from. */
export class FakeGlProgram {
  public options: Record<string, unknown>;

  public constructor(options: Record<string, unknown>) {
    this.options = options;
  }

  /**
   * Builds a program, as Pixi's `GlProgram.from` does.
   *
   * @param options - Name, vertex and fragment sources.
   * @returns A new program.
   */
  public static from(options: Record<string, unknown>): FakeGlProgram {
    return new FakeGlProgram(options);
  }
}

/** The fake of Pixi's `defaultFilterVert`: the vertex stage every filter's `GlProgram` takes. */
export const FAKE_FILTER_VERT =
  "in vec2 aPosition;\nout vec2 vTextureCoord;\n// fake filter vertex\n";

/** One stage of a high-shader bit: the WGSL it adds at each hook. */
export type FakeShaderStage = { header?: string; start?: string; main?: string; end?: string };

/** A bit of Pixi's high shader: a name and the WGSL it adds to each stage. */
export type FakeShaderBit = { name: string; vertex?: FakeShaderStage; fragment?: FakeShaderStage };

/** The fake of Pixi's `colorBit`: the vertex colour, premultiplied. */
export const fakeColorBit: FakeShaderBit = {
  name: "color-bit",
  vertex: { main: "vColor *= vec4<f32>(aColor.rgb * aColor.a, aColor.a);" }
};

/** The fake of Pixi's `roundPixelsBit`. */
export const fakeRoundPixelsBit: FakeShaderBit = {
  name: "round-pixels-bit",
  vertex: { header: "fn roundPixels(position: vec2<f32>, targetSize: vec2<f32>) -> vec2<f32> {}" }
};

/** The fake of Pixi's `mSDFBit`: the coverage function of a distance-field glyph. */
export const fakeMSDFBit: FakeShaderBit = {
  name: "msdf-bit",
  fragment: {
    header:
      "fn calculateMSDFAlpha(msdfColor:vec4<f32>, shapeColor:vec4<f32>, distance:f32) -> f32 {}"
  }
};

/** The fake of Pixi 8.22's `localUniformMSDFBit`, with the step that hands over `vColor`. */
export const fakeLocalUniformMSDFBit = {
  name: "local-uniform-msdf-bit",
  vertex: {
    header: "struct LocalUniforms { uColor:vec4<f32>, }",
    main: "vColor *= localUniforms.uColor;",
    end: "if(localUniforms.uRound == 1) {}"
  },
  fragment: {
    header: "struct LocalUniforms { uColor:vec4<f32>, }",
    main: "outColor = vec4<f32>(calculateMSDFAlpha(outColor, vColor, localUniforms.uDistance));"
  }
};

/** The texture batch bits made so far, one per texture count, as Pixi caches them. */
const textureBatchBits = new Map<number, FakeShaderBit>();

/**
 * The fake of Pixi's `generateTextureBatchBit`: one bit per texture count, made once.
 *
 * @param maxTextures - How many textures a batch samples.
 * @returns The bit of that count.
 */
export function fakeTextureBatchBit(maxTextures: number): FakeShaderBit {
  const made = textureBatchBits.get(maxTextures) ?? {
    name: "texture-batch-bit",
    fragment: { main: `outColor = textureSample(${String(maxTextures)});` }
  };

  textureBatchBits.set(maxTextures, made);

  return made;
}

/** The fake of Pixi's `colorBitGl`: the vertex colour, premultiplied, in GLSL. */
export const fakeColorBitGl: FakeShaderBit = {
  name: "color-bit",
  vertex: { main: "vColor *= vec4(aColor.rgb * aColor.a, aColor.a);" }
};

/** The fake of Pixi's `roundPixelsBitGl`. */
export const fakeRoundPixelsBitGl: FakeShaderBit = {
  name: "round-pixels-bit",
  vertex: { header: "vec2 roundPixels(vec2 position, vec2 targetSize) {}" }
};

/** The fake of Pixi's `mSDFBitGl`: the coverage function of a distance-field glyph, in GLSL. */
export const fakeMSDFBitGl: FakeShaderBit = {
  name: "msdf-bit",
  fragment: {
    header: "float calculateMSDFAlpha(vec4 msdfColor, vec4 shapeColor, float distance) {}"
  }
};

/** The fake of Pixi 8.22's `localUniformMSDFBitGl`, with the step that hands over `vColor`. */
export const fakeLocalUniformMSDFBitGl = {
  name: "local-uniform-msdf-bit",
  vertex: {
    header: "uniform mat3 uTransformMatrix; uniform vec4 uColor; uniform float uRound;",
    main: "vColor *= uColor;",
    end: "if(uRound == 1.) {}"
  },
  fragment: {
    header: "uniform float uDistance;",
    main: "outColor = vec4(calculateMSDFAlpha(outColor, vColor, uDistance));"
  }
};

/** The GLSL texture batch bits made so far, one per texture count, as Pixi caches them. */
const textureBatchBitsGl = new Map<number, FakeShaderBit>();

/**
 * The fake of Pixi's `generateTextureBatchBitGl`: one bit per texture count, made once.
 *
 * @param maxTextures - How many textures a batch samples.
 * @returns The bit of that count.
 */
export function fakeTextureBatchBitGl(maxTextures: number): FakeShaderBit {
  const made = textureBatchBitsGl.get(maxTextures) ?? {
    name: "texture-batch-bit",
    fragment: { main: `outColor = texture(uTextures[${String(maxTextures)}]);` }
  };

  textureBatchBitsGl.set(maxTextures, made);

  return made;
}

/** The batch sampler groups made so far, one per texture count, as Pixi caches them. */
const batchSamplers = new Map<number, FakeUniformGroup>();

/**
 * The fake of Pixi's `getBatchSamplersUniformGroup`: the sampler slots of a WebGL batch, one
 * static group per texture count.
 *
 * @param maxTextures - How many textures a batch samples.
 * @returns The group of that count.
 */
export function fakeBatchSamplers(maxTextures: number): FakeUniformGroup {
  const made =
    batchSamplers.get(maxTextures) ??
    new FakeUniformGroup({
      uTextures: { value: Int32Array.from({ length: maxTextures }, (_, index) => index) }
    });

  made.isStatic = true;
  batchSamplers.set(maxTextures, made);

  return made;
}

/** What a fake high-shader compile was asked for. */
export type FakeCompile = { name: string; bits: FakeShaderBit[] };

/** The fake of Pixi's two high-shader compilers: they record every compile. */
export const fakeShaderCompiler = {
  /** Every WebGPU compile since the fake module was made. */
  compiled: [] as FakeCompile[],

  /** Every WebGL compile since the fake module was made. */
  compiledGl: [] as FakeCompile[],

  /**
   * Compiles a program out of bits, as Pixi's `compileHighShaderGpuProgram` does.
   *
   * @param options - The name of the program and its bits.
   * @returns A program that keeps the options.
   */
  compile(options: FakeCompile): FakeGpuProgram {
    fakeShaderCompiler.compiled.push(options);

    return new FakeGpuProgram(options);
  },

  /**
   * Compiles a program out of GLSL bits, as Pixi's `compileHighShaderGlProgram` does.
   *
   * @param options - The name of the program and its bits.
   * @returns A program that keeps the options.
   */
  compileGl(options: FakeCompile): FakeGlProgram {
    fakeShaderCompiler.compiledGl.push(options);

    return new FakeGlProgram(options);
  }
};

/** What a pipe reads of its renderer: its backend name and its texture limit. */
export type FakePipeRenderer = {
  name: "webgpu" | "webgl";
  limits: { maxBatchableTextures: number };
  /** Device pixels per CSS pixel: the edge width of distance-field text is read times it. */
  resolution: number;
};

/** The shader Pixi's own pipe hands out: its `SdfShader`, which applies the alpha twice. */
export class FakeSdfShader extends FakeShader {
  public readonly kind = "pixi-sdf";
}

/** The fake of Pixi's `BitmapTextPipe`: one per renderer, under the same name for both backends. */
export class FakeBitmapTextPipe {
  public static extension = { type: [WEBGL_PIPES, WEBGPU_PIPES], name: "bitmapText" };

  protected _renderer: FakePipeRenderer;

  public constructor(renderer: FakePipeRenderer) {
    this._renderer = renderer;
  }

  /**
   * The shader of a distance-field font, asked once per text the pipe draws.
   *
   * @returns Pixi's own SDF shader.
   */
  protected getSdfShader(): FakeShader {
    return new FakeSdfShader({ resources: { localUniforms: new FakeUniformGroup({}) } });
  }
}

/** The fake of Pixi's `RenderGroupPipe`: one per renderer, under the same name for every backend. */
export class FakeRenderGroupPipe {
  public static extension = { type: [WEBGL_PIPES, WEBGPU_PIPES], name: "renderGroup" };

  /** Render groups executed by this pipe. */
  public executed: unknown[] = [];

  /**
   * Executes one render group.
   *
   * @param renderGroup - The render group.
   */
  public execute(renderGroup: unknown): void {
    this.executed.push(renderGroup);
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

  /**
   * Empties the registry and registers Pixi's own seven counted classes and its bitmap text pipe,
   * as importing Pixi does.
   */
  reset(): void {
    fakeExtensions.lists.clear();
    fakeExtensions.add(
      FakeGpuBatchAdaptor,
      FakeGpuGraphicsAdaptor,
      FakeGpuEncoderSystem,
      FakeFilterSystem,
      FakeGpuTextureSystem,
      FakeGlTextureSystem,
      FakeBatcherPipe,
      FakeBitmapTextPipe,
      FakeRenderGroupPipe
    );
  }
};

fakeExtensions.reset();

/**
 * What one fake frame draws under WebGPU, through the classes registered at init: `batches`
 * batch executes, one graphics execute per entry of `graphics` with that many instructions,
 * `draws` encoder draws and `indirect` indirect draws.
 */
export type FakeScene = {
  batches: number;
  graphics: number[];
  draws: number;
  indirect: number;
  /** Render passes the encoder begins, on the bound target, then one submit. */
  passes: number;
  /** Instruction rebuilds the batcher pipe begins, as Pixi's render group system does on a changed structure. */
  rebuilds: number;
};

/** The three draw classes an application found in the registry at `init`, as Pixi does. */
export type FakeDrawClasses = {
  batch: typeof FakeGpuBatchAdaptor;
  graphics: typeof FakeGpuGraphicsAdaptor;
  encoder: typeof FakeGpuEncoderSystem;
  /** The batcher pipe found under `"batch"` of the WebGPU pipes. */
  batcher: typeof FakeBatcherPipe;
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

/** A shader of the fake WebGL context: the source it was given. */
export type FakeGlShader = { source: string };

/** The fake WebGL2 context of a WebGL renderer: the GLSL compile `effects` checks in dev. */
export type FakeGlContext = {
  readonly FRAGMENT_SHADER: number;
  readonly COMPILE_STATUS: number;
  /** Every GLSL source compiled, in order. */
  compiled: string[];
  createShader(type: number): FakeGlShader;
  shaderSource(shader: FakeGlShader, source: string): void;
  compileShader(shader: FakeGlShader): void;
  getShaderParameter(shader: FakeGlShader, name: number): boolean;
  getShaderInfoLog(shader: FakeGlShader): string;
  deleteShader(shader: FakeGlShader): void;
  /** No extension unless a test gives one: `getExtension` answers what `extensions` holds. */
  extensions: Record<string, unknown>;
  getExtension(name: string): unknown;
  /** Programs linked, in order. */
  linked: unknown[];
  linkProgram(program: unknown): void;
  readonly QUERY_RESULT: number;
  readonly QUERY_RESULT_AVAILABLE: number;
  readonly RENDERER: number;
  /** What each query answers: available and its nanoseconds. */
  results: Map<object, { available: boolean; ns: number }>;
  /** The disjoint flag `getParameter(GPU_DISJOINT_EXT)` answers. */
  disjoint: boolean;
  /** Queries begun and ended, in order. */
  queries: string[];
  createQuery(): object;
  beginQuery(target: number, query: object): void;
  endQuery(target: number): void;
  deleteQuery(query: object): void;
  getQueryParameter(query: object, name: number): unknown;
  getParameter(name: number): unknown;
};

/**
 * Creates the fake WebGL2 context: every source compiles with an empty log.
 *
 * @returns The context, recording its compiles.
 */
export function createFakeGlContext(): FakeGlContext {
  const context: FakeGlContext = {
    FRAGMENT_SHADER: 0x8b_30,
    COMPILE_STATUS: 0x8b_81,
    compiled: [],
    createShader: () => ({ source: "" }),
    shaderSource: (shader, source) => {
      shader.source = source;
    },
    compileShader: shader => {
      context.compiled.push(shader.source);
    },
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    deleteShader: () => undefined,
    extensions: {},
    getExtension: name => context.extensions[name] ?? null,
    linked: [],
    linkProgram: program => {
      context.linked.push(program);
    },
    QUERY_RESULT: 0x88_66,
    QUERY_RESULT_AVAILABLE: 0x88_67,
    RENDERER: 0x1f_01,
    results: new Map(),
    disjoint: false,
    queries: [],
    createQuery: () => ({}),
    beginQuery: () => {
      context.queries.push("begin");
    },
    endQuery: () => {
      context.queries.push("end");
    },
    deleteQuery: () => undefined,
    getQueryParameter: (query, name) => {
      const result = context.results.get(query);

      if (name === context.QUERY_RESULT_AVAILABLE) return result?.available ?? false;

      return result?.ns ?? 0;
    },
    getParameter: name => (name === context.RENDERER ? "Mali-G68" : context.disjoint)
  };

  return context;
}

/** What the fake renderer recorded. */
export type FakeRenderer = FakeDrawTarget & {
  name: "webgpu" | "webgl";
  /** Device pixels per CSS pixel: the `resolution` the application was created with, 1 by default. */
  resolution: number;
  renders: number;
  /** Native draws of the last `render`. */
  frameDraws: number;
  resizes: Array<{ width: number; height: number }>;
  gpu?: { device: FakeGpuDevice };
  /** The WebGL2 context, as Pixi's `WebGLRenderer.gl`; only a WebGL renderer has one. */
  gl?: FakeGlContext;
  /** The GPU texture sources, as Pixi's `renderer.texture.managedTextures`. */
  texture: { managedTextures: FakeManagedSource[] };
  /**
   * Pixi's extract system: `base64` records its options and answers `FAKE_PNG`; `pixels` records
   * its options and answers a copy of `picture`, what the stage looks like now.
   */
  extract: {
    calls: unknown[];
    base64(options: unknown): Promise<string>;
    picture: Uint8ClampedArray;
    pixelCalls: unknown[];
    pixels(options: unknown): { pixels: Uint8ClampedArray; width: number; height: number };
  };
  /** Pixi's public runners a monitor hangs items on. */
  runners: { prerender: FakeRunner; renderStart: FakeRunner; postrender: FakeRunner };
  /** Pixi's render target system: the bound target and its change runner. */
  renderTarget: { renderTarget: FakeRenderTarget; onRenderTargetChange: FakeRunner };
  /** Every resize with the resolution it asked for, `undefined` for none. */
  resolutions: Array<number | undefined>;
  /** Pixi's background system: the canvas is cleared before every stage pass, Pixi's default. */
  background: { clearBeforeRender: boolean };
  render(stage: FakeContainer): void;
  resize(width: number, height: number, resolution?: number): void;
};

/** The draw instances of one application, made once, as Pixi makes its systems at init. */
type FakeDrawInstances = {
  pipe: { renderer: FakeRenderer };
  batch: FakeGpuBatchAdaptor;
  graphics: FakeGpuGraphicsAdaptor;
  encoder: FakeGpuEncoderSystem;
  batcher: FakeBatcherPipe;
  descriptor: { colorAttachments: unknown[] };
  target: FakeGpuRenderTarget;
  context: FakeGraphicsContext;
  renderable: { context: FakeGraphicsContext };
};

/**
 * Makes the draw instances of an application from the classes found at init.
 *
 * @param renderer - The renderer drawn on.
 * @param classes - The draw classes.
 * @returns The instances.
 */
function createDrawInstances(renderer: FakeRenderer, classes: FakeDrawClasses): FakeDrawInstances {
  const encoder = new classes.encoder(renderer);
  const descriptor = { colorAttachments: [] };
  const context = { instructionSize: 0 };

  encoder.record = false;

  return {
    pipe: { renderer },
    batch: new classes.batch(),
    graphics: new classes.graphics(),
    encoder,
    batcher: new classes.batcher(),
    descriptor,
    target: { descriptor },
    context,
    renderable: { context }
  };
}

/**
 * Draws one fake frame through the instances a WebGPU application made at init: nothing is made
 * per frame, so the allocation probe sees only the engine.
 *
 * @param draw - The draw instances of the application.
 * @param scene - What the frame draws.
 */
function drawScene(draw: FakeDrawInstances, scene: FakeScene): void {
  const { pipe, batch, graphics, encoder } = draw;

  for (let index = 0; index < scene.batches; index += 1) batch.execute(pipe, draw);
  for (let index = 0; index < scene.graphics.length; index += 1) {
    draw.context.instructionSize = scene.graphics[index] ?? 0;
    graphics.execute(pipe, draw.renderable);
  }
  for (let index = 0; index < scene.draws; index += 1) encoder.draw(draw);
  for (let index = 0; index < scene.indirect; index += 1) encoder.drawIndirect(draw);
  for (let index = 0; index < scene.passes; index += 1) encoder.beginRenderPass(draw.target);
  if (scene.passes > 0) encoder.postrender();
  for (let index = 0; index < scene.rebuilds; index += 1) draw.batcher.buildStart(draw.descriptor);
}

/** What `createFakePixi` sets for every application, because a Pixi class takes no options. */
export type FakeSettings = { kind: "webgpu" | "webgl"; failInit: boolean; scene: FakeScene };

/**
 * A scene that draws nothing.
 *
 * @returns The empty scene.
 */
function emptyScene(): FakeScene {
  return { batches: 0, graphics: [], draws: 0, indirect: 0, passes: 0, rebuilds: 0 };
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
  /** The draw instances made from them at init. */
  private drawInstances: FakeDrawInstances | undefined;
  /** The bitmap text pipe the renderer took from the registry at init, for its backend. */
  public textPipe: FakeExtensionClass | undefined;
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
      resolution: typeof options.resolution === "number" ? options.resolution : 1,
      renders: 0,
      frameDraws: 0,
      resizes: [],
      texture: { managedTextures: [] },
      extract: {
        calls: [],
        base64: (options: unknown) => {
          renderer.extract.calls.push(options);

          return Promise.resolve(FAKE_PNG);
        },
        picture: new Uint8ClampedArray(16),
        pixelCalls: [],
        pixels: (options: unknown) => {
          renderer.extract.pixelCalls.push(options);

          return { pixels: new Uint8ClampedArray(renderer.extract.picture), width: 2, height: 2 };
        }
      },
      render: () => {
        const before = renderer.drawn;

        renderer.renders += 1;
        if (this.drawInstances !== undefined) {
          drawScene(this.drawInstances, FakeApplication.settings.scene);
        }
        renderer.frameDraws = renderer.drawn - before;
      },
      runners: {
        prerender: new FakeRunner("prerender"),
        renderStart: new FakeRunner("renderStart"),
        postrender: new FakeRunner("postrender")
      },
      renderTarget: {
        renderTarget: { isRoot: true, pixelWidth: 1080, pixelHeight: 1920 },
        onRenderTargetChange: new FakeRunner("onRenderTargetChange")
      },
      resolutions: [],
      background: { clearBeforeRender: true },
      resize: (width: number, height: number, resolution?: number) => {
        renderer.resizes.push({ width, height });
        renderer.resolutions.push(resolution);

        if (resolution !== undefined) renderer.resolution = resolution;
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
        encoder: fakeExtensions.named(WEBGPU_SYSTEM, "encoder") as typeof FakeGpuEncoderSystem,
        batcher: fakeExtensions.named(WEBGPU_PIPES, "batch") as typeof FakeBatcherPipe
      };
      this.drawInstances = createDrawInstances(renderer, this.drawClasses);
    }

    if (FakeApplication.settings.kind === "webgl") renderer.gl = createFakeGlContext();

    this.textPipe = fakeExtensions.named(
      FakeApplication.settings.kind === "webgpu" ? WEBGPU_PIPES : WEBGL_PIPES,
      "bitmapText"
    );
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
  FakeFilterSystem.onApply = undefined;
  FakeApplication.settings = {
    kind: options.kind ?? "webgpu",
    failInit: options.failInit ?? false,
    scene: { ...emptyScene(), ...options.scene }
  };
  FakeBitmapFont.made.length = 0;
  fakeCache.entries.clear();
  fakeExtensions.reset();
  fakeShaderCompiler.compiled.length = 0;
  fakeShaderCompiler.compiledGl.length = 0;

  const module = {
    Application: FakeApplication,
    Container: FakeContainer,
    Sprite: FakeSprite,
    NineSliceSprite: FakeNineSliceSprite,
    Texture: FakeTexture,
    TexturePool: new FakeTexturePool(),
    Rectangle: FakeRectangle,
    Graphics: FakeGraphics,
    BitmapFont: FakeBitmapFont,
    BitmapText: FakeBitmapText,
    Cache: fakeCache,
    bitmapFontTextParser: fakeTextParser,
    bitmapFontXMLStringParser: fakeXmlParser,
    Filter: FakeFilter,
    GpuProgram: FakeGpuProgram,
    GlProgram: FakeGlProgram,
    defaultFilterVert: FAKE_FILTER_VERT,
    UniformGroup: FakeUniformGroup,
    BlurFilter: FakeBlurFilter,
    Bounds: FakeBounds,
    ColorMatrixFilter: FakeColorMatrixFilter,
    NoiseFilter: FakeNoiseFilter,
    DisplacementFilter: FakeDisplacementFilter,
    AlphaFilter: FakeAlphaFilter,
    ParticleContainer: FakeParticleContainer,
    Particle: FakeParticle,
    extensions: fakeExtensions,
    GpuBatchAdaptor: FakeGpuBatchAdaptor,
    GpuGraphicsAdaptor: FakeGpuGraphicsAdaptor,
    GpuEncoderSystem: FakeGpuEncoderSystem,
    FilterSystem: FakeFilterSystem,
    GpuTextureSystem: FakeGpuTextureSystem,
    GlTextureSystem: FakeGlTextureSystem,
    BitmapTextPipe: FakeBitmapTextPipe,
    BatcherPipe: FakeBatcherPipe,
    RenderGroupPipe: FakeRenderGroupPipe,
    Shader: FakeShader,
    Matrix: FakeMatrix,
    compileHighShaderGpuProgram: fakeShaderCompiler.compile,
    colorBit: fakeColorBit,
    generateTextureBatchBit: fakeTextureBatchBit,
    localUniformMSDFBit: fakeLocalUniformMSDFBit,
    mSDFBit: fakeMSDFBit,
    roundPixelsBit: fakeRoundPixelsBit,
    compileHighShaderGlProgram: fakeShaderCompiler.compileGl,
    colorBitGl: fakeColorBitGl,
    generateTextureBatchBitGl: fakeTextureBatchBitGl,
    localUniformMSDFBitGl: fakeLocalUniformMSDFBitGl,
    mSDFBitGl: fakeMSDFBitGl,
    roundPixelsBitGl: fakeRoundPixelsBitGl,
    getBatchSamplersUniformGroup: fakeBatchSamplers
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
