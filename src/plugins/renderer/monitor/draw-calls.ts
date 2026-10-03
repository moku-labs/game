/**
 * @file renderer/monitor — the draw-call counter of a dev build. Pixi 8.21 has no draw counter,
 * and under WebGPU three classes issue every draw: `GpuBatchAdaptor` (sprites, text),
 * `GpuGraphicsAdaptor` (graphics) and `GpuEncoderSystem` (meshes, tiling sprites, particles,
 * filters). Counting subclasses of them go into Pixi's own extension registry before
 * `app.init()`, under the same names. No native prototype and no Pixi instance is patched.
 */
import type { PixiModule } from "../types";
import type { CountingClasses, DrawCounter } from "./types";

/** The arguments of a batch draw. */
type BatchArguments = Parameters<InstanceType<PixiModule["GpuBatchAdaptor"]>["execute"]>;

/** The graphics pipe and the graphics object of a graphics draw. */
type GraphicsArguments = Parameters<InstanceType<PixiModule["GpuGraphicsAdaptor"]>["execute"]>;

/** The options of an encoder draw. */
type DrawOptions = Parameters<InstanceType<PixiModule["GpuEncoderSystem"]>["draw"]>[0];

/** The options of an indirect encoder draw. */
type IndirectOptions = Parameters<InstanceType<PixiModule["GpuEncoderSystem"]>["drawIndirect"]>[0];

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
 * Builds the three counting subclasses from the module object. They are made at call time,
 * because the base classes arrive with the lazily loaded module. Each keeps the base's `static
 * extension` object as it is, so the registry files it under the same type and name.
 *
 * @param pixi - The loaded Pixi module.
 * @param counter - The counter every instance adds its draws to.
 * @returns The counting batch adaptor, graphics adaptor and encoder system.
 */
export function createCountingClasses(pixi: PixiModule, counter: DrawCounter): CountingClasses {
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

  /** Counts one draw per `draw` and per `drawIndirect`. */
  class CountingEncoderSystem extends pixi.GpuEncoderSystem {
    public static override readonly extension = pixi.GpuEncoderSystem.extension;

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
  }

  return {
    batch: CountingBatchAdaptor,
    graphics: CountingGraphicsAdaptor,
    encoder: CountingEncoderSystem
  };
}

/**
 * Swaps Pixi's three draw classes for counting ones in the module's extension registry:
 * `remove` frees each name, `add` puts the subclass in under it. Every WebGPU application made
 * afterwards counts into `counter`. The registry is global to the module object, so the remover
 * matters: it swaps Pixi's own classes back.
 *
 * @param pixi - The loaded Pixi module.
 * @param counter - The counter of the renderer that installs it.
 * @returns The remover.
 */
export function installDrawCounting(pixi: PixiModule, counter: DrawCounter): () => void {
  const counting = createCountingClasses(pixi, counter);
  const bases = [pixi.GpuBatchAdaptor, pixi.GpuGraphicsAdaptor, pixi.GpuEncoderSystem];
  const swaps = [counting.batch, counting.graphics, counting.encoder];

  pixi.extensions.remove(...bases);
  pixi.extensions.add(...swaps);

  return (): void => {
    pixi.extensions.remove(...swaps);
    pixi.extensions.add(...bases);
  };
}
