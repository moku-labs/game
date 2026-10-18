/**
 * @file renderer — a WebGPU frame over the real pixi.js render target, encoder, pipeline, stencil and colour-mask
 * systems and Pixi's own stencil mask pipe, on a recording stand-in of the GPU: no device, no page. The canvas is a
 * `CanvasSource` over a fake canvas whose `webgpu` context hands out one texture; every pass the encoder begins is kept
 * with the load and store operations of its descriptor and the draws recorded into it, every texture copy in the order
 * it came. The steps of a frame are Pixi's own calls, in Pixi's order: `renderStart` binds the canvas, a filter binds
 * its input with a clear, finishes the pass at its pop and binds the canvas again without one for its apply (as
 * `FilterSystem` does), a mask runs the four instructions of `StencilMaskPipe`. The unit and the perf files of the
 * lazy canvas pass share it. Not a test file.
 */
import * as pixi from "pixi.js";
import { vi } from "vitest";

/** The systems a stage is built with: the lazy canvas pass's, or Pixi's own for a baseline. */
export type StageClasses = {
  targets: typeof pixi.GpuRenderTargetSystem;
  pipeline: typeof pixi.PipelineSystem;
  /** The encoder; Pixi's own when left out. */
  encoder?: typeof pixi.GpuEncoderSystem;
  /** A canvas with multisampling, on a tiled GPU, as a phone's; none when left out. */
  antialias?: boolean;
};

/** One render pass the stand-in GPU began: what its descriptor asked for and what was recorded into it. */
export type StagePass = {
  /** `"canvas"`, or the label of the texture it draws into. */
  target: string;
  /** The colour attachment's load operation. */
  load: string;
  /** The colour it clears to, for a clear. */
  clearValue: readonly number[] | undefined;
  /** `"load/store"`-style operations of the stencil and the depth, `undefined` without a depth-stencil attachment. */
  stencil: string | undefined;
  depth: string | undefined;
  /** Draws recorded into it. */
  draws: number;
};

/** The stand-in GPU: the passes and the copies of the recorded frames, in order. */
export type StageGpu = {
  passes: StagePass[];
  /** Every pass begun (`begin <target>`), ended (`end`) and every copy (`copy <from>`), in order. */
  log: string[];
  /** Passes begun since the stage was made, recorded or not. */
  begun: number;
  /** False while a perf window runs: nothing is kept, only `begun` counts. */
  record: boolean;
};

/** A stage: the real systems over the stand-in GPU, and the steps of a frame. */
export type PassStage = {
  gpu: StageGpu;
  renderer: StageRenderer;
  /** The canvas's render target, as `ViewSystem` makes it. */
  canvas: pixi.RenderTarget;
  /**
   * One render call to the canvas, as Pixi's runners run it: `renderStart`, the steps, `renderEnd`, `postrender`.
   *
   * @returns One line per pass the frame began (see `describePass`).
   */
  frame(steps: () => void, clear?: boolean): readonly string[];
  /** The first half of `frame`, for a perf window that draws inside one frame: `renderStart` with the clear. */
  open(): void;
  /** The second half of `frame`: `renderEnd` and `postrender`. */
  close(): void;
  /** One draw on the bound target, with Pixi's 2D state. */
  draw(): void;
  /** One draw that tests and writes depth. */
  drawDepth(): void;
  /** One batch, as `GpuBatchAdaptor` draws it: its geometry set first, then its pipeline, then the indexed draw. */
  drawBatch(): void;
  /** One render bundle replayed on the bound target, recorded for the canvas's state. */
  replayBundle(): void;
  /** A filter: its input bound with a clear, the content drawn into it, the pass finished, the apply on the canvas. */
  withFilter(content?: () => void): void;
  /** The filter input bound with a clear and the content drawn into it, and no way back to the canvas. */
  offscreen(content?: () => void): void;
  /** A stencil mask pushed on the bound target: Pixi's four mask instructions around one mask draw. */
  pushMask(): void;
  /** The mask popped again. */
  popMask(): void;
  /** A copy of the canvas into a texture, as a backdrop filter reads what was drawn under it. */
  copyCanvas(): void;
  /** A copy of the canvas's depth into a depth texture. */
  copyCanvasDepth(): void;
  /** Binds the canvas again without a clear, as a filter's apply does before it draws. */
  bindCanvas(): void;
};

