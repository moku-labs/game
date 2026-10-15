/**
 * @file The real `pixi.js` module with one class replaced, `Application`, for the tests of what
 * the renderer draws on demand. Not a test. Every display object, filter, uniform group, texture
 * and particle container a test builds is real Pixi; only the GPU is gone. The stand-in's stage is
 * a real `Container`, its screen a real `Rectangle`, its canvas a `fake-dom` element, and its
 * `renderer.render(stage)` only counts. A render into a texture (a kept picture, spec 23) is logged
 * with its arguments, makes its container a render group as Pixi does, and is told to the
 * watchers; only a render onto the canvas counts as a drawn frame. It never reads or writes a Pixi field that is not public,
 * never empties a change list and never calls `_onUpdate`: the engine decides from its own marks,
 * so a stand-in that knows nothing of Pixi's internals cannot keep a frozen screen green (spec 14
 * T0).
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
  /** Every render into a texture, oldest first. */
  targets: RenderCall[];
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
  gpu?: {
    device: {
      lost: Promise<{ reason: string }>;
      createShaderModule(descriptor: { code: string }): {
        getCompilationInfo(): Promise<{ messages: unknown[] }>;
      };
    };
  };
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
  /** Renders into a texture of the last application, oldest first. */
  targets(): RenderCall[];
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

/**
 * Makes the stand-in renderer of one application.
 *
 * @param screen - The application's screen, which `resize` writes.
 * @param kind - The backend it reports.
 * @param resolution - The resolution it was created with.
 * @returns The renderer.
 */
function createRenderer(
  screen: pixi.Rectangle,
  kind: "webgpu" | "webgl",
  resolution: number
): StageRenderer {
  const renderer: StageRenderer = {
    name: kind,
    resolution,
    renders: 0,
    targets: [],
    watchers: [],
    sizes: [],
    render: options => {
      const call = callOf(options);

      // A render into a texture makes its container a render group, as Pixi's own does.
      if (call.target !== undefined) {
        call.container.enableRenderGroup();
        renderer.targets.push(call);
      }

      for (const watcher of renderer.watchers) watcher(call);

      if (call.target === undefined) renderer.renders += 1;
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
    renderer.gpu = {
      // A device that is never lost: the promise never settles.
      device: { lost: new Promise(() => undefined), createShaderModule: compileShader }
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
 * @param options - The backend the renderer reports; WebGPU when left out.
 * @param options.kind - `"webgpu"` or `"webgl"`.
 * @returns The module and the applications it made.
 */
export function stagePixi(options: { kind?: "webgpu" | "webgl" } = {}): StagePixi {
  const kind = options.kind ?? "webgpu";
  const applications: StageApplication[] = [];

  primePrecision();
  // Node has no DOMParser: Pixi's own adapter of a web worker parses the XML of a font, through
  // Pixi's public `DOMAdapter`; everything else stays the browser's.
  pixi.DOMAdapter.set({ ...pixi.BrowserAdapter, parseXML: pixi.WebWorkerAdapter.parseXML });

  /** The stand-in of Pixi's `Application`. */
  class StandIn implements StageApplication {
    public stage = new pixi.Container();
    public screen = new pixi.Rectangle(0, 0, 1080, 1920);
    public canvas: FakeElement = createFakeElement("canvas");
    public renderer: StageRenderer = createRenderer(this.screen, kind, 1);

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

      this.renderer = createRenderer(this.screen, kind, resolution);

      return Promise.resolve();
    }

    /** Frees the stage and its children, as Pixi's `destroy` does. */
    public destroy(): void {
      this.stage.destroy({ children: true });
      this.canvas.remove();
    }
  }

  const module = { ...pixi, Application: StandIn } as unknown as PixiModule;

  return {
    module,
    applications,
    last: () => {
      const app = applications.at(-1);

      if (app === undefined) throw new Error("stage pixi: no application was made");

      return app;
    },
    renders: () => applications.at(-1)?.renderer.renders ?? 0,
    targets: () => applications.at(-1)?.renderer.targets ?? []
  };
}
