/**
 * @file renderer/monitor — the counting classes of a dev or debug build, the one place that builds every counting
 * subclass. Pixi 8.22 has no counter of its own. Under WebGPU three classes issue every draw of the scene:
 * `GpuBatchAdaptor` (sprites, text), `GpuGraphicsAdaptor` (graphics) and `GpuEncoderSystem` (meshes, tiling sprites,
 * particles, filters); the encoder also begins every render pass Pixi draws a frame with. `FilterSystem` applies
 * every filter on both backends, the two texture systems upload every source (the WebGPU one also creates and drops
 * every render target), and `BatcherPipe.buildStart` begins
 * every rebuild of a render group's instruction list (spec 26 R2.3). Counting subclasses of the seven go into Pixi's
 * own extension registry before `app.init()`, under the same names. No native prototype and no Pixi instance is
 * patched, and no private field is read. A count runs while its section of the monitor is on (spec 11 R14): one bit
 * test, inline. What is not counted (renderer README, "What is not counted"):
 * passes Pixi opens on command encoders of its own — a stand-alone clear between frames, the mipmap generator, the
 * MSAA restore — and draws outside the three classes.
 */
import type { PixiModule } from "../types";
import {
  COUNT,
  type CountingClasses,
  KIND_SLOTS,
  type MonitorSinks,
  OWNER_SLOTS,
  type OwnerTable,
  SECTION
} from "./types";
import { cellF64 } from "./units";

/** The arguments of a batch draw: the batcher pipe and the batch. */
type BatchArguments = Parameters<InstanceType<PixiModule["GpuBatchAdaptor"]>["execute"]>;

/** The passes and the GPU timer: a pass is handed to the pass sink while either runs. */
const PASS_SECTIONS = SECTION.passes | SECTION.gpu;

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

/** The instruction set a render group rebuilds. */
type InstructionSet = Parameters<InstanceType<PixiModule["BatcherPipe"]>["buildStart"]>[0];

/** The arguments of one filter apply. */
type ApplyArguments = Parameters<InstanceType<PixiModule["FilterSystem"]>["applyFilter"]>;

/** A texture source a texture system uploads. */
type Source = InstanceType<PixiModule["Texture"]>["source"];

/** The GPU texture the WebGPU texture system makes for a source. */
type GpuSourceTexture = ReturnType<InstanceType<PixiModule["GpuTextureSystem"]>["initSource"]>;

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
 * The slot of an owner in the owner table of the frame: its own slot, else the first free one, which it takes. An
 * indexed search over at most 32 slots: no allocation. A full table tracks no more owners.
 *
 * @param owners - The owner table.
 * @param owner - The entity, not 0.
 * @returns The slot, or -1 when the table is full.
 */
function ownerSlot(owners: OwnerTable, owner: number): number {
  let free = -1;

  for (let slot = 0; slot < OWNER_SLOTS; slot += 1) {
    const id = cellF64(owners.ids, slot);

    if (id === owner) return slot;
    if (id === 0 && free === -1) free = slot;
  }

  if (free !== -1) owners.ids[free] = owner;

  return free;
}

/**
 * Counts one filter apply of a frame: its pixels (width times height times resolution squared), its interned kind and
 * its owner, into the frame's counters, the kinds' and the owner table, and notes the kind and the owner being applied
 * so a pass begun inside is named by them. With the `passes` section off it only names them. A plain function apart
 * from the class: indexed stores only.
 *
 * @param sinks - The sinks.
 * @param filter - The filter applied.
 * @param input - Its input texture.
 */
