/**
 * @file renderer/monitor — the counting classes of a dev or debug build, the one place that builds every counting
 * subclass. Pixi 8.22 has no counter of its own. Under WebGPU three classes issue every draw of the scene:
 * `GpuBatchAdaptor` (sprites, text), `GpuGraphicsAdaptor` (graphics) and `GpuEncoderSystem` (meshes, tiling sprites,
 * particles, filters); the encoder also begins every render pass Pixi draws a frame with. `FilterSystem` applies
 * every filter on both backends, and the two texture systems upload every source. Counting subclasses of the six go
 * into Pixi's own extension registry before `app.init()`, under the same names. No native prototype and no Pixi
 * instance is patched, and no private field is read. What is not counted (renderer README, "What is not counted"):
 * passes Pixi opens on command encoders of its own — a stand-alone clear between frames, the mipmap generator, the
 * MSAA restore — and draws outside the three classes.
 */
import type { PixiModule } from "../types";
import { COUNT, type CountingClasses, KIND_SLOTS, type MonitorSinks } from "./types";
import { cell } from "./units";

/** The arguments of a batch draw. */
type BatchArguments = Parameters<InstanceType<PixiModule["GpuBatchAdaptor"]>["execute"]>;

/** The graphics pipe and the graphics object of a graphics draw. */
type GraphicsArguments = Parameters<InstanceType<PixiModule["GpuGraphicsAdaptor"]>["execute"]>;

/** The options of an encoder draw. */
type DrawOptions = Parameters<InstanceType<PixiModule["GpuEncoderSystem"]>["draw"]>[0];

/** The options of an indirect encoder draw. */
type IndirectOptions = Parameters<InstanceType<PixiModule["GpuEncoderSystem"]>["drawIndirect"]>[0];

/** The WebGPU renderer an encoder is made for. */
type EncoderRenderer = ConstructorParameters<PixiModule["GpuEncoderSystem"]>[0];

/** The GPU render target a pass begins on. */
type GpuRenderTarget = Parameters<
  InstanceType<PixiModule["GpuEncoderSystem"]>["beginRenderPass"]
>[0];

/** The arguments of one filter apply. */
type ApplyArguments = Parameters<InstanceType<PixiModule["FilterSystem"]>["applyFilter"]>;

/** A texture source a texture system uploads. */
type Source = InstanceType<PixiModule["Texture"]>["source"];

/** Bytes of one pixel of an uncompressed source: the engine's sources are 8-bit RGBA. */
const BYTES_PER_PIXEL = 4;

/**
 * How many native draws the graphics adaptor issued for one graphics object: one `drawIndexed`
 * per instruction of its context. The base class read the same cached record a moment ago, so
 * this is a map lookup.
 *
 * @param graphicsPipe - The graphics pipe the adaptor drew through.
 * @param renderable - The graphics object it drew.
 * @returns The instruction count.
 */
function graphicsDraws(
  graphicsPipe: GraphicsArguments[0],
  renderable: GraphicsArguments[1]
): number {
  const contexts = graphicsPipe.renderer.graphicsContext;

  return contexts.getContextRenderData(renderable.context).instructions.instructionSize;
}

/**
 * The interned index of a filter kind: its place in `kindNames`, a new place while there is
 * room, else 0, "other". An indexed search over at most 32 names: no allocation.
 *
 * @param sinks - The sinks.
 * @param kind - The kind id, or `undefined` for a filter no slot named.
 * @returns The index.
 */
function internKind(sinks: MonitorSinks, kind: string | undefined): number {
  if (kind === undefined) return 0;

  const known = sinks.kindNames.indexOf(kind);

  if (known !== -1) return known;
  if (sinks.kindNames.length >= KIND_SLOTS) return 0;

  sinks.kindNames.push(kind);

  return sinks.kindNames.length - 1;
}

/**
 * The bytes one upload of a source sends: 4 a pixel, or for a compressed source the sum of its
 * levels' `byteLength`.
 *
 * @param source - The source.
 * @returns The bytes.
 */
function uploadBytes(source: Source): number {
  const resource: unknown = source.resource;

  if (source.uploadMethodId !== "compressed" || !Array.isArray(resource)) {
    return source.pixelWidth * source.pixelHeight * BYTES_PER_PIXEL;
  }

  let bytes = 0;

  for (const level of resource) if (ArrayBuffer.isView(level)) bytes += level.byteLength;

  return bytes;
}

