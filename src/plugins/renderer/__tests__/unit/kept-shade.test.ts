import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Parent, Shape, Transform } from "../../components";
import { KEY } from "../../kept/geometry";
import { CALM_AFTER, QUAD_CALM } from "../../kept/record";
import { stopKept } from "../../kept/state";
import type { KeptRecord, KeptShade } from "../../kept/types";
import type { FilterSlot, FilterSlotInputs, PixiContainer } from "../../types";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";
import { quadOfFilter, shadedSlot } from "../quad-harness";

// ---------------------------------------------------------------------------
// F126 stage 2: a kept view whose filter numbers change draws through the filter's own body on a mesh, in the canvas
// pass. The whole renderer over the real Pixi of `stagePixi`, every frame drawn: a test counts the renders into the
// textures of a picture, and the stand-in sees every one of them.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

/**
 * The renderers of a test whose outer picture stands while the mesh inside it goes back to a sprite: other nodes than it
 * drew, the same pixels, which the tree oracle cannot tell.
 */
const swapsAbove = new Set<Drawn>();

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    if (!swapsAbove.delete(drawn)) drawn.oracle.expectPicturesCurrent();
    drawn.mock.stop();
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Starts the renderer, every frame drawn, and keeps it for the teardown.
 *
 * @param kind - The backend.
 * @returns The running renderer.
 */
async function open(kind: "webgpu" | "webgl" = "webgpu"): Promise<Drawn> {
  const drawn = await startDrawn({ onDemand: false, kind });

  running.push(drawn);

  return drawn;
}

/**
 * Spawns a 40 x 40 card with these slots and runs the frames of its take.
 *
 * @param drawn - The running renderer.
 * @param slots - Its slots.
 * @param place - Where it stands.
 * @param place.x - Its x.
 * @param place.y - Its y.
 * @returns The card.
 */