/** The renderer the systems are built for: the members they read, the systems themselves set by the stage. */
export type StageRenderer = {
  type: number;
  name: string;
  gc: { addCollection(): void; now: number };
  runners: Record<string, pixi.SystemRunner>;
  gpu: { device: unknown };
  texture: unknown;
  state: unknown;
  shader: unknown;
  limits: unknown;
  renderTarget: pixi.GpuRenderTargetSystem;
  encoder: pixi.GpuEncoderSystem;
  pipeline: pixi.PipelineSystem;
  stencil: pixi.GpuStencilSystem;
  colorMask: pixi.GpuColorMaskSystem;
};

/** What a canvas pass's colour attachment views: the canvas's current texture. */
const CANVAS_VIEW = Object.freeze({ label: "canvas" });

/** The texture the canvas context hands out. */
const CANVAS_TEXTURE = Object.freeze({ label: "canvas", createView: (): object => CANVAS_VIEW });

/** A draw's geometry: one triangle list with no vertex buffer, keyed so Pixi never generates its layout. */
const GEOMETRY = {
  _layoutKey: 1,
  topology: "triangle-list",
  buffers: [],
  attributes: {},
  indexBuffer: undefined,
  vertexCount: 6,
  instanceCount: 1
};

/** A draw's program: no attribute, no bind group, two stand-in shader sources. */
const PROGRAM = {
  _layoutKey: 1,
  _attributeLocationsKey: 1,
  attributeData: {},
  layout: [],
  name: "stage",
  vertex: { source: "vertex", entryPoint: "main" },
  fragment: { source: "fragment", entryPoint: "main" }
};

/** A draw's shader. */
const SHADER = { gpuProgram: PROGRAM, groups: [], _overrides: undefined };

/** The vertex buffer of a batch. */
const BATCH_BUFFER = { label: "batch vertices" };

/** A batch's geometry: one attribute in one vertex buffer, as Pixi's batcher geometry has them. */
const BATCH_GEOMETRY = {
  _layoutKey: 2,
  topology: "triangle-list",
  buffers: [BATCH_BUFFER],
  attributes: {
    aPosition: { buffer: BATCH_BUFFER, stride: 8, offset: 0, format: "float32x2", instance: false }
  },
  indexBuffer: undefined
};

/** A batch's program: the one attribute at location 0. */
const BATCH_PROGRAM = {
  ...PROGRAM,
  _layoutKey: 2,
  _attributeLocationsKey: 2,
  attributeData: { aPosition: { location: 0, format: "float32x2" } }
};

/** Pixi's 2D state: no depth test, no depth write. */
const STATE_2D = pixi.State.for2d();

/** A state that tests and writes depth, as a 3D mesh's. */
const STATE_DEPTH = pixi.State.for2d();

STATE_DEPTH.depthTest = true;
STATE_DEPTH.depthMask = true;

/** The four instructions of a stencil mask, as `StencilMaskPipe` builds them. */
const MASK = {
  pushBegin: { action: "pushMaskBegin", inverse: false },
  pushEnd: { action: "pushMaskEnd", inverse: false },
  popBegin: { action: "popMaskBegin", inverse: false },
  popEnd: { action: "popMaskEnd" }
};

/** The usage bits Pixi's canvas configuration reads; the page defines them on a WebGPU browser. */
const TEXTURE_USAGE = {
  COPY_SRC: 1,
  COPY_DST: 2,
  TEXTURE_BINDING: 4,
  STORAGE_BINDING: 8,
  RENDER_ATTACHMENT: 16
};

/** What a frame of a quiet stage answers: nothing is recorded. */
const NO_PASSES: readonly string[] = Object.freeze([]);

