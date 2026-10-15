/**
 * @file The real `pixi.js` module with one class replaced, `Application`, for the tests of what
 * the renderer draws on demand. Not a test. Every display object, filter, uniform group, texture
 * and particle container a test builds is real Pixi; only the GPU is gone. The stand-in's stage is
 * a real `Container`, its screen a real `Rectangle`, its canvas a `fake-dom` element, and its
 * `renderer.render(stage)` only counts. A render into a texture (a kept picture, spec 23) is logged
 * with its arguments, makes its container a render group as Pixi does, and is told to the
 * watchers; only a render of the stage onto the canvas counts as a drawn frame. A render of the warm-up's probe root
 * (spec 27), onto the canvas or into its own texture, and of any other container onto the canvas is logged apart and
 * told to the watchers. It never reads or writes a Pixi field that is not public,
 * never empties a change list and never calls `_onUpdate`: the engine decides from its own marks,
 * so a stand-in that knows nothing of Pixi's internals cannot keep a frozen screen green (spec 14
 * T0). The one exception is asked for: with `builds: true` (spec 26 R2.3) a render also runs Pixi's own exported
 * `RenderGroupSystem` over stand-in pipes, as a real render does. It empties Pixi's change lists and begins every
 * instruction rebuild Pixi decides on the batcher pipe the extension registry holds, so the counting class of a dev
 * build counts Pixi's real rebuilds. The only model in it is the graphics pipe's: a batchable `Graphics` whose context
 * changed asks for a rebuild, as Pixi's `GraphicsPipe.validateRenderable` answers.
 */
import * as pixi from "pixi.js";
import type { PixiModule } from "../types";
import { createFakeElement, type FakeElement } from "./fake-dom";
import { FAKE_PNG } from "./fake-pixi";

/** One `render` call: onto the canvas (`target` undefined) or into a texture, with what it was given. */
export type RenderCall = {
  container: pixi.Container;
  target: pixi.Texture | undefined;
  /** The world transform the container was drawn with, copied at the call; `undefined` for its own. */
  transform: { a: number; b: number; c: number; d: number; tx: number; ty: number } | undefined;
  clear: boolean | undefined;
};

/** What `render` takes: the stage, or Pixi's render options. */
type RenderArguments =
  | pixi.Container
  | {
      container: pixi.Container;
      target?: pixi.Texture;
      transform?: pixi.Matrix;
      clear?: boolean;
      clearColor?: unknown;
    };

/** What the stand-in's renderer offers the engine. */
export type StageRenderer = {
  name: "webgpu" | "webgl";
  /** Device pixels per CSS pixel. */
  resolution: number;
  /** Frames drawn onto the canvas: `render` calls without a target. */
  renders: number;
  /** Every render into a texture but the warm-up's, oldest first: the kept pictures. */
  targets: RenderCall[];
  /**
   * Every render of the warm-up's probe root, onto the canvas or into its texture, and every render onto the canvas of
   * another container that is not the stage, oldest first.
   */
  probes: RenderCall[];
  /** Pixi's background system: the canvas is cleared before every stage pass, Pixi's default. */
  background: { clearBeforeRender: boolean };
  /** Told every render, onto the canvas or into a texture, at the call. */
  watchers: Array<(call: RenderCall) => void>;
  /** Every size `resize` was asked for. */
  sizes: Array<{ width: number; height: number }>;
  render(options: RenderArguments): void;
  resize(width: number, height: number, resolution?: number): void;
  texture: { managedTextures: unknown[] };
  extract: {
    base64(options: unknown): Promise<string>;
    pixels(options: unknown): { pixels: Uint8ClampedArray; width: number; height: number };
  };
  /** WebGPU only: loses the device, as a phone under memory pressure does; the engine builds a new application. */
  loseDevice?(reason?: string): void;
  gpu?: {
    device: {
      lost: Promise<{ reason: string }>;
      createShaderModule(descriptor: { code: string }): {
        getCompilationInfo(): Promise<{ messages: unknown[] }>;
      };
    };
  };
  /**
   * WebGL only: Pixi's runners the pass counter hangs on (`SystemRunner`, public). Nothing emits them, as no GPU pass
   * runs: the stats report the estimate.
   */
  runners?: { prerender: pixi.SystemRunner; renderStart: pixi.SystemRunner };
  /** WebGL only: the render target system's runner and its bound target, for the pass counter. */
  renderTarget?: { onRenderTargetChange: pixi.SystemRunner; renderTarget: { isRoot: boolean } };
  /** Pixi's view system: the canvas's render target, the one the pass counter tells the canvas pass by. */
  view: { renderTarget: { isRoot: boolean } };
};