function keptCard(
  drawn: Drawn,
  slots: FilterSlot[] = [shadedSlot()],
  place?: { x: number; y: number }
): Entity {
  const card = drawn.spawn(Transform(place ?? { x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

  drawn.frame();
  drawn.mock.api.sync.filters.set(card, slots);
  drawn.frames(4);

  return card;
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
 * The shade of a record that has one.
 *
 * @param record - The record.
 * @returns Its shade.
 */
function shadeOf(record: KeptRecord): KeptShade {
  if (record.shade === undefined) throw new Error("no shade");

  return record.shade;
}

/**
 * One frame in which a filter's numbers are written, as `effects` does: the mark, then the frame.
 *
 * @param drawn - The running renderer.
 * @param entities - The entities it writes.
 */
function write(drawn: Drawn, ...entities: Entity[]): void {
  for (const entity of entities) drawn.mock.api.invalidate(entity);

  drawn.frame();
}

/**
 * Writes an entity's numbers until the record draws through its mesh.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns The record.
 */
function shaded(drawn: Drawn, entity: Entity): KeptRecord {
  for (let frame = 0; frame < 3; frame += 1) write(drawn, entity);

  const record = recordOf(drawn, entity);

  expect(record.shaded).toBe(true);

  return record;
}

/**
 * How many renders into a texture since a point drew from this container.
 *
 * @param drawn - The running renderer.
 * @param container - The root of the render.
 * @param from - The render count to start from.
 * @returns How many.
 */
function rendersBy(drawn: Drawn, container: PixiContainer | undefined, from = 0): number {
  return drawn.stage
    .targets()
    .slice(from)
    .filter(call => call.container === container).length;
}

/**
 * The stage-1 renders of a record's top since a point.
 *
 * @param drawn - The running renderer.
 * @param record - The record.
 * @param from - The render count to start from.
 * @returns How many.
 */
function takesOf(drawn: Drawn, record: KeptRecord, from = 0): number {
  return rendersBy(drawn, record.top, from);
}

/**
 * The one copy sprite of the run.
 *
 * @param drawn - The running renderer.
 * @returns The sprite.
 */
function copyOf(drawn: Drawn): PixiContainer | undefined {
  return drawn.mock.ctx.state.kept.quadCopy;
}

/**
 * Tells how far a record is from the top's place in its parent: its quad draws right above it.
 *
 * @param record - The record.
 * @returns True when the quad stands right above the top.
 */
function quadBesideTop(record: KeptRecord): boolean {
  const parent = record.top.parent;

  return parent?.children[parent.getChildIndex(record.top) + 1] === record.quad;
}

describe("entering the mode", () => {
  // Bug: the mode costs a pass anyway, or a one-off write pays for a mesh it never needed.
  it("stays on stage 3 for two writes in a row, enters at the third, and renders nothing in the next ten", async () => {
    const drawn = await open();
    const card = keptCard(drawn);
    const record = recordOf(drawn, card);
    const start = drawn.stage.targets().length;

    write(drawn, card);
    write(drawn, card);

    expect(record.shaded).toBe(false);
    expect(rendersBy(drawn, record.standIn, start)).toBe(2);

    write(drawn, card);

    expect(record.shaded).toBe(true);
    expect(rendersBy(drawn, record.standIn, start)).toBe(2);
    expect(rendersBy(drawn, copyOf(drawn), start)).toBe(1);
    expect(record.quad).toBe(shadeOf(record).mesh);
    expect(quadBesideTop(record)).toBe(true);

    const entered = drawn.stage.targets().length;

    for (let frame = 0; frame < 10; frame += 1) write(drawn, card);

    expect(drawn.stage.targets().length).toBe(entered);
  });

  // Bug: a tween that writes every second frame pays a stage 3 pass forever.
  it("enters for a tween that writes every second frame", async () => {
    const drawn = await open();
    const card = keptCard(drawn);

    for (let frame = 0; frame < 3; frame += 1) {
      write(drawn, card);
      drawn.frame();
    }

    expect(recordOf(drawn, card).shaded).toBe(true);
  });

  // Bug: writes far apart run a body all the time that a sprite could draw at rest.
  it("does not count writes more than CALM_AFTER frames apart", async () => {
    const drawn = await open();
    const card = keptCard(drawn);

    for (let frame = 0; frame < 6; frame += 1) {
      write(drawn, card);
      drawn.frames(CALM_AFTER);
    }

    expect(recordOf(drawn, card).shaded).toBe(false);
  });

  // Bug: a slow tween pays a stage 3 pass at every write: the gap counts one frame too many.
  it("counts writes CALM_AFTER frames apart", async () => {
    const drawn = await open();
    const card = keptCard(drawn);

    for (let frame = 0; frame < 3; frame += 1) {
      write(drawn, card);
      drawn.frames(CALM_AFTER - 1);
    }

    expect(recordOf(drawn, card).shaded).toBe(true);
  });
});

/**
 * A kept panel with a shaded pill inside, the panel taken again after the pill's writes churned it to live.
 *
 * @param drawn - The running renderer.
 * @returns The panel and the pill.
 */
function panelOverPill(drawn: Drawn): { panel: KeptRecord; pill: Entity } {
  const panelView = drawn.spawn(Transform({ x: 50, y: 50 }), Shape({ w: 200, h: 200 }));
  const pill = drawn.mock.world.ecs.spawn(OWNER, [
    Transform({ x: 20, y: 20 }),
    Shape({ w: 40, h: 40 }),
    Parent({ entity: panelView })
  ]);

  drawn.frame();
  drawn.mock.api.sync.filters.set(pill, [shadedSlot()]);
  drawn.mock.api.sync.filters.set(panelView, [
    { filter: new pixi.ColorMatrixFilter(), passes: 1, cache: "local" }
  ]);
  drawn.frames(6);
  shaded(drawn, pill);
  // The panel churned to live under the writes; it stands still for the eight frames of its calm, and is taken.
  drawn.frames(12);

  const panel = recordOf(drawn, panelView);

  expect(panel.mode).toBe("kept");

  return { panel, pill };
}

describe("a shaded view and what stands above it", () => {
  // Bug: an outer picture shows the old number.
  it("a value write in the mode retakes a kept picture above, with no pass of its own", async () => {
    const drawn = await open();
    const { panel, pill } = panelOverPill(drawn);
    const from = drawn.stage.targets().length;

    write(drawn, pill);

    expect(takesOf(drawn, panel, from)).toBe(1);
    expect(rendersBy(drawn, recordOf(drawn, pill).top, from)).toBe(0);
    expect(rendersBy(drawn, copyOf(drawn), from)).toBe(0);
  });

  // Bug: an overlay's picture of the range shows the old number.
  it("a value write in the mode owes a render of the range that holds the view", async () => {
    const drawn = await open();
    const card = keptCard(drawn);
    const record = shaded(drawn, card);
    const parent = record.top.parent;
    const { kept } = drawn.mock.modules;

    if (parent === null) throw new Error("no parent");

    kept.take({
      id: 9001,
      entries: [record.top],
      others: [],
      slot: { container: parent, before: record.top }
    });
    drawn.frame();

    const range = drawn.mock.ctx.state.kept.ranges.get(9001);
    const from = drawn.stage.targets().length;

    write(drawn, card);

    expect(
      drawn.stage
        .targets()
        .slice(from)
        .some(call => call.target === range?.picture)
    ).toBe(true);
  });
});

describe("leaving at rest", () => {
  // Bug: the body runs for ever on a view at rest.
  it("leaves once after QUAD_CALM frames without a write: one stage 3, the sprite in the mesh's place", async () => {
    const drawn = await open();
    const card = keptCard(drawn);
    const record = shaded(drawn, card);
    const { mesh, sprite } = shadeOf(record);

    drawn.frames(QUAD_CALM - 1);

    expect(record.shaded).toBe(true);

    const from = drawn.stage.targets().length;

    drawn.frame();

    expect(record.shaded).toBe(false);
    expect(rendersBy(drawn, record.standIn, from)).toBe(1);
    expect(record.quad).toBe(sprite);
    expect(quadBesideTop(record)).toBe(true);
    expect(sprite.visible).toBe(true);
    expect(mesh.parent).toBeNull();

    drawn.frames(10);

    expect(rendersBy(drawn, record.standIn, from)).toBe(1);
    expect(record.mode).toBe("kept");
  });

  // Bug: a kept board churns to live for pixels that did not change.
  it("marks nothing above when it leaves: the pixels stand", async () => {
    const drawn = await open();

    swapsAbove.add(drawn);

    const panelView = drawn.spawn(Transform({ x: 50, y: 50 }), Shape({ w: 200, h: 200 }));
    const pill = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 20, y: 20 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: panelView })
    ]);

    drawn.frame();
    drawn.mock.api.sync.filters.set(pill, [shadedSlot()]);
    drawn.mock.api.sync.filters.set(panelView, [
      { filter: new pixi.ColorMatrixFilter(), passes: 1, cache: "local" }
    ]);
    drawn.frames(6);

    const record = shaded(drawn, pill);

    drawn.frames(QUAD_CALM - 1);

    const panel = recordOf(drawn, panelView);
    const from = drawn.stage.targets().length;

    expect(panel.mode).toBe("kept");

    drawn.frame();

    expect(record.shaded).toBe(false);
    expect(takesOf(drawn, panel, from)).toBe(0);
  });

  // Bug: every view of a screen renders in one frame.
  it("forty due leave two a flush", async () => {
    const drawn = await open();
    const cards: Entity[] = [];

    for (let index = 0; index < 40; index += 1) {
      cards.push(
        drawn.spawn(
          Transform({ x: (index % 8) * 60, y: Math.floor(index / 8) * 60 }),
          Shape({ w: 40, h: 40 })
        )
      );
    }

    drawn.frame();

    for (const card of cards) drawn.mock.api.sync.filters.set(card, [shadedSlot()]);

    drawn.frames(12);

    for (let frame = 0; frame < 3; frame += 1) write(drawn, ...cards);

    const records = cards.map(card => recordOf(drawn, card));

    expect(records.every(record => record.shaded)).toBe(true);

    drawn.frames(QUAD_CALM - 1);

    const left: number[] = [];

    for (let frame = 0; frame < 21; frame += 1) {
      const before = records.filter(record => record.shaded).length;

      drawn.frame();
      left.push(before - records.filter(record => record.shaded).length);
    }

    expect(left).toEqual([...Array.from({ length: 20 }, () => 2), 0]);
  });

  // Bug: a shaded view keeps a body at a coarse picture for as long as a low resolution stands.
  it("a due view under a held resolution step is taken whole, never stage 3 at a new resolution over an old picture", async () => {
    const drawn = await open();

    drawn.mock.api.monitor.setResolution(2);
    drawn.frames(2);

    const card = keptCard(drawn);
    const record = shaded(drawn, card);

    drawn.mock.api.monitor.setResolution(1);
    drawn.frames(QUAD_CALM);

    expect(record.shaded).toBe(false);
    expect(record.mode).toBe("kept");
    expect(record.key[KEY.rs]).toBe(1);
    expect(record.key[KEY.r]).toBe(1);
  });
});

