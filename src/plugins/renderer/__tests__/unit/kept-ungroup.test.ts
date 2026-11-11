import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Parent, Shape, Transform } from "../../components";
import type { KeptRecord } from "../../kept/types";
import type { PixiContainer } from "../../types";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";
import { shadedSlot } from "../quad-harness";

// ---------------------------------------------------------------------------
// F173: a kept view the cache draws live again gives Pixi its render group back, and Pixi pools it. The next take of
// another view gets that group, its instruction set and its batcher. A view under the first one that Pixi still counts
// as drawn writes its vertices into that batcher at every move, so the other view's picture is taken from them: the
// claimed card of the daily quests stood sheared and empty after its flip. Pixi's own render group system runs here
// (`builds`), so the display status the tests read is the one Pixi works out.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) drawn.mock.stop();

  vi.restoreAllMocks();
});

/** Pixi's display status of a node it draws: visible, renderable, not culled. */
const DRAWN_STATUS = 7;

/**
 * Starts the renderer with Pixi's render group system on every render.
 *
 * @returns The running renderer.
 */
async function open(): Promise<Drawn> {
  const drawn = await startDrawn({ onDemand: false, builds: true });

  running.push(drawn);

  return drawn;
}

/**
 * The record of an entity.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns The record.
 */
function recordOf(drawn: Drawn, entity: Entity): KeptRecord {
  const record = drawn.mock.ctx.state.kept.byEntity.get(entity);

  if (record === undefined) throw new Error(`no record for ${entity}`);

  return record;
}

/**
 * A face of a card: a filtered 40 x 40 shape with a smaller shape in it.
 *
 * @param drawn - The running renderer.
 * @param card - The card it hangs in.
 * @returns The face and its content.
 */
function face(drawn: Drawn, card: Entity): { face: Entity; content: Entity } {
  const entity = drawn.mock.world.ecs.spawn(OWNER, [
    Transform({ x: 0, y: 0 }),
    Shape({ w: 40, h: 40, fill: 0x00_00_ff }),
    Parent({ entity: card })
  ]);
  const content = drawn.mock.world.ecs.spawn(OWNER, [
    Transform({ x: 4, y: 4 }),
    Shape({ w: 8, h: 8, fill: 0xff_00_00 }),
    Parent({ entity })
  ]);

  return { face: entity, content };
}

/**
 * Every node under a top, the top left out.
 *
 * @param top - The top.
 * @returns The nodes.
 */
function under(top: PixiContainer): PixiContainer[] {
  const nodes: PixiContainer[] = [];
  const open: PixiContainer[] = [...top.children];

  for (let node = open.pop(); node !== undefined; node = open.pop()) {
    nodes.push(node);
    open.push(...node.children);
  }

  return nodes;
}

/**
 * Tells whether a node or one of its ancestors is not drawn: hidden or not renderable.
 *
 * @param node - The node.
 * @returns True when Pixi draws none of it.
 */
function hiddenAbove(node: PixiContainer): boolean {
  for (let at: PixiContainer | null = node; at !== null; at = at.parent) {
    if (!at.visible || !at.renderable) return true;
  }

  return false;
}

describe("a kept view drawn live again under a hidden top (F173)", () => {
  // Bug: the nodes under a top the cache ungrouped keep the display status they had inside its group, so a top hidden
  // by its alpha leaves Pixi writing their vertices into a batcher its pool hands the next take.
  it("leaves no node under the top counted as drawn by Pixi", async () => {
    const drawn = await open();
    const card = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 1, h: 1, fillAlpha: 0 }));
    const front = face(drawn, card);

    drawn.frame();
    drawn.mock.api.sync.filters.set(front.face, [shadedSlot()]);
    drawn.frames(8);

    const record = recordOf(drawn, front.face);
    const { top } = record;

    expect(record.mode).toBe("kept");
    expect(top.isRenderGroup).toBe(true);

    // The face turns away: its alpha goes to 0, the cache draws it live, and gives its group back.
    drawn.mock.world.ecs.set(front.face, Shape, { alpha: 0 });
    drawn.frames(2);

    expect(record.mode).toBe("live");
    expect(top.isRenderGroup).toBe(false);

    const nodes = under(top);

    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(hiddenAbove(node), node.label).toBe(true);
      expect(node.globalDisplayStatus, node.label).toBeLessThan(DRAWN_STATUS);
    }
  });

  // Bug: the claimed card of the daily quests. The front face's group, given back, is the back face's at its take; the
  // front's nodes still move with the card and write over the back's vertices.
  it("lets Pixi write no vertices of a hidden face while the card moves", async () => {
    const drawn = await open();
    const card = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 1, h: 1, fillAlpha: 0 }));
    const front = face(drawn, card);
    const back = face(drawn, card);

    drawn.mock.world.ecs.set(back.face, Shape, { alpha: 0 });
    drawn.frame();
    drawn.mock.api.sync.filters.set(front.face, [shadedSlot()]);
    drawn.mock.api.sync.filters.set(back.face, [shadedSlot()]);
    drawn.frames(8);

    const frontTop = recordOf(drawn, front.face).top;

    expect(recordOf(drawn, front.face).mode).toBe("kept");

    // The flip: the front hides, the back shows, and the back is taken in the group the front gave back.
    drawn.mock.world.ecs.set(front.face, Shape, { alpha: 0 });
    drawn.mock.world.ecs.set(back.face, Shape, { alpha: 1 });
    drawn.frames(8);

    expect(recordOf(drawn, back.face).mode).toBe("kept");

    const written: string[] = [];
    const update = vi.spyOn(pixi.RenderGroup.prototype, "updateRenderable");

    update.mockImplementation(function (this: pixi.RenderGroup, renderable: pixi.Container) {
      // Pixi's own guard first: a node it does not count as drawn writes nothing.
      if (renderable.globalDisplayStatus < DRAWN_STATUS) return;
      if (under(frontTop).includes(renderable)) written.push(renderable.label);
      renderable.didViewUpdate = false;
    });

    // The card pops as it flips: every node under it moves.
    for (let step = 1; step <= 6; step += 1) {
      drawn.mock.world.ecs.set(card, Transform, { scale: 1 + step / 100 });
      drawn.frame();
    }

    expect(update).toHaveBeenCalled();
    expect(written).toEqual([]);
  });
});