/** The stand-in application. */
export type StageApplication = {
  stage: pixi.Container;
  screen: pixi.Rectangle;
  canvas: FakeElement;
  renderer: StageRenderer;
  init(options: Record<string, unknown>): Promise<void>;
  destroy(): void;
};

/** The module to hand to `renderer.loadPixi`, and the applications it made. */
export type StagePixi = {
  module: PixiModule;
  /** Every application made, oldest first. */
  applications: StageApplication[];
  /** The application made last. */
  last(): StageApplication;
  /** Frames drawn onto the canvas of the last application. */
  renders(): number;
  /** Renders into a texture of the last application but the warm-up's, oldest first. */
  targets(): RenderCall[];
  /** Renders of the warm-up's probes of the last application, oldest first. */
  probes(): RenderCall[];
};

/**
 * Compiles a WGSL source the stand-in way: every source compiles with no message, so the dev
 * check of `effects` builds its filters.
 *
 * @returns A module whose compilation info has no message.
 */
function compileShader(): { getCompilationInfo(): Promise<{ messages: unknown[] }> } {
  return { getCompilationInfo: () => Promise.resolve({ messages: [] }) };
}

/**
 * What a `render` call was given, with the transform copied: the engine reuses its matrices.
 *
 * @param options - The stage, or Pixi's render options.
 * @returns The call.
 */
function callOf(options: RenderArguments): RenderCall {
  if (options instanceof pixi.Container) {
    return { container: options, target: undefined, transform: undefined, clear: undefined };
  }

  const { transform } = options;

  return {
    container: options.container,
    target: options.target,
    transform:
      transform === undefined
        ? undefined
        : {
            a: transform.a,
            b: transform.b,
            c: transform.c,
            d: transform.d,
            tx: transform.tx,
            ty: transform.ty
          },
    clear: options.clear
  };
}

/** A pipe of the stand-in: every method a no-op, `validateRenderable` answering as given. */
type StandInPipe = Record<string, (...args: unknown[]) => unknown>;

/** The class Pixi's registry holds under `"batch"` of the WebGPU pipes, and the batcher made of it. */
type BatchRegistry = {
  batch: (new (renderer: unknown, adaptor: unknown) => StandInPipe) | undefined;
};

/**
 * A pipe of the stand-in whose `validateRenderable` answers `rebuild`.
 *
 * @param rebuild - What `validateRenderable` answers: true for a changed batchable graphics.
 * @returns The pipe.
 */
function standInPipe(rebuild: boolean): StandInPipe {
  return new Proxy<StandInPipe>(
    {},
    {
      get: (_target, name) => (name === "validateRenderable" ? () => rebuild : () => undefined)
    }
  );
}

/**
 * Tells whether a registered class is a batcher pipe: Pixi files it under `"batch"` of the WebGPU pipes.
 *
 * @param extension - A class handed to `extensions.add` or `remove`.
 * @returns True for a batcher pipe.
 */
function isBatchPipe(extension: unknown): boolean {
  const meta = (extension as { extension?: { name?: unknown; type?: unknown } }).extension;

  return (
    meta?.name === "batch" &&
    Array.isArray(meta.type) &&
    meta.type.includes(pixi.ExtensionType.WebGPUPipes)
  );
}

/**
 * Pixi's extension registry, seen through: every call goes to it, and the batcher pipe it files under `"batch"` is
 * noted, as its named list keeps it (the first class of a name wins, `remove` frees the name).
 *
 * @param registry - Where the batcher pipe class is noted.
 * @returns The registry the module hands out.
 */