describe("every way out leaves the same way", () => {
  // Bug: `F(F(x))` at one pixel's size, or a mesh that outlives its binding.
  it("churn to live and a retake: a sprite draws stage 3 once", async () => {
    const drawn = await open();
    const card = keptCard(drawn);
    const child = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 4, y: 4 }),
      Shape({ w: 8, h: 8 }),
      Parent({ entity: card })
    ]);

    drawn.frames(6);

    const record = shaded(drawn, card);

    for (let frame = 1; frame <= 3; frame += 1) {
      drawn.mock.world.ecs.set(child, Transform, { x: 4 + frame });
      drawn.frame();
    }

    expect(record.mode).toBe("live");
    expect(record.shaded).toBe(false);
    expect(shadeOf(record).mesh.parent).toBeNull();

    const from = drawn.stage.targets().length;

    drawn.frames(10);

    expect(record.mode).toBe("kept");
    expect(rendersBy(drawn, record.standIn, from)).toBe(1);
    expect(rendersBy(drawn, copyOf(drawn), from)).toBe(0);
    expect(record.quad).toBe(shadeOf(record).sprite);
    expect((record.quad as pixi.Sprite).texture).toBe(record.s3);
  });

  // Bug: a mesh over a destroyed `s3`.
  it("a stack reduced to Alpha draws s1 through a sprite, and Pixi sees no bound source destroyed", async () => {
    const drawn = await open();
    const warn = vi.spyOn(console, "warn");
    const slot = shadedSlot();
    const alpha = new pixi.AlphaFilter({ alpha: 0.5 });

    alpha.resolution = "inherit";
    alpha.enabled = false;

    const card = keptCard(drawn, [slot, { filter: alpha, passes: 1, cache: "local" }]);
    const record = shaded(drawn, card);

    alpha.enabled = true;
    slot.filter.enabled = false;
    write(drawn, card);

    expect(record.mode).toBe("kept");
    expect(record.shaded).toBe(false);
    expect(record.direct).toBe(true);
    expect(record.s3).toBeUndefined();
    expect(record.quad).toBe(shadeOf(record).sprite);
    expect((record.quad as pixi.Sprite).texture).toBe(record.s1);
    expect(warn).not.toHaveBeenCalled();
  });

  // Bug: a throw inside the render: the shader still binds a destroyed source.
  it("an evicted shaded view comes back on another texture, bound to it", async () => {
    const drawn = await open();
    const warn = vi.spyOn(console, "warn");
    const card = keptCard(drawn);
    const record = shaded(drawn, card);
    const first = record.s3?.source;
    const { kept } = drawn.mock.ctx.state;
    // A view one level deeper steps first: the card, not drawn yet in this flush, may be evicted for it.
    const holder = drawn.spawn(Transform({ x: 300, y: 300 }), Shape({ w: 8, h: 8 }));
    const deep = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 0, y: 0 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: holder })
    ]);

    drawn.frame();
    drawn.mock.api.sync.filters.set(deep, [
      { filter: new pixi.ColorMatrixFilter(), passes: 1, cache: "local" }
    ]);
    drawn.frame();

    const { budget } = kept;

    kept.budget = kept.bytes + 100;
    drawn.frames(3);

    expect(drawn.mock.api.stats().kept.evicted + kept.frameEvicted).toBe(1);
    expect(record.mode).toBe("live");
    expect(record.shaded).toBe(false);
    expect(warn).not.toHaveBeenCalled();

    kept.budget = budget;
    drawn.frames(4);
    expect(record.mode).toBe("kept");

    shaded(drawn, card);

    expect(record.s3?.source).not.toBe(first);
    expect(shadeOf(record).shader.resources.uTexture).toBe(record.s3?.source);
    expect(shadeOf(record).shader.resources.uSampler).toBe(record.s3?.source.style);
  });

  // Bug: a shaded view keeps binding the numbers of an instance `effects` destroyed.
  it("a new instance in the mode rebinds its own numbers, and the old shader goes", async () => {
    const drawn = await open();
    const card = keptCard(drawn);
    const record = shaded(drawn, card);
    const old = shadeOf(record).shader;
    const destroy = vi.spyOn(old, "destroy");
    const next = shadedSlot();

    drawn.mock.api.sync.filters.set(card, [next]);
    drawn.frame();

    expect(record.shaded).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    expect(shadeOf(record).shader).not.toBe(old);
    expect(shadeOf(record).mesh.shader).toBe(shadeOf(record).shader);
    expect(shadeOf(record).shader.resources.fu).toBe(next.quad?.fu);
  });

  // Bug: a mesh destroyed with an old parent stays the record's quad, and the view shows nothing.
  it("a mesh destroyed under the view leaves through the sprite, and the next entry makes another", async () => {
    const drawn = await open();
    const card = keptCard(drawn);
    const record = shaded(drawn, card);
    const old = shadeOf(record).mesh;

    old.destroy();
    write(drawn, card);

    expect(record.shaded).toBe(false);
    expect(record.quad).toBe(shadeOf(record).sprite);
    expect(quadBesideTop(record)).toBe(true);

    write(drawn, card);
    write(drawn, card);

    expect(record.shaded).toBe(true);
    expect(record.quad).not.toBe(old);
    expect(record.quad?.destroyed).toBe(false);
  });
});