/** The colour every frame clears the canvas to. */
export const STAGE_CLEAR: [number, number, number, number] = [0.1, 0.2, 0.3, 1];

/**
 * One line of a pass: its target, its colour load, its stencil and depth operations when it has the attachment, and
 * its draws.
 *
 * @param pass - The pass.
 * @returns The line, such as `"canvas: clear, stencil clear/discard, depth clear/discard, 2 draws"`.
 */
export function describePass(pass: StagePass): string {
  const attachment =
    pass.stencil === undefined ? "" : `, stencil ${pass.stencil}, depth ${pass.depth ?? "none"}`;

  return `${pass.target}: ${pass.load}${attachment}, ${pass.draws} draws`;
}

/** A depth-stencil attachment of a descriptor, as Pixi builds it. */
type DescriptorStencil = {
  stencilLoadOp?: string;
  stencilStoreOp?: string;
  depthLoadOp?: string;
  depthStoreOp?: string;
};

/** A colour attachment of a descriptor, as Pixi builds it. */
type DescriptorColor = {
  view: unknown;
  resolveTarget?: unknown;
  loadOp: string;
  clearValue?: readonly number[];
};

/**
 * The label of what a colour attachment views: the canvas, or the texture source Pixi's texture system stand-in
 * answers as its view.
 *
 * @param view - The view.
 * @returns `"canvas"` or the source's label.
 */
function targetOf(view: unknown): string {
  if (view === CANVAS_VIEW) return "canvas";

  const label: unknown = Reflect.get(view as object, "label");

  return typeof label === "string" ? label : "texture";
}

/**
 * The operations of one aspect, `"load/store"`.
 *
 * @param load - The load operation.
 * @param store - The store operation.
 * @returns The pair, or `undefined` when the descriptor leaves the aspect out.
 */
function opsOf(load: string | undefined, store: string | undefined): string | undefined {
  return load === undefined && store === undefined ? undefined : `${load}/${store}`;
}

/**
 * Creates the stand-in GPU: a device whose command encoder records the passes and the copies, and two pass encoders
 * handed out in turn, so two passes in a row are two objects, as a real device's are.
 *
 * @returns The record and the device.
 */
function createGpu(): { gpu: StageGpu; device: unknown } {
  const gpu: StageGpu = { passes: [], log: [], begun: 0, record: true };
  let open: StagePass | undefined;

  /** Counts a draw into the open pass. */
  const drawn = (): void => {
    if (open !== undefined) open.draws += 1;
  };
  /**
   * Makes one pass encoder.
   *
   * @returns The encoder.
   */
  const passEncoder = (): object => ({
    setViewport: (): void => undefined,
    setPipeline: (): void => undefined,
    setVertexBuffer: (): void => undefined,
    setIndexBuffer: (): void => undefined,
    setBindGroup: (): void => undefined,
    setStencilReference: (): void => undefined,
    executeBundles: (): void => undefined,
    draw: drawn,
    drawIndexed: drawn,
    end: (): void => {
      open = undefined;

      if (gpu.record) gpu.log.push("end");
    }
  });
  const passes: readonly [object, object] = [passEncoder(), passEncoder()];
  const commands = {
    beginRenderPass: (descriptor: {
      colorAttachments: DescriptorColor[];
      depthStencilAttachment?: DescriptorStencil;
    }): object => {
      gpu.begun += 1;

      if (gpu.record) {
        const color = descriptor.colorAttachments[0];
        const stencil = descriptor.depthStencilAttachment;
        const pass: StagePass = {
          target: targetOf(color?.resolveTarget ?? color?.view),
          load: color?.loadOp ?? "none",
          clearValue: color?.loadOp === "clear" ? [...(color.clearValue ?? [])] : undefined,
          stencil:
            stencil === undefined
              ? undefined
              : opsOf(stencil.stencilLoadOp, stencil.stencilStoreOp),
          depth:
            stencil === undefined ? undefined : opsOf(stencil.depthLoadOp, stencil.depthStoreOp),
          draws: 0
        };

        gpu.passes.push(pass);
        gpu.log.push(`begin ${pass.target}`);
        open = pass;
      }

      return gpu.begun % 2 === 0 ? passes[0] : passes[1];
    },
    copyTextureToTexture: (source: { texture: unknown }): void => {
      if (gpu.record)
        gpu.log.push(
          `copy ${targetOf(source.texture === CANVAS_TEXTURE ? CANVAS_VIEW : source.texture)}`
        );
    },
    finish: (): object => CANVAS_VIEW
  };
  const device = {
    createCommandEncoder: (): object => commands,
    queue: { submit: (): void => undefined },
    createRenderPipeline: (descriptor: { label: string }): object => ({ label: descriptor.label }),
    createShaderModule: (): object => ({})
  };

  return { gpu, device };
}

