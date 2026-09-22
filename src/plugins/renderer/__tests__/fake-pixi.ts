/* eslint-disable unicorn/prefer-dom-node-remove, unicorn/no-null, sonarjs/public-static-readonly -- a Pixi container is not a DOM node, its `parent` is null, and the settings of the fake change per test */
/**
 * @file renderer plugin — the fake Pixi module the tests inject through `config.loadPixi`. Not a
 * test file: the projects only collect `*.test.ts`. It records what the renderer created,
 * destroyed and wrote, so a plain Bun test can assert the whole display tree.
 */
import type { PixiModule } from "../types";
import { createFakeElement, type FakeElement } from "./fake-dom";

/** The source behind a fake texture. */
export type FakeSource = { width: number; height: number; destroyed: boolean };

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
    if (options?.children === true) for (const child of this.children) child.destroy(options);
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

/** A fake Pixi nine-slice sprite. */
export class FakeNineSliceSprite extends FakeContainer {
  public texture: FakeTexture;
  public width = 0;
  public height = 0;
  public tint = 0xff_ff_ff;
  public leftWidth = 0;
  public topHeight = 0;
  public rightWidth = 0;
  public bottomHeight = 0;

  public constructor(options: { texture: FakeTexture }) {
    super();
    this.texture = options.texture;
  }
}

/** One path the fake graphics was asked to draw. */
export type FakeDrawOp = {
  op: "rect" | "roundRect";
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};

/** A fill or a stroke style the fake graphics recorded. */
export type FakePaint = { color: number; width?: number };

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

/** What a fake bitmap font was built from. */
export type FakeFontData = {
  chars: Record<string, unknown>;
  pages: unknown[];
  fontFamily?: string;
};

/** A fake Pixi bitmap font. */
export class FakeBitmapFont {
  /** Every font the fake module ever built, in creation order. */
  public static readonly made: FakeBitmapFont[] = [];

  public data: FakeFontData;
  public textures: FakeTexture[];
  public destroyed = false;

  public constructor(options: { data: FakeFontData; textures: FakeTexture[] }) {
    this.data = options.data;
    this.textures = options.textures;
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

/** What the fake renderer recorded. */
export type FakeRenderer = {
  name: "webgpu" | "webgl";
  renders: number;
  resizes: Array<{ width: number; height: number }>;
  gpu?: { device: { lost: Promise<{ reason: string }> } };
  render(stage: FakeContainer): void;
  resize(width: number, height: number): void;
};

/** A fake Pixi application. */
export class FakeApplication {
  /** Set by `createFakePixi`, because a Pixi class takes no constructor options. */
  public static settings: { kind: "webgpu" | "webgl"; failInit: boolean } = {
    kind: "webgpu",
    failInit: false
  };
  /** Every application ever created by the current fake module. */
  public static instances: FakeApplication[] = [];

  public stage = new FakeContainer();
  public canvas: FakeElement = createFakeElement("canvas");
  public renderer!: FakeRenderer;
  public initOptions: Record<string, unknown> | undefined;
  public destroyed = false;
  public destroyArgs: unknown[] = [];
  private loseDevice: ((info: { reason: string }) => void) | undefined;
  private failDevice: ((error: Error) => void) | undefined;

  public constructor() {
    FakeApplication.instances.push(this);
  }

  /**
   * Creates the renderer, or rejects when the fake was told to fail.
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
      name: FakeApplication.settings.kind,
      renders: 0,
      resizes: [],
      render: () => {
        renderer.renders += 1;
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
          })
        }
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
  settings: { kind: "webgpu" | "webgl"; failInit: boolean };
};

/**
 * Creates the fake Pixi module.
 *
 * @param options - Which backend to report and whether `init` should reject.
 * @param options.kind - The backend the fake renderer reports.
 * @param options.failInit - True to make `init` reject, as an unsupported device does.
 * @returns The module to pass to `config.loadPixi`, and the recorded applications.
 */
export function createFakePixi(
  options: { kind?: "webgpu" | "webgl"; failInit?: boolean } = {}
): FakePixi {
  FakeApplication.instances = [];
  FakeApplication.settings = {
    kind: options.kind ?? "webgpu",
    failInit: options.failInit ?? false
  };
  FakeBitmapFont.made.length = 0;
  fakeCache.entries.clear();

  const module = {
    Application: FakeApplication,
    Container: FakeContainer,
    Sprite: FakeSprite,
    NineSliceSprite: FakeNineSliceSprite,
    Texture: FakeTexture,
    Rectangle: FakeRectangle,
    Graphics: FakeGraphics,
    BitmapFont: FakeBitmapFont,
    Cache: fakeCache,
    bitmapFontTextParser: fakeTextParser,
    bitmapFontXMLStringParser: fakeXmlParser
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