describe("the size of the padded picture", () => {
  // Bug: an empty or clipped input.
  it("a retake copies once", async () => {
    const drawn = await open();
    const card = keptCard(drawn);
    const child = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 4, y: 4 }),
      Shape({ w: 8, h: 8 }),
      Parent({ entity: card })
    ]);

    drawn.frames(6);

    const record = shaded(drawn, card);
    const from = drawn.stage.targets().length;

    drawn.mock.world.ecs.set(child, Transform, { x: 6 });
    drawn.frame();

    expect(record.shaded).toBe(true);
    expect(takesOf(drawn, record, from)).toBe(1);
    expect(rendersBy(drawn, copyOf(drawn), from)).toBe(1);
    expect(rendersBy(drawn, record.standIn, from)).toBe(0);
    expect(shadeOf(record).copied).toBe(record.s1Version);
  });

  // Bug: the padded picture stays at the old size, a body clipped at its old padding.
  it("a padding change recopies at the new size", async () => {
    const drawn = await open();
    const slot = shadedSlot();

    slot.filter.padding = 8;

    const card = keptCard(drawn, [slot]);
    const record = shaded(drawn, card);
    const from = drawn.stage.targets().length;

    slot.filter.padding = 12;
    write(drawn, card);

    expect(record.shaded).toBe(true);
    expect(rendersBy(drawn, copyOf(drawn), from)).toBe(1);
    expect(record.s3?.source.pixelWidth).toBe(64);
    expect(shadeOf(record).copiedWidth).toBe(64);
    expect(drawn.stage.targets().at(-1)?.transform?.tx).toBe(12);
  });

  // Bug: a blank mesh: a resize of `s3` in place blanks it without moving `s1Version`.
  it("a resolution change recopies at the new size", async () => {
    const drawn = await open();
    const card = keptCard(drawn);
    const record = shaded(drawn, card);
    const width = record.s3?.source.pixelWidth ?? 0;

    drawn.mock.api.monitor.setResolution(2);
    drawn.frames(3);

    expect(record.s3?.source.pixelWidth).toBe(width * 2);
    expect(shadeOf(record).copiedWidth).toBe(width * 2);
    expect(shadeOf(record).copied).toBe(record.s1Version);
  });
});