/**
 * Builds the systems of one WebGPU renderer on the stand-in GPU, in Pixi's order, and runs their context change.
 *
 * @param classes - The render target, pipeline and encoder classes.
 * @param device - The stand-in device.
 * @returns The renderer with its systems.
 */
function createRenderer(classes: StageClasses, device: unknown): StageRenderer {
  const views = {
    getTextureRenderTargetView: (source: unknown): unknown => source,
    getTextureView: (source: unknown): unknown => source,
    getGpuSource: (source: unknown): unknown => source
  };
  const renderer = {
    type: pixi.RendererType.WEBGPU,
    name: "webgpu",
    gc: { addCollection: (): void => undefined, now: 0 },
    runners: {
      contextChange: new pixi.SystemRunner("contextChange"),
      destroy: new pixi.SystemRunner("destroy"),
      renderStart: new pixi.SystemRunner("renderStart"),
      renderEnd: new pixi.SystemRunner("renderEnd"),
      postrender: new pixi.SystemRunner("postrender")
    },
    gpu: { device },
    texture: views,
    state: { getColorTargets: (): object[] => [{ format: "bgra8unorm" }] },
    shader: { getProgramData: (): object => ({ pipeline: {} }) },
    limits: { supportsOverrideConstants: true },
    buffer: { updateBuffer: (buffer: unknown): unknown => buffer },
    // Not tiled: a multisampled canvas loads its samples back with no restore pass, which the stand-in cannot draw.
    device: { extensions: { tileBased: false } }
  } as unknown as StageRenderer;
  const host = renderer as unknown as ConstructorParameters<typeof pixi.GpuRenderTargetSystem>[0];
  const Encoder = classes.encoder ?? pixi.GpuEncoderSystem;

  renderer.encoder = new Encoder(host);
  renderer.renderTarget = new classes.targets(host);
  renderer.pipeline = new classes.pipeline(host);
  renderer.stencil = new pixi.GpuStencilSystem(host);
  renderer.colorMask = new pixi.GpuColorMaskSystem(host);

  // Pixi adds every system to every runner that names one of its methods, in the order the systems were made.
  for (const system of [
    renderer.encoder,
    renderer.renderTarget,
    renderer.pipeline,
    renderer.stencil,
    renderer.colorMask
  ]) {
    for (const runner of Object.values(renderer.runners)) runner.add(system);
  }

  renderer.runners.contextChange?.emit(renderer.gpu);

  return renderer;
}

/**
 * Creates a stage: the systems of one renderer on the stand-in GPU, a canvas of 384 × 832 and a filter input texture.
 *
 * @param classes - The render target and pipeline systems under test, Pixi's own for a baseline, and the encoder.
 * @returns The stage.
 */
