/**
 * @file renderer/host — SPIKE (hot path 5, second try): the render pipe of a shape view (`renderPipeId` `mokuShape`).
 * A shape view carries up to two batchable parts under the registry symbol `moku-shape-parts`, its fill and its
 * stroke, the way Pixi's graphics pipe hands a graphics' batches to the default batcher, so they batch with sprites.
 * Unlike Pixi's graphics pipe it asks for a rebuild of the stage's instructions only when the parts or the size of
 * their buffers changed; a shape that moved its vertices is packed again in place.
 */
import type { PixiModule } from "../types";

/** The key of a shape view's parts: the registry symbol the sync module writes. */
const PARTS: unique symbol = Symbol.for("moku-shape-parts") as never;

/** A part as the default batcher reads it. */
type Part = InstanceType<PixiModule["BatchableGraphics"]>;

/** The parts of a shape view. */
type Parts = { list: Part[]; count: number; changed: boolean };

/** A shape view as the pipe reads it. */
type ShapeView = { [PARTS]: Parts; roundPixels: boolean };

/** The renderer, as the pipe reads it. */
type Renderer = {
  roundPixels: boolean;
  renderPipes: { batch: { addToBatch(element: Part, instructionSet: unknown): void } };
};

/**
 * Builds the shape pipe class for the loaded Pixi module.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The pipe class, with its extension record.
 */
export function createShapePipe(pixi: PixiModule): unknown {
  /** The pipe: adds a shape's parts to the batch, packs them again on a change. */
  class ShapePipe {
    public static readonly extension = {
      type: [pixi.ExtensionType.WebGLPipes, pixi.ExtensionType.WebGPUPipes],
      name: "mokuShape"
    };

    private readonly renderer: Renderer;

    /**
     * A pipe for one renderer.
     *
     * @param renderer - The renderer.
     */
    public constructor(renderer: Renderer) {
      this.renderer = renderer;
    }

    /**
     * Whether the stage's instructions must be built again: the parts or their buffers changed.
     *
     * @param view - The shape view.
     * @returns True when they changed.
     */
    public validateRenderable(view: ShapeView): boolean {
      return view[PARTS].changed;
    }

    /**
     * Adds the parts to the batch.
     *
     * @param view - The shape view.
     * @param instructionSet - The instructions being built.
     */
    public addRenderable(view: ShapeView, instructionSet: unknown): void {
      const parts = view[PARTS];
      const round: 0 | 1 = this.renderer.roundPixels || view.roundPixels ? 1 : 0;

      parts.changed = false;

      for (let index = 0; index < parts.count; index++) {
        const part = parts.list[index];

        if (part === undefined) continue;
        part.roundPixels = round;
        this.renderer.renderPipes.batch.addToBatch(part, instructionSet);
      }
    }

    /**
     * Packs the parts again where they are in the batch.
     *
     * @param view - The shape view.
     */
    public updateRenderable(view: ShapeView): void {
      const parts = view[PARTS];

      for (let index = 0; index < parts.count; index++) {
        const part = parts.list[index];

        part?._batcher?.updateElement(part);
      }
    }

    /** Nothing to free: the views own their parts. */
    public destroy(): void {
      // The parts belong to the views.
    }
  }

  return ShapePipe;
}