describe("what fits the mode", () => {
  const INPUTS: FilterSlotInputs = {
    stages: [],
    count: 1,
    version: () => 1,
    scaleOf: () => 0.5,
    draw: () => undefined,
    hold: () => undefined
  };

  /** Stacks a mesh cannot draw. */
  const REFUSED: ReadonlyArray<[string, () => FilterSlot[]]> = [
    ["two filters", () => [shadedSlot(), shadedSlot()]],
    [
      "an Alpha beside one",
      () => [
        shadedSlot(),
        { filter: new pixi.AlphaFilter({ alpha: 0.5 }), passes: 1, cache: "local" }
      ]
    ],
    ["inputs", () => [shadedSlot({ inputs: INPUTS })]],
    ["no quad", () => [{ filter: shadedSlot().filter, passes: 1, cache: "local" }]],
    [
      "a fixed resolution at the canvas's",
      () => {
        const slot = shadedSlot();

        slot.filter.resolution = 1;

        return [slot];
      }
    ],
    [
      "a fixed resolution under the canvas's",
      () => {
        const slot = shadedSlot();

        slot.filter.resolution = 0.5;

        return [slot];
      }
    ]
  ];

  // Bug: a stack drawn `A·F(x)` where stage 3 draws `F(A·x)`, a body with no input, a program bound on the wrong grid.
  it.each(REFUSED)("stays on stage 3 for %s", async (_name, slots) => {
    const drawn = await open();
    const card = keptCard(drawn, slots());
    const record = recordOf(drawn, card);

    for (let frame = 0; frame < 6; frame += 1) write(drawn, card);

    expect(record.mode).toBe("kept");
    expect(record.shaded).toBe(false);
    expect(record.shade).toBeUndefined();
  });

  // Bug: a GPU program on WebGL: a blank view.
  it("stays on stage 3 on WebGL", async () => {
    const drawn = await open("webgl");
    const card = keptCard(drawn);

    for (let frame = 0; frame < 6; frame += 1) write(drawn, card);

    expect(recordOf(drawn, card).shaded).toBe(false);
  });

  // Bug: a shaded body keeps running for a stack that is gone.
  it("a filter switched off in the mode leaves in the same frame", async () => {
    const drawn = await open();
    const slot = shadedSlot();
    const card = keptCard(drawn, [slot]);
    const record = shaded(drawn, card);

    slot.filter.enabled = false;
    write(drawn, card);

    expect(record.shaded).toBe(false);
    expect(record.mode).toBe("live");
    expect(record.quad?.visible).toBe(false);
    expect(shadeOf(record).mesh.parent).toBeNull();
  });

  // Bug: a mesh drawn with one filter where the stack has two.
  it("a second filter switched on in the mode leaves in the same frame, with its stage 3", async () => {
    const drawn = await open();
    const second = shadedSlot();

    second.filter.enabled = false;

    const card = keptCard(drawn, [shadedSlot(), second]);
    const record = shaded(drawn, card);
    const from = drawn.stage.targets().length;

    second.filter.enabled = true;
    write(drawn, card);

    expect(record.shaded).toBe(false);
    expect(rendersBy(drawn, record.standIn, from)).toBe(1);
    expect(record.quad).toBe(shadeOf(record).sprite);
  });

  // Bug: the same in the frame of a retake: stage 1 redone and the mesh kept for one frame.
  it("a stack that stops fitting in the frame of a retake leaves there", async () => {
    const drawn = await open();
    const second = shadedSlot();

    second.filter.enabled = false;

    const card = keptCard(drawn, [shadedSlot(), second]);
    const child = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 4, y: 4 }),
      Shape({ w: 8, h: 8 }),
      Parent({ entity: card })
    ]);

    drawn.frames(6);

    const record = shaded(drawn, card);
    const from = drawn.stage.targets().length;

    second.filter.enabled = true;
    drawn.mock.world.ecs.set(child, Transform, { x: 6 });
    drawn.frame();

    expect(record.shaded).toBe(false);
    expect(takesOf(drawn, record, from)).toBe(1);
    expect(rendersBy(drawn, record.standIn, from)).toBe(1);
  });
});

