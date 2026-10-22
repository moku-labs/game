import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Parent, Shape, Transform } from "../../components";
import type { FilterSlot, PixiContainer, PixiFilter } from "../../types";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// A kept view whose only filters are alphas (F54) over the real Pixi of
// `stagePixi`: its quad draws the subtree picture itself at their alpha, as
// Pixi's alpha pass draws its input. No filter output, and a fade costs no
// render into a texture per frame. The tree oracle and the picture oracle check
// every frame. The canvas is at resolution 1.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.oracle.expectPicturesCurrent();
    drawn.mock.stop();
  }

  vi.restoreAllMocks();
});

/**
 * Starts the renderer, every frame drawn, and keeps it for the teardown.
 *
 * @returns The running renderer.
 */
async function open(): Promise<Drawn> {
  const drawn = await startDrawn({ onDemand: false });

  running.push(drawn);

  return drawn;
}

/**
 * A slot the cache may keep.
 *
 * @param filter - Its filter.
 * @returns The slot.
 */
function slotOf(filter: PixiFilter): FilterSlot {
  return { filter, passes: 1, cache: "local" };
}

/**
 * The top of an entity's view.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns Its wrapper, or its object.
 */
function topOf(drawn: Drawn, entity: Entity): PixiContainer {
  const view = drawn.mock.ctx.state.sync.views.get(entity);
  const top = view?.wrapper ?? view?.object;

  if (top === undefined) throw new Error(`no view for ${entity}`);

  return top;
}

/**
 * Renders into an entity's textures since a mark: its subtree picture (`#1`) or its filter output (`#3`).
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @param stage - `"#1"` or `"#3"`.
 * @param from - The render count to start from.
 * @returns How many.
 */
function rendersOf(drawn: Drawn, entity: Entity, stage: "#1" | "#3", from = 0): number {
  const label = `kept:${topOf(drawn, entity).label}${stage}`;

  return drawn.stage
    .targets()
    .slice(from)
    .filter(call => call.target?.source.label === label).length;
}

/**
 * The quad of an entity's kept picture.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns The quad, or `undefined`.
 */
function quadOf(drawn: Drawn, entity: Entity): PixiContainer | undefined {
  return drawn.mock.ctx.state.kept.byEntity.get(entity)?.quad;
}

/**
 * Spawns a 40 x 40 card with these filters and lets it stand still until it is kept.
 *
 * @param drawn - The running renderer.
 * @param filters - Its filters.
 * @returns The card.
 */
function keptCard(drawn: Drawn, filters: PixiFilter[]): Entity {
  const card = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

  drawn.frame();
  drawn.mock.api.sync.filters.set(
    card,
    filters.map(filter => slotOf(filter))
  );
  drawn.frames(4);

  return card;
}

describe("a kept view of alphas draws its picture direct (F54)", () => {
  // Bug F54: a stack of alphas kept a filter output of its own: a second texture and a filter pass at every take.
  it("draws the subtree picture as its quad at the filter's alpha, with no filter output", async () => {
    const drawn = await open();
    const card = keptCard(drawn, [new pixi.AlphaFilter({ alpha: 0.5 })]);
    const record = drawn.mock.ctx.state.kept.byEntity.get(card);

    expect(record?.mode).toBe("kept");
    expect(rendersOf(drawn, card, "#3")).toBe(0);
    expect(record?.s3).toBeUndefined();
    expect((quadOf(drawn, card) as pixi.Sprite | undefined)?.texture).toBe(record?.s1);
    expect(quadOf(drawn, card)?.alpha).toBe(0.5);
    // One 40 x 40 RGBA picture: 6400 bytes, where a filter output doubled it.
    expect(record?.bytes).toBe(6400);
  });

  // Bug F54: every frame of a fade redid stage 3, a filter pass and a copy per faded view (5 HUD pills = 20 passes).
  it("fades over ten frames with no render into a texture: only the quad's alpha changes", async () => {
    const drawn = await open();
    const filter = new pixi.AlphaFilter({ alpha: 0.9 });
    const card = keptCard(drawn, [filter]);
    const from = drawn.stage.targets().length;

    for (let frame = 1; frame <= 10; frame += 1) {
      // What `effects` does for a filter value: the call first, then the write.
      drawn.mock.api.invalidate(card);
      filter.alpha = 0.9 - frame * 0.05;
      drawn.frame();

      expect(quadOf(drawn, card)?.alpha).toBeCloseTo(0.9 - frame * 0.05, 10);
    }

    expect(drawn.stage.targets().length - from).toBe(0);
    expect(drawn.mock.ctx.state.kept.byEntity.get(card)?.mode).toBe("kept");
  });

  it("multiplies the alphas of a stack of two", async () => {
    const drawn = await open();
    const card = keptCard(drawn, [
      new pixi.AlphaFilter({ alpha: 0.5 }),
      new pixi.AlphaFilter({ alpha: 0.5 })
    ]);

    expect(quadOf(drawn, card)?.alpha).toBe(0.25);
    expect(rendersOf(drawn, card, "#3")).toBe(0);
  });

  it("goes back to a filter output at alpha 1 once a filter of another kind joins the stack", async () => {
    const drawn = await open();
    const alpha = new pixi.AlphaFilter({ alpha: 0.5 });
    const card = keptCard(drawn, [alpha]);

    drawn.mock.api.sync.filters.set(card, [slotOf(alpha), slotOf(new pixi.ColorMatrixFilter())]);
    drawn.frames(4);

    const record = drawn.mock.ctx.state.kept.byEntity.get(card);

    expect(record?.mode).toBe("kept");
    expect(record?.s3).toBeDefined();
    expect((quadOf(drawn, card) as pixi.Sprite | undefined)?.texture).toBe(record?.s3);
    expect(quadOf(drawn, card)?.alpha).toBe(1);
  });

  it("keeps a filter output for an alpha below the canvas resolution: its picture is on another grid", async () => {
    const drawn = await open();
    const card = keptCard(drawn, [new pixi.AlphaFilter({ alpha: 0.5, resolution: 0.5 })]);

    expect(rendersOf(drawn, card, "#3")).toBeGreaterThan(0);
    expect(quadOf(drawn, card)?.alpha).toBe(1);
  });

  // Bug: a direct quad's new alpha renders nothing, so a kept picture above it that holds the quad must be told.
  it("retakes a kept picture above when the alpha of a direct quad inside it changes", async () => {
    const drawn = await open();
    const panel = drawn.spawn(Transform({ x: 50, y: 50 }), Shape({ w: 200, h: 200 }));
    const pill = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 20, y: 20 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: panel })
    ]);
    const fade = new pixi.AlphaFilter({ alpha: 0.8 });

    drawn.frame();
    drawn.mock.api.sync.filters.set(pill, [slotOf(fade)]);
    drawn.mock.api.sync.filters.set(panel, [slotOf(new pixi.ColorMatrixFilter())]);
    drawn.frames(6);

    const from = drawn.stage.targets().length;

    drawn.mock.api.invalidate(pill);
    fade.alpha = 0.4;
    drawn.frame();

    expect(rendersOf(drawn, panel, "#1", from)).toBe(1);
    expect(rendersOf(drawn, pill, "#1", from)).toBe(0);
  });
});