export function createPassStage(classes: StageClasses): PassStage {
  vi.stubGlobal("GPUTextureUsage", TEXTURE_USAGE);

  const { gpu, device } = createGpu();
  const renderer = createRenderer(classes, device);
  const context = {
    configure: (): void => undefined,
    unconfigure: (): void => undefined,
    getCurrentTexture: (): object => CANVAS_TEXTURE
  };
  const element = { width: 384, height: 832, style: {}, getContext: (): object => context };
  const source = new pixi.CanvasSource({
    resource: element as unknown as HTMLCanvasElement,
    antialias: classes.antialias === true
  });
  const canvas = new pixi.RenderTarget({ colorTextures: [source], isRoot: true });
  const input = pixi.RenderTexture.create({ width: 64, height: 64, label: "filter input" });
  const back = pixi.RenderTexture.create({ width: 64, height: 64, label: "back" });
  const depth = new pixi.Texture({
    source: new pixi.TextureSource({ width: 64, height: 64, format: "depth24plus-stencil8" })
  });

  input.source.label = "filter input";

  const targets = renderer.renderTarget;
  const encoder = renderer.encoder;
  const masks = new pixi.StencilMaskPipe(
    renderer as unknown as ConstructorParameters<typeof pixi.StencilMaskPipe>[0]
  );
  const start = { target: canvas, clear: pixi.CLEAR.ALL, clearColor: STAGE_CLEAR };
  const keep = { target: canvas, clear: pixi.CLEAR.NONE, clearColor: STAGE_CLEAR };
  const toInput = { target: input, clear: true };
  const toCanvas = { target: canvas, clear: false };
  const origin = { x: 0, y: 0 };
  const size = { width: 16, height: 16 };
  const runners = renderer.runners;
  // Read before any frame: the pipeline system's state then is the canvas's, a colour target and no depth-stencil.
  const bundle = {
    stateKey: renderer.pipeline.bundleStateKey,
    device,
    gpuBundle: {}
  } as unknown as pixi.RenderBundle;
  /** Draws with a state. */
  const drawWith = (state: pixi.State): void => {
    encoder.draw({
      geometry: GEOMETRY as unknown as pixi.Geometry,
      shader: SHADER as unknown as pixi.Shader,
      state
    });
  };
  /** One draw with the 2D state. */
  const draw = (): void => drawWith(STATE_2D);
  /** One mask instruction. */
  const mask = (instruction: object): void => {
    masks.execute(instruction as Parameters<pixi.StencilMaskPipe["execute"]>[0]);
  };

  return {
    gpu,
    renderer,
    canvas,
    frame: (steps, clear = true) => {
      const first = gpu.passes.length;

      runners.renderStart?.emit(clear ? start : keep);
      steps();
      runners.renderEnd?.emit();
      runners.postrender?.emit();

      return gpu.record ? gpu.passes.slice(first).map(pass => describePass(pass)) : NO_PASSES;
    },
    open: () => {
      runners.renderStart?.emit(start);
    },
    close: () => {
      runners.renderEnd?.emit();
      runners.postrender?.emit();
    },
    draw,
    drawDepth: () => drawWith(STATE_DEPTH),
    drawBatch: () => {
      const geometry = BATCH_GEOMETRY as unknown as pixi.Geometry;
      const program = BATCH_PROGRAM as unknown as pixi.GpuProgram;

      encoder.setGeometry(geometry, program);
      encoder.setPipeline(renderer.pipeline.getPipeline(geometry, program, STATE_2D));
      encoder.renderPassEncoder.drawIndexed(6, 1, 0);
    },
    replayBundle: () => {
      encoder.executeBundle(bundle);
    },
    withFilter: content => {
      targets.bind(toInput);
      content?.();
      targets.finishRenderPass();
      targets.bind(toCanvas);
      draw();
    },
    offscreen: content => {
      targets.bind(toInput);
      content?.();
    },
    pushMask: () => {
      mask(MASK.pushBegin);
      draw();
      mask(MASK.pushEnd);
    },
    popMask: () => {
      mask(MASK.popBegin);
      draw();
      mask(MASK.popEnd);
    },
    copyCanvas: () => {
      targets.copyToTexture(canvas, back, origin, size, origin);
    },
    copyCanvasDepth: () => {
      targets.copyDepthTexture(canvas, depth, origin, size, origin);
    },
    bindCanvas: () => {
      targets.bind(toCanvas);
    }
  };
}