function trackingExtensions(registry: BatchRegistry): typeof pixi.extensions {
  const extensions = Object.create(pixi.extensions) as typeof pixi.extensions;

  extensions.add = (...items) => {
    for (const item of items) {
      if (isBatchPipe(item) && registry.batch === undefined) {
        registry.batch = item as unknown as BatchRegistry["batch"];
      }
    }

    pixi.extensions.add(...items);

    return extensions;
  };
  extensions.remove = (...items) => {
    for (const item of items) if (isBatchPipe(item)) registry.batch = undefined;

    pixi.extensions.remove(...items);

    return extensions;
  };

  return extensions;
}

/** Pixi's render group system, its `render` called as Pixi's renderer calls it. */
class StandInRenderGroups extends pixi.RenderGroupSystem {
  /**
   * Renders a container: transforms, validation, the rebuild of a changed structure, the instructions.
   *
   * @param container - The container rendered.
   * @param transform - The transform of a render into a texture; none for the canvas.
   */
  public draw(container: pixi.Container, transform: pixi.Matrix | undefined): void {
    // Pixi's renderer passes no transform for a render onto the canvas; the declaration asks for one.
    this.render({ container, transform } as { container: pixi.Container; transform: pixi.Matrix });
  }
}

/**
 * Pixi's own render group system over stand-in pipes: a render updates the transforms, validates the changed views and
 * rebuilds the instruction list of a render group whose structure changed, beginning it on the registered batcher.
 *
 * @param registry - Where the batcher pipe class is noted.
 * @returns The build of one render call.
 */
function createBuilds(registry: BatchRegistry): (options: RenderArguments) => void {
  const quiet = standInPipe(false);
  const graphics = standInPipe(true);
  const renderer: Record<string, unknown> = {
    limits: { maxBatchableTextures: 16 },
    globalUniforms: { start: () => undefined }
  };
  let made: { from: BatchRegistry["batch"]; pipe: StandInPipe } | undefined;
  const batch = (): StandInPipe => {
    if (registry.batch === undefined) return quiet;
    if (made?.from !== registry.batch)
      made = { from: registry.batch, pipe: new registry.batch(renderer, {}) };

    return made.pipe;
  };

  renderer.renderPipes = new Proxy<Record<string, unknown>>(
    {},
    {
      get: (_target, name) => {
        if (name === "uniformBatch") return undefined;
        if (name === "batch") return batch();

        return name === "graphics" ? graphics : quiet;
      }
    }
  );

  const system = new StandInRenderGroups(renderer as unknown as pixi.Renderer);

  return options => {
    const container = options instanceof pixi.Container ? options : options.container;
    const transform = options instanceof pixi.Container ? undefined : options.transform;

    // A real render makes the container a render group first (`AbstractRenderer.render`).
    container.enableRenderGroup();
    system.draw(container, transform);
  };
}

/**
 * Makes the stand-in renderer of one application.
 *
 * @param screen - The application's screen, which `resize` writes.
 * @param kind - The backend it reports.
 * @param resolution - The resolution it was created with.
 * @param stage - The application's stage: only its render onto the canvas is a drawn frame.
 * @param build - Pixi's render group system to run on every render, with `builds: true`.
 * @returns The renderer.
 */
function createRenderer(
  screen: pixi.Rectangle,
  kind: "webgpu" | "webgl",
  resolution: number,
  stage: pixi.Container,
  build?: (options: RenderArguments) => void
): StageRenderer {
  const canvasTarget = { isRoot: true };
  const renderer: StageRenderer = {
    name: kind,
    resolution,
    view: { renderTarget: canvasTarget },
    renders: 0,
    targets: [],
    probes: [],
    background: { clearBeforeRender: true },
    watchers: [],
    sizes: [],
    render: options => {
      const call = callOf(options);
      // A probe of the warm-up is drawn onto the canvas or into the warm-up's own texture.
      const probe = call.container.label === "renderer.warm";

      // A render into a texture makes its container a render group, as Pixi's own does.
      if (call.target !== undefined) {
        call.container.enableRenderGroup();
        if (!probe) renderer.targets.push(call);
      }

      if (probe || (call.target === undefined && call.container !== stage)) {
        renderer.probes.push(call);
      }

      for (const watcher of renderer.watchers) watcher(call);

      build?.(options);
      if (call.target === undefined && call.container === stage) renderer.renders += 1;
    },
    resize: (width, height, next) => {
      screen.width = width;
      screen.height = height;
      renderer.sizes.push({ width, height });
      if (next !== undefined) renderer.resolution = next;
    },
    texture: { managedTextures: [] },
    extract: {
      base64: () => Promise.resolve(FAKE_PNG),
      pixels: () => ({ pixels: new Uint8ClampedArray(16), width: 2, height: 2 })
    }
  };

  if (kind === "webgpu") {
    let lose: ((info: { reason: string }) => void) | undefined;

    renderer.gpu = {
      // A device that is lost only when a test says so: until then the promise never settles.
      device: {
        lost: new Promise(resolve => {
          lose = resolve;
        }),
        createShaderModule: compileShader
      }
    };
    renderer.loseDevice = (reason = "destroyed") => lose?.({ reason });
  } else {
    renderer.runners = {
      prerender: new pixi.SystemRunner("prerender"),
      renderStart: new pixi.SystemRunner("renderStart")
    };
    renderer.renderTarget = {
      onRenderTargetChange: new pixi.SystemRunner("onRenderTargetChange"),
      renderTarget: canvasTarget
    };
  }

  return renderer;
}