describe("the place of a shaded view", () => {
  // Bug: `canvasPixel` counts the place twice.
  it("keptOrigin is 0 in the mode and the picture's origin after leaving", async () => {
    const drawn = await open();
    const origin = new Float32Array(2);
    const card = keptCard(drawn, [shadedSlot({ cache: "placed", origin })]);

    expect([...origin]).toEqual([100, 100]);

    const record = shaded(drawn, card);

    expect([...origin]).toEqual([0, 0]);
    expect(record.mode).toBe("kept");

    drawn.frames(QUAD_CALM);

    expect(record.shaded).toBe(false);
    expect([...origin]).toEqual([100, 100]);
  });

  // Bug: a shader that reads the frame through `uOutputFrame` or a stale copy of the numbers: a body at the wrong place.
  it("writes the numbers of a padded picture at resolution 2.625, as a filter pass would", async () => {
    const drawn = await open();

    drawn.mock.api.monitor.setResolution(2.625);
    drawn.frames(2);

    const slot = shadedSlot();

    slot.filter.padding = 8;

    const card = keptCard(drawn, [slot]);
    const record = shaded(drawn, card);
    const { uniforms } = shadeOf(record).gfu;
    // The picture spans floor(262.5) = 262 to ceil(367.5) = 368 texels, 106 of them, padded by 21 on each side: 148
    // texels from 241, 148 / 2.625 CSS px wide from 241 / 2.625. The canvas is 1080 x 1920 CSS px.
    const place = Math.fround(241 / 2.625);
    const css = Math.fround(148 / 2.625);
    const texel = Math.fround(1 / 148);

    expect([...(uniforms.uInputSize as Float32Array)]).toEqual([
      css,
      css,
      Math.fround(2.625 / 148),
      Math.fround(2.625 / 148)
    ]);
    expect([...(uniforms.uInputPixel as Float32Array)]).toEqual([148, 148, texel, texel]);
    expect([...(uniforms.uInputClamp as Float32Array)]).toEqual([
      Math.fround(0.5 / 148),
      Math.fround(0.5 / 148),
      Math.fround(1 - 0.5 / 148),
      Math.fround(1 - 0.5 / 148)
    ]);
    expect([...(uniforms.uOutputFrame as Float32Array)]).toEqual([place, place, css, css]);
    expect([...(uniforms.uGlobalFrame as Float32Array)]).toEqual([
      0,
      0,
      Math.fround(1080 * 2.625),
      Math.fround(1920 * 2.625)
    ]);
    expect([...(uniforms.uOutputTexture as Float32Array)]).toEqual([1080, 1920, -1, 0]);
  });

  // Bug: the group is uploaded in every frame of every shaded view, or a moved place is never uploaded.
  it("uploads the numbers only in a frame one of them changed", async () => {
    const drawn = await open();
    const card = keptCard(drawn, [shadedSlot({ cache: "placed", origin: new Float32Array(2) })]);
    const record = shaded(drawn, card);
    const update = vi.spyOn(shadeOf(record).gfu, "update");

    expect(shadeOf(record).gfu.isStatic).toBe(true);

    write(drawn, card);

    expect(update).not.toHaveBeenCalled();

    drawn.mock.world.ecs.set(card, Transform, { x: 110 });
    drawn.frame();

    expect(update).toHaveBeenCalledOnce();
    expect((shadeOf(record).gfu.uniforms.uOutputFrame as Float32Array)[0]).toBe(110);
  });

  // Bug: a one-pixel view: the geometry is the unit square.
  it("draws the mesh at the sprite's matrix scaled by the output's CSS size", async () => {
    const drawn = await open();
    const slot = shadedSlot();

    slot.filter.padding = 8;

    const card = keptCard(drawn, [slot]);
    const record = recordOf(drawn, card);
    const sprite = record.quad as pixi.Sprite;
    const place = sprite.getGlobalTransform(new pixi.Matrix(), false);

    shaded(drawn, card);

    const mesh = shadeOf(record).mesh;

    expect(mesh.scale.x).toBeCloseTo(sprite.texture.width, 6);
    expect(mesh.scale.y).toBeCloseTo(sprite.texture.height, 6);
    expect(mesh.x).toBe(place.tx);
    expect(mesh.y).toBe(place.ty);
    expect(mesh.scale.x).toBe(56);
    expect(mesh.getBounds().width).toBe(56);
  });
});

