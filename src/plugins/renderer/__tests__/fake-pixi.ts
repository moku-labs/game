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

/** A fake Pixi texture. */
export class FakeTexture {
  /** The 1x1 white texture the placeholder is drawn with. */
  public static readonly WHITE = new FakeTexture({
    source: { width: 1, height: 1, destroyed: false }
  });

  public source: FakeSource;
  public defaultBorders: { left: number; top: number; right: number; bottom: number } | undefined;
  public destroyed = false;
  public destroyCalls = 0;

  public constructor(options: {
    source?: FakeSource;
    defaultBorders?: { left: number; top: number; right: number; bottom: number };
  }) {
    this.source = options.source ?? { width: 64, height: 64, destroyed: false };
    this.defaultBorders = options.defaultBorders;
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

  /** Width of the texture. */
  public get width(): number {
    return this.source.width;
  }

  /** Height of the texture. */
  public get height(): number {
    return this.source.height;
  }

  /**
   * Frees the texture, and its source when asked.
   *
   * @param destroySource - True to free the source too.
   */
  public destroy(destroySource?: boolean): void {
    this.destroyCalls += 1;
    this.destroyed = true;
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
  public children: FakeContainer[] = [];
  public parent: FakeContainer | null = null;
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
          lost: new Promise<{ reason: string }>(resolve => {
            this.loseDevice = resolve;
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
   * Frees the application.
   *
   * @param rendererOptions - Pixi's renderer destroy options.
   * @param options - Pixi's scene destroy options.
   */
  public destroy(rendererOptions?: unknown, options?: unknown): void {
    this.destroyed = true;
    this.destroyArgs = [rendererOptions, options];
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

  const module = {
    Application: FakeApplication,
    Container: FakeContainer,
    Sprite: FakeSprite,
    NineSliceSprite: FakeNineSliceSprite,
    Texture: FakeTexture
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