function countApply(
  sinks: MonitorSinks,
  filter: ApplyArguments[0],
  input: ApplyArguments[1]
): void {
  const kind = internKind(sinks, sinks.filterKinds?.get(filter));
  const owner = sinks.filterOwners?.get(filter) ?? 0;

  sinks.filterKind = kind;
  sinks.filterOwner = owner;

  if ((sinks.sections & SECTION.passes) === 0) return;

  const { counts, owners } = sinks;
  const resolution = input.source.resolution;
  const pixels = input.frame.width * input.frame.height * resolution * resolution;
  const slot = owner === 0 ? -1 : ownerSlot(owners, owner);

  counts[COUNT.filterApplies] = cellF64(counts, COUNT.filterApplies) + 1;
  counts[COUNT.filterPixels] = cellF64(counts, COUNT.filterPixels) + pixels;
  sinks.kindApplies[kind] = cellF64(sinks.kindApplies, kind) + 1;
  sinks.kindPixels[kind] = cellF64(sinks.kindPixels, kind) + pixels;

  // The owner's applies of the frame, for the `filter-still` rule (U5).
  if (slot !== -1) {
    owners.applies[slot] = cellF64(owners.applies, slot) + 1;
    owners.pixels[slot] = cellF64(owners.pixels, slot) + pixels;
    owners.kinds[slot] = kind + 1;
  }
}

/**
 * Tells whether a source is a render target: it has no upload method, as `countUpload` tells them apart.
 *
 * @param source - The source.
 * @returns True for a render target.
 */
