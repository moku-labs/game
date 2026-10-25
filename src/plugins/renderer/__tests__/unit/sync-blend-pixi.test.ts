import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Sprite, type SpriteBlend, Transform } from "../../components";
import { type Drawn, startDrawn } from "../demand-harness";
import { stubCanvasDocument } from "../sdf-text-stage";

// ---------------------------------------------------------------------------
// Unit test against the real pixi.js module, no GPU: what a blend costs (F68). The sprites `sync` wrote, blends and
// all, are built into an instruction list by Pixi's own render group system over Pixi's own `BatcherPipe`,
// `SpritePipe` and `BlendModePipe`, as a rebuild of a render group builds them. `"add"` and `"screen"` are native
// blends: no filter pass, one batch per run of equal blends in draw order.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) drawn.mock.stop();
  vi.unstubAllGlobals();
});

/** Pixi's batch adaptor stand-in: the draw calls, which draw nothing without a GPU. */
const adaptor = { start: (): void => undefined, execute: (): void => undefined };

/** Pixi's render group system, its `render` called as Pixi's renderer calls it. */
class RenderGroups extends pixi.RenderGroupSystem {
  /**
   * Renders a container onto the canvas: transforms, the rebuild of its changed structure, the instructions.
   *
   * @param container - The container rendered, a render group.
   */
  public draw(container: pixi.Container): void {
    // Pixi's renderer passes no transform for a render onto the canvas; the declaration asks for one.
    this.render({ container } as { container: pixi.Container; transform: pixi.Matrix });
  }
}

/**
 * Builds the instruction list of a container the way a render of its render group builds it: Pixi's render group
 * system updates the transforms (the group blend modes among them) and collects the renderables into Pixi's batcher,
 * sprite and blend mode pipes. The canvas document is stubbed for Pixi's GLSL compile while it runs.
 *
 * @param container - The container rendered, made a render group as a real render makes it.
 * @returns The instructions, in order.
 */
function buildOf(container: pixi.Container): pixi.Instruction[] {
  const page = globalThis.document;

  stubCanvasDocument();

  try {
    const renderer = {
      name: "webgpu",
      uid: 1,
      _roundPixels: 0,
      resolution: 1,
      limits: { maxBatchableTextures: 16 },
      gc: { addResourceHash: (): void => undefined, addCollection: (): void => undefined, now: 0 },
      runners: {
        contextChange: { add: (): void => undefined },
        prerender: { add: (): void => undefined }
      },
      globalUniforms: { start: (): void => undefined },
      renderPipes: {} as Record<string, unknown>
    };
    const asRenderer = renderer as unknown as pixi.Renderer;
    const blendMode = new pixi.BlendModePipe(asRenderer);

    renderer.renderPipes = {
      batch: new pixi.BatcherPipe(
        asRenderer,
        adaptor as unknown as ConstructorParameters<typeof pixi.BatcherPipe>[1]
      ),
      sprite: new pixi.SpritePipe(asRenderer),
      blendMode,
      colorMask: { buildStart: (): void => undefined }
    };
    // The renderer's prerender runner, at the start of every render.
    blendMode.prerender();
    container.enableRenderGroup();
    new RenderGroups(asRenderer).draw(container);

    const set = container.renderGroup?.instructionSet;

    return set === undefined ? [] : set.instructions.slice(0, set.instructionSize);
  } finally {
    vi.stubGlobal("document", page);
  }
}

/**
 * Spawns one 40 × 40 sprite per blend, left to right in draw order, and runs the frame that builds their views.
 *
 * @param drawn - The running renderer.
 * @param blends - The blend of each sprite; `undefined` leaves the field out.
 * @returns The entities.
 */
function spritesOf(drawn: Drawn, blends: ReadonlyArray<SpriteBlend | undefined>): Entity[] {
  const entities = blends.map((blend, index) =>
    drawn.spawn(
      Transform({ x: 20 + index * 50, y: 100 }),
      Sprite({
        texture: "fx.glow",
        width: 40,
        height: 40,
        ...(blend === undefined ? {} : { blend })
      })
    )
  );

  drawn.frame();

  return entities;
}

/**
 * The draw calls of a build: the blend of every batch, and the filter instructions, which would be passes.
 *
 * @param drawn - The running renderer.
 * @returns The blends of the batches in order and the count of filter instructions.
 */
function drawsOf(drawn: Drawn): { batches: string[]; filters: number } {
  const layer = drawn.mock.ctx.state.sync.layers.get("items")?.container;

  if (layer === undefined) throw new Error("no items layer");

  const instructions = buildOf(layer);

  return {
    batches: instructions
      .filter(instruction => instruction.renderPipeId === "batch")
      .map(instruction => (instruction as InstanceType<typeof pixi.Batch>).blendMode),
    filters: instructions.filter(instruction => instruction.renderPipeId === "filter").length
  };
}

describe("the draw calls of blended sprites on Pixi's own pipes", () => {
  // Bug: a blend is drawn through a filter pass, or every glow breaks the batch: the cost the design promises
  // (0 passes, one draw call more per switch of blend in draw order) does not hold.
  it("batches runs of equal blends: no pass, one batch more per switch in draw order", async () => {
    const drawn = await startDrawn();

    running.push(drawn);
    spritesOf(drawn, [undefined, "add", "add", "normal", "screen", "screen", undefined]);

    const draws = drawsOf(drawn);

    expect(draws.filters).toBe(0);
    // Four switches of blend in draw order: 1 + 4 batches.
    expect(draws.batches).toEqual(["normal", "add", "normal", "screen", "normal"]);
  });

  // Bug: a mode the renderer refuses still reaches Pixi, which breaks the batch for it (or adds a filter pass).
  it("draws a refused multiply in the batch of the sprites around it", async () => {
    const drawn = await startDrawn();

    running.push(drawn);
    spritesOf(drawn, [undefined, "multiply" as SpriteBlend, undefined]);

    expect(drawsOf(drawn)).toEqual({ batches: ["normal"], filters: 0 });
  });
});