/**
 * Pixi asks a WebGL context once, at its first `GlProgram`, for the fragment precision, and Node
 * has none. It stores the answer before it asks, so one failed probe here leaves `"mediump"` for
 * every program a test builds after it.
 */
function primePrecision(): void {
  try {
    pixi.GlProgram.from({ vertex: "void main() {}", fragment: "void main() {}", name: "probe" });
  } catch {
    // The precision is stored before the context is asked: nothing to do.
  }
}

/**
 * Makes the real Pixi module with the stand-in `Application`. Each call is a module of its own,
 * with its own list of applications.
 *
 * @param options - The backend the renderer reports; WebGPU when left out. With `builds: true` every render also runs
 *   Pixi's render group system, so a dev build counts Pixi's instruction rebuilds.
 * @param options.kind - `"webgpu"` or `"webgl"`.
 * @param options.builds - True to run Pixi's render group system on every render.
 * @returns The module and the applications it made.
 */
export function stagePixi(
  options: { kind?: "webgpu" | "webgl"; builds?: boolean } = {}
): StagePixi {
  const kind = options.kind ?? "webgpu";
  const applications: StageApplication[] = [];
  const registry: BatchRegistry = { batch: undefined };
  const builds = options.builds === true;

  primePrecision();
  // Node has no DOMParser: Pixi's own adapter of a web worker parses the XML of a font, through
  // Pixi's public `DOMAdapter`; everything else stays the browser's.
  pixi.DOMAdapter.set({ ...pixi.BrowserAdapter, parseXML: pixi.WebWorkerAdapter.parseXML });

  /** The stand-in of Pixi's `Application`. */
  class StandIn implements StageApplication {
    public stage = new pixi.Container();
    public screen = new pixi.Rectangle(0, 0, 1080, 1920);
    public canvas: FakeElement = createFakeElement("canvas");
    public renderer: StageRenderer = createRenderer(this.screen, kind, 1, this.stage);
    private readonly build = builds ? createBuilds(registry) : undefined;

    public constructor() {
      applications.push(this);
    }

    /**
     * Takes the resolution the engine asked for, as Pixi's `init` does.
     *
     * @param initOptions - What the renderer asked Pixi for.
     * @returns Resolves at once.
     */
    public init(initOptions: Record<string, unknown>): Promise<void> {
      const resolution = typeof initOptions.resolution === "number" ? initOptions.resolution : 1;

      this.renderer = createRenderer(this.screen, kind, resolution, this.stage, this.build);

      return Promise.resolve();
    }

    /** Frees the stage and its children, as Pixi's `destroy` does. */
    public destroy(): void {
      this.stage.destroy({ children: true });
      this.canvas.remove();
    }
  }

  const module = (builds
    ? { ...pixi, Application: StandIn, extensions: trackingExtensions(registry) }
    : { ...pixi, Application: StandIn }) as unknown as PixiModule;

  return {
    module,
    applications,
    last: () => {
      const app = applications.at(-1);

      if (app === undefined) throw new Error("stage pixi: no application was made");

      return app;
    },
    renders: () => applications.at(-1)?.renderer.renders ?? 0,
    targets: () => applications.at(-1)?.renderer.targets ?? [],
    probes: () => applications.at(-1)?.renderer.probes ?? []
  };
}