/**
 * Counts one upload of a source, in or between frames: an upload between two frames is zeroed
 * by the next `begin()`, so it is lost (Pixi uploads lazily at the first draw, inside a frame).
 * A render target has no upload method and no resource and is not counted.
 *
 * @param sinks - The sinks.
 * @param source - The source the texture system just uploaded.
 */
function countUpload(sinks: MonitorSinks, source: Source): void {
  if (source.uploadMethodId === "unknown") return;
  if (source.resource === null || source.resource === undefined) return;

  const { counts } = sinks;

  counts[COUNT.uploads] = cell(counts, COUNT.uploads) + 1;
  counts[COUNT.uploadBytes] = cell(counts, COUNT.uploadBytes) + uploadBytes(source);
}

/**
 * Builds the six counting subclasses from the module object. They are made at call time,
 * because the base classes arrive with the lazily loaded module. Each keeps the base's `static
 * extension` object as it is, so the registry files it under the same type and name.
 *
 * @param pixi - The loaded Pixi module.
 * @param sinks - What every instance counts into.
 * @returns The six counting classes.
 */
export function createCountingClasses(pixi: PixiModule, sinks: MonitorSinks): CountingClasses {
  const counter = sinks.draws;

  /** Counts one draw per batch: `execute` issues one `drawIndexed`. */
  class CountingBatchAdaptor extends pixi.GpuBatchAdaptor {
    public static override readonly extension = pixi.GpuBatchAdaptor.extension;

    /**
     * Counts the batch, then draws it.
     *
     * @param args - The batcher pipe and the batch.
     */
    public override execute(...args: BatchArguments): void {
      counter.frame += 1;
      super.execute(...args);
    }
  }

  /** Counts one draw per instruction of the graphics context. */
  class CountingGraphicsAdaptor extends pixi.GpuGraphicsAdaptor {
    public static override readonly extension = pixi.GpuGraphicsAdaptor.extension;

    /**
     * Draws the graphics object, then counts its instructions.
     *
     * @param graphicsPipe - The graphics pipe.
     * @param renderable - The graphics object.
     */
    public override execute(
      graphicsPipe: GraphicsArguments[0],
      renderable: GraphicsArguments[1]
    ): void {
      super.execute(graphicsPipe, renderable);
      counter.frame += graphicsDraws(graphicsPipe, renderable);
    }
  }

  /**
   * Counts one draw per `draw` and per `drawIndirect`, one pass per `beginRenderPass` inside a
   * frame, and hands the pass and the render call to the pass sink. Pixi 8.22 builds a new
   * descriptor for every pass it starts and reuses a running pass without calling
   * `beginRenderPass`, so one call is one real pass.
   */
  class CountingEncoderSystem extends pixi.GpuEncoderSystem {
    public static override readonly extension = pixi.GpuEncoderSystem.extension;

    /** The renderer it was made for: Pixi's own `_renderer` is private. */
    private readonly owner: EncoderRenderer;

    /**
     * Keeps the renderer it is made for.
     *
     * @param renderer - The WebGPU renderer.
     */
    public constructor(renderer: EncoderRenderer) {
      super(renderer);
      this.owner = renderer;
    }

    /**
     * Counts the draw, then issues it.
     *
     * @param options - The draw options.
     */
    public override draw(options: DrawOptions): void {
      counter.frame += 1;
      super.draw(options);
    }

    /**
     * Counts the indirect draw, then issues it.
     *
     * @param options - The draw options.
     */
    public override drawIndirect(options: IndirectOptions): void {
      counter.frame += 1;
      super.drawIndirect(options);
    }

    /**
     * Counts the pass and its stencil inside a frame and lets the pass sink record it (and set its
     * timestamp writes), then begins it.
     *
     * @param gpuRenderTarget - The GPU render target with the descriptor Pixi built for the pass.
     * @returns The pass encoder.
     */
    public override beginRenderPass(gpuRenderTarget: GpuRenderTarget): GPURenderPassEncoder {
      if (sinks.inFrame) {
        const { counts } = sinks;
        const { descriptor } = gpuRenderTarget;

        counts[COUNT.passes] = cell(counts, COUNT.passes) + 1;

        if (descriptor.depthStencilAttachment !== undefined) {
          counts[COUNT.stencilPasses] = cell(counts, COUNT.stencilPasses) + 1;
        }

        sinks.passes?.begin(descriptor, this.owner.renderTarget.renderTarget);
      }

      return super.beginRenderPass(gpuRenderTarget);
    }

    /**
     * Ends the running pass, resolves the frame's timestamps into Pixi's own command buffer, then
     * lets Pixi submit it: no extra submit.
     */
    public override postrender(): void {
      this.finishRenderPass();
      sinks.passes?.resolve(this.commandEncoder);
      super.postrender();
    }
  }

  /** Counts every filter apply of a frame, with its pixels and its kind. */
  class CountingFilterSystem extends pixi.FilterSystem {
    public static override readonly extension = pixi.FilterSystem.extension;

    /**
     * Counts the apply and its area inside a frame, notes the kind being applied so a pass begun
     * inside is a filter pass named by it, then applies.
     *
     * @param args - The filter, its input, the output and the clear.
     */
    public override applyFilter(...args: ApplyArguments): void {
      const [filter, input] = args;

      if (sinks.inFrame) {
        const { counts } = sinks;
        const pixels = input.frame.width * input.frame.height * input.source.resolution ** 2;
        const kind = internKind(sinks, sinks.filterKinds?.get(filter));

        counts[COUNT.filterApplies] = cell(counts, COUNT.filterApplies) + 1;
        counts[COUNT.filterPixels] = cell(counts, COUNT.filterPixels) + pixels;
        sinks.kindApplies[kind] = cell(sinks.kindApplies, kind) + 1;
        sinks.kindPixels[kind] = cell(sinks.kindPixels, kind) + pixels;
        sinks.filterKind = kind;
      }

      sinks.filterDepth += 1;

      try {
        super.applyFilter(...args);
      } finally {
        sinks.filterDepth -= 1;
      }
    }
  }

  /** Counts every upload of the WebGPU texture system. */
  class CountingGpuTextureSystem extends pixi.GpuTextureSystem {
    public static override readonly extension = pixi.GpuTextureSystem.extension;

    /**
     * Uploads the source, then counts it; the first upload goes through here too.
     *
     * @param source - The source.
     */
    protected override onSourceUpdate(source: Source): void {
      super.onSourceUpdate(source);
      countUpload(sinks, source);
    }
  }

  /** Counts every upload of the WebGL texture system. */
  class CountingGlTextureSystem extends pixi.GlTextureSystem {
    public static override readonly extension = pixi.GlTextureSystem.extension;

    /**
     * Uploads the source, then counts it; the first upload goes through here too.
     *
     * @param source - The source.
     */
    protected override onSourceUpdate(source: Source): void {
      super.onSourceUpdate(source);
      countUpload(sinks, source);
    }
  }

  return {
    batch: CountingBatchAdaptor,
    graphics: CountingGraphicsAdaptor,
    encoder: CountingEncoderSystem,
    filter: CountingFilterSystem,
    gpuTexture: CountingGpuTextureSystem,
    glTexture: CountingGlTextureSystem
  };
}

/**
 * Swaps Pixi's six counting bases for the counting subclasses in the module's extension
 * registry: `remove` frees each name, `add` puts the subclass in under it. Every application made
 * afterwards counts into `sinks`. The registry is global to the module object, so the remover
 * matters: it swaps Pixi's own classes back. A module that lacks any of the six throws here.
 *
 * @param pixi - The loaded Pixi module.
 * @param sinks - The sinks of the renderer that installs it.
 * @returns The remover.
 */
export function installCounting(pixi: PixiModule, sinks: MonitorSinks): () => void {
  const counting = createCountingClasses(pixi, sinks);
  const bases = [
    pixi.GpuBatchAdaptor,
    pixi.GpuGraphicsAdaptor,
    pixi.GpuEncoderSystem,
    pixi.FilterSystem,
    pixi.GpuTextureSystem,
    pixi.GlTextureSystem
  ];
  const swaps = [
    counting.batch,
    counting.graphics,
    counting.encoder,
    counting.filter,
    counting.gpuTexture,
    counting.glTexture
  ];

  pixi.extensions.remove(...bases);
  pixi.extensions.add(...swaps);

  return (): void => {
    pixi.extensions.remove(...swaps);
    pixi.extensions.add(...bases);
  };
}