function isTarget(source: Source): boolean {
  return source.uploadMethodId === "unknown";
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
 * A render target has no upload method and no resource and is not counted, and nothing is while the `passes` section
 * is off.
 *
 * @param sinks - The sinks.
 * @param source - The source the texture system just uploaded.
 */
function countUpload(sinks: MonitorSinks, source: Source): void {
  if ((sinks.sections & SECTION.passes) === 0) return;
  if (source.uploadMethodId === "unknown") return;
  if (source.resource === null || source.resource === undefined) return;

  const { counts } = sinks;

  counts[COUNT.uploads] = cellF64(counts, COUNT.uploads) + 1;
  counts[COUNT.uploadBytes] = cellF64(counts, COUNT.uploadBytes) + uploadBytes(source);
}

/**
 * Builds the seven counting subclasses from the module object. They are made at call time,
 * because the base classes arrive with the lazily loaded module. Each keeps the base's `static
 * extension` object as it is, so the registry files it under the same type and name. The batch pipe extends the one
 * it is given: the routing pipe of the renderer's batched text, which the plugin root injects, so the counting pipe
 * that takes its place routes the same.
 *
 * @param pixi - The loaded Pixi module.
 * @param sinks - What every instance counts into.
 * @param batcherPipe - The batch pipe the counting one extends; Pixi's own when none is given.
 * @returns The seven counting classes (BatcherPipe among them).
 */
export function createCountingClasses(
  pixi: PixiModule,
  sinks: MonitorSinks,
  batcherPipe: PixiModule["BatcherPipe"] = pixi.BatcherPipe
): CountingClasses {
  const counter = sinks.draws;

  /**
   * Counts every rebuild of a render group's instruction list: Pixi's render group system calls `buildStart` once per
   * rebuild and nowhere else. It inherits the static batcher registry, so batchers resolve as before.
   */
  class CountingBatcherPipe extends batcherPipe {
    public static override readonly extension = pixi.BatcherPipe.extension;

    /**
     * Counts the rebuild, in the frame's counter only inside a frame, then begins it.
     *
     * @param instructionSet - The instruction set being rebuilt.
     */
    public override buildStart(instructionSet: InstructionSet): void {
      if ((sinks.sections & SECTION.passes) !== 0) {
        if (sinks.inFrame) sinks.counts[COUNT.rebuilds] = cellF64(sinks.counts, COUNT.rebuilds) + 1;

        sinks.rebuildsWindow += 1;
      }

      super.buildStart(instructionSet);
    }
  }

  /** Counts one draw per batch: `execute` issues one `drawIndexed`. */
  class CountingBatchAdaptor extends pixi.GpuBatchAdaptor {
    public static override readonly extension = pixi.GpuBatchAdaptor.extension;

    /**
     * Counts the batch, then draws it. Its two arguments are named, not spread: a rest array would be made at every
     * batch.
     *
     * @param batchPipe - The batcher pipe.
     * @param batch - The batch.
     */
    public override execute(batchPipe: BatchArguments[0], batch: BatchArguments[1]): void {
      if ((sinks.sections & SECTION.passes) !== 0) counter.frame += 1;

      super.execute(batchPipe, batch);
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

      if ((sinks.sections & SECTION.passes) !== 0) {
        counter.frame += graphicsDraws(graphicsPipe, renderable);
      }
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
      // A pass counter runs: `stats().renderPasses` reads the count from now on (F8).
      sinks.measuring = true;
    }

    /**
     * Counts the draw, then issues it.
     *
     * @param options - The draw options.
     */
    public override draw(options: DrawOptions): void {
      if ((sinks.sections & SECTION.passes) !== 0) counter.frame += 1;

      super.draw(options);
    }

    /**
     * Counts the indirect draw, then issues it.
     *
     * @param options - The draw options.
     */
    public override drawIndirect(options: IndirectOptions): void {
      if ((sinks.sections & SECTION.passes) !== 0) counter.frame += 1;

      super.drawIndirect(options);
    }

    /**
     * Counts the pass inside a frame (every build counts it, F8), its stencil while the `passes` section is on, and
     * lets the pass sink record it and set its timestamp writes while the passes or the GPU timer run, then begins it.
     *
     * @param gpuRenderTarget - The GPU render target with the descriptor Pixi built for the pass.
     * @returns The pass encoder.
     */
    public override beginRenderPass(gpuRenderTarget: GpuRenderTarget): GPURenderPassEncoder {
      if (sinks.inFrame) {
        const { counts } = sinks;
        const { descriptor } = gpuRenderTarget;

        counts[COUNT.passes] = cellF64(counts, COUNT.passes) + 1;

        if (
          (sinks.sections & SECTION.passes) !== 0 &&
          descriptor.depthStencilAttachment !== undefined
        ) {
          counts[COUNT.stencilPasses] = cellF64(counts, COUNT.stencilPasses) + 1;
        }

        if ((sinks.sections & PASS_SECTIONS) !== 0) {
          sinks.passes?.begin(descriptor, this.owner.renderTarget.renderTarget);
        }
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
     * Counts the apply and its area inside a frame, notes the kind and the owner being applied so a pass begun
     * inside is a filter pass named by them, then applies. Its four arguments are named, not spread: a rest array
     * would be made at every apply.
     *
     * @param filter - The filter.
     * @param input - Its input texture.
     * @param output - Where it draws.
     * @param clear - Whether the output is cleared first.
     */
    public override applyFilter(
      filter: ApplyArguments[0],
      input: ApplyArguments[1],
      output: ApplyArguments[2],
      clear: ApplyArguments[3]
    ): void {
      if (sinks.inFrame) countApply(sinks, filter, input);

      sinks.filterDepth += 1;

      try {
        super.applyFilter(filter, input, output, clear);
      } finally {
        sinks.filterDepth -= 1;
      }
    }
  }

  /**
   * Counts every upload of the WebGPU texture system, and every render target it creates and drops: a target's
   * source is created once in `initSource` and dropped once in `onSourceUnload` (a destroy, a pool trim, a lost
   * device). Pixi calls `initSource` again for a source it already made (it answers the same texture then): the set of
   * the targets made tells a new one.
   */
  class CountingGpuTextureSystem extends pixi.GpuTextureSystem {
    public static override readonly extension = pixi.GpuTextureSystem.extension;

    /** The render-target sources this system made and has not dropped. */
    private readonly targets = new WeakSet<Source>();

    /**
     * Makes the GPU texture of a source, and counts a render target made for the first time.
     *
     * @param source - The source.
     * @returns The GPU texture.
     */
    public override initSource(source: Source): GpuSourceTexture {
      const made = isTarget(source) && !this.targets.has(source);
      const texture = super.initSource(source);

      if (made) {
        this.targets.add(source);

        if ((sinks.sections & SECTION.passes) !== 0) {
          sinks.counts[COUNT.targetsCreated] = cellF64(sinks.counts, COUNT.targetsCreated) + 1;
        }
      }

      return texture;
    }

    /**
     * Uploads the source, then counts it; the first upload goes through here too.
     *
     * @param source - The source.
     */
    protected override onSourceUpdate(source: Source): void {
      super.onSourceUpdate(source);
      countUpload(sinks, source);
    }

    /**
     * Drops the source's GPU texture, and counts a render target dropped.
     *
     * @param source - The source.
     */
    protected override onSourceUnload(source: Source): void {
      if (this.targets.delete(source) && (sinks.sections & SECTION.passes) !== 0) {
        sinks.counts[COUNT.targetsDestroyed] = cellF64(sinks.counts, COUNT.targetsDestroyed) + 1;
      }

      super.onSourceUnload(source);
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
    batcher: CountingBatcherPipe,
    batch: CountingBatchAdaptor,
    graphics: CountingGraphicsAdaptor,
    encoder: CountingEncoderSystem,
    filter: CountingFilterSystem,
    gpuTexture: CountingGpuTextureSystem,
    glTexture: CountingGlTextureSystem
  };
}

/**
 * Swaps Pixi's seven counting bases for the counting subclasses in the module's extension
 * registry: `remove` frees each name, `add` puts the subclass in under it. Every application made
 * afterwards counts into `sinks`. The registry is global to the module object, so the remover
 * matters: it swaps Pixi's own classes back. A module that lacks any of the seven throws here.
 *
 * @param pixi - The loaded Pixi module.
 * @param sinks - The sinks of the renderer that installs it.
 * @param batcherPipe - The batch pipe the counting one extends: the routing pipe of the batched text.
 * @returns The remover.
 */
export function installCounting(
  pixi: PixiModule,
  sinks: MonitorSinks,
  batcherPipe: PixiModule["BatcherPipe"] = pixi.BatcherPipe
): () => void {
  const counting = createCountingClasses(pixi, sinks, batcherPipe);
  const bases = [
    pixi.BatcherPipe,
    pixi.GpuBatchAdaptor,
    pixi.GpuGraphicsAdaptor,
    pixi.GpuEncoderSystem,
    pixi.FilterSystem,
    pixi.GpuTextureSystem,
    pixi.GlTextureSystem
  ];
  const swaps = [
    counting.batcher,
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

/**
 * Swaps Pixi's encoder alone for one that counts the render passes of a frame, the production half
 * of F8: `stats().renderPasses` is measured on the GPU path in every build. One boolean test and one
 * typed-array increment per real pass; no ring, no record, no label, no allocation. A pass outside
 * a frame (an extract, a capture) is not counted. The registry is global to the module object, so
 * the remover swaps Pixi's own class back.
 *
 * @param pixi - The loaded Pixi module.
 * @param sinks - The sinks of the renderer that installs it.
 * @returns The remover.
 */
export function installPassCounting(pixi: PixiModule, sinks: MonitorSinks): () => void {
  /** Counts one pass per `beginRenderPass` inside a frame, and nothing else. */
  class PassCountingEncoder extends pixi.GpuEncoderSystem {
    public static override readonly extension = pixi.GpuEncoderSystem.extension;

    /**
     * Makes the encoder, and tells the monitor a counter runs.
     *
     * @param renderer - The WebGPU renderer.
     */
    public constructor(renderer: EncoderRenderer) {
      super(renderer);
      sinks.measuring = true;
    }

    /**
     * Counts the pass inside a frame, then begins it.
     *
     * @param gpuRenderTarget - The GPU render target with the descriptor Pixi built for the pass.
     * @returns The pass encoder.
     */
    public override beginRenderPass(gpuRenderTarget: GpuRenderTarget): GPURenderPassEncoder {
      if (sinks.inFrame) sinks.counts[COUNT.passes] = cellF64(sinks.counts, COUNT.passes) + 1;

      return super.beginRenderPass(gpuRenderTarget);
    }
  }

  pixi.extensions.remove(pixi.GpuEncoderSystem);
  pixi.extensions.add(PassCountingEncoder);

  return (): void => {
    pixi.extensions.remove(PassCountingEncoder);
    pixi.extensions.add(pixi.GpuEncoderSystem);
  };
}