describe("what a shaded view frees", () => {
  // Bug: a GPU leak on every scene.
  it("destroys the shader before s3, frees the buffer once, and the shared geometry once", async () => {
    const drawn = await open();
    const warn = vi.spyOn(console, "warn");
    const card = keptCard(drawn);
    const other = keptCard(drawn, [shadedSlot()], { x: 300, y: 100 });
    const record = shaded(drawn, card);

    shaded(drawn, other);

    const shade = shadeOf(record);
    const buffer = new pixi.Buffer({
      data: new Float32Array(4),
      usage: pixi.BufferUsage.UNIFORM
    });

    shade.gfu.buffer = buffer;

    const shader = vi.spyOn(shade.shader, "destroy");
    const freed = vi.spyOn(buffer, "destroy");
    const source = vi.spyOn(record.s3 as pixi.Texture, "destroy");
    const mesh = vi.spyOn(shade.mesh, "destroy");
    const sprite = vi.spyOn(shade.sprite, "destroy");
    const { kept: state } = drawn.mock.ctx.state;
    const geometry = vi.spyOn(state.quadGeometry as pixi.MeshGeometry, "destroy");
    const copy = vi.spyOn(state.quadCopy as pixi.Sprite, "destroy");

    drawn.mock.modules.kept.reset();

    expect(shader).toHaveBeenCalledOnce();
    expect(freed).toHaveBeenCalledOnce();
    expect(mesh).toHaveBeenCalled();
    expect(sprite).toHaveBeenCalled();
    expect(geometry).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledOnce();
    expect(source.mock.invocationCallOrder[0]).toBeGreaterThan(
      shader.mock.invocationCallOrder[0] ?? 0
    );
    expect(state.quadGeometry).toBeUndefined();
    expect(state.quadCopy).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  // Bug: the app stops with the one geometry alive: stop runs without `reset`.
  it("a stop frees the shaded records and the shared parts from state alone", async () => {
    const drawn = await open();
    const record = shaded(drawn, keptCard(drawn));
    const { kept: state } = drawn.mock.ctx.state;
    const shader = vi.spyOn(shadeOf(record).shader, "destroy");
    const output = vi.spyOn(record.s3 as pixi.Texture, "destroy");
    const geometry = vi.spyOn(state.quadGeometry as pixi.MeshGeometry, "destroy");

    stopKept(state);

    expect(shader).toHaveBeenCalledOnce();
    expect(output.mock.invocationCallOrder[0]).toBeGreaterThan(
      shader.mock.invocationCallOrder[0] ?? 0
    );
    expect(geometry).toHaveBeenCalledOnce();
    expect(state.quadGeometry).toBeUndefined();
    expect(state.quadCopy).toBeUndefined();
    running.length = 0;
    drawn.mock.stop();
  });

  // Bug: 3 GPU buffers per view.
  it("every mesh of the run draws on one geometry", async () => {
    const drawn = await open();
    const first = shaded(drawn, keptCard(drawn));
    const second = shaded(drawn, keptCard(drawn, [shadedSlot()], { x: 300, y: 100 }));

    expect(shadeOf(first).mesh.geometry).toBe(shadeOf(second).mesh.geometry);
    expect(shadeOf(first).mesh.geometry).toBe(drawn.mock.ctx.state.kept.quadGeometry);
  });

  // Bug: a shader made at every entry.
  it("an entry after the first makes nothing", async () => {
    const drawn = await open();
    const card = keptCard(drawn);
    const record = shaded(drawn, card);
    const { mesh, shader, gfu } = shadeOf(record);

    drawn.frames(QUAD_CALM);

    expect(record.shaded).toBe(false);

    shaded(drawn, card);

    expect(shadeOf(record).mesh).toBe(mesh);
    expect(shadeOf(record).shader).toBe(shader);
    expect(shadeOf(record).gfu).toBe(gfu);
  });

  // Bug: an entry with no sprite to take the place of throws inside the flush.
  it("a record that lost its sprite stays on stage 3 and gets a sprite back", async () => {
    const drawn = await open();
    const card = keptCard(drawn);
    const record = recordOf(drawn, card);

    write(drawn, card);
    write(drawn, card);
    record.quad?.destroy();
    record.quad = undefined;
    // A sprite made again takes its matrix only from a key that differs.
    record.key[KEY.qa] = Number.NaN;
    write(drawn, card);

    expect(record.shaded).toBe(false);
    expect(record.shade).toBeUndefined();
    expect(record.quad).toBeInstanceOf(pixi.Sprite);
  });

  // Bug: a `fu: undefined` key throws in Pixi's shader.
  it("a filter that binds no numbers enters with no fu", async () => {
    const drawn = await open();
    const quad = quadOfFilter();
    const card = keptCard(drawn, [shadedSlot({ quad: { program: quad.program, fu: undefined } })]);
    const record = shaded(drawn, card);

    expect(shadeOf(record).shader.groups[3]).toBeUndefined();
  });
});

describe("the reports", () => {
  // Bug: a game session cannot tell the two apart.
  it("why() says quad: true on a shaded view and nothing on a kept sprite", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const drawn = await open();
    const card = keptCard(drawn);

    expect(drawn.mock.api.sync.debug.why()[0]).not.toHaveProperty("quad");

    shaded(drawn, card);

    expect(drawn.mock.api.sync.debug.why()[0]).toMatchObject({ mode: "kept", quad: true });
  });

  // Bug: the docs of `quad` show a report no game session ever reads: the two stage 3 passes before the entry are takes.
  it("why() names the outputs before the entry for the second they fell in, then no take", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const drawn = await open();
    const { kept } = drawn.mock.modules;
    const card = keptCard(drawn);

    kept.drainTakes();
    shaded(drawn, card);
    kept.drainTakes();

    expect(drawn.mock.api.sync.debug.why()[0]).toMatchObject({
      // eslint-disable-next-line unicorn/no-null -- the report says `null` for no entity behind a take.
      retake: { why: "filter", by: null },
      quad: true
    });

    write(drawn, card);
    kept.drainTakes();

    // eslint-disable-next-line unicorn/no-null -- the report says `null` for no take.
    expect(drawn.mock.api.sync.debug.why()[0]).toMatchObject({ retake: null, quad: true });
  });

  // Bug: the counter that gates the A26 line reads wrong.
  it("sync.canvasPasses() stays 1 with eight shaded views", async () => {
    const drawn = await open();
    const cards: Entity[] = [];

    for (let index = 0; index < 8; index += 1) {
      cards.push(keptCard(drawn, [shadedSlot()], { x: 100, y: 100 + index * 84 }));
    }

    for (const card of cards) shaded(drawn, card);

    write(drawn, ...cards);

    expect(drawn.mock.modules.sync.canvasPasses()).toBe(1);
  });

  // Bug: a shaded view counted as a take, so the picture's retake rate climbs while nothing is taken.
  it("a shaded change is no take, no refresh and no pass", async () => {
    const drawn = await open();
    const card = keptCard(drawn);

    shaded(drawn, card);

    const { kept } = drawn.mock.modules;

    drawn.frame();
    kept.drainTakes();
    kept.drainRefreshes();

    write(drawn, card);

    expect(kept.drainTakes()).toBe(0);
    expect(kept.drainRefreshes()).toBe(0);
    expect(drawn.mock.ctx.state.kept.flushPasses).toBe(0);
  });
});
