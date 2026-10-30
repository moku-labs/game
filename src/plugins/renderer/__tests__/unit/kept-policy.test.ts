import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Display, Parent, Shape, Transform } from "../../components";
import type { FilterSlot, PixiContainer } from "../../types";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// Kept pictures (spec 23 P4, P5): which views are drawn from a picture, when a
// picture is taken, retaken, refreshed or dropped. The whole renderer runs over
// the real Pixi of `stagePixi`, whose render into a texture is logged; the tree
// oracle and the picture oracle check every frame (afterEach).
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

/**
 * Starts the renderer and keeps it for the teardown. Every frame is drawn unless `onDemand` is asked for.
 *
 * @param onDemand - `config.onDemand`; off by default here, so every frame is drawn.
 * @returns The running renderer.
 */
async function open(onDemand = false): Promise<Drawn> {
  const drawn = await startDrawn({ onDemand });

  running.push(drawn);

  return drawn;
}

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.oracle.expectPicturesCurrent();
    drawn.mock.stop();
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A slot of a real Pixi filter the cache may keep.
 *
 * @param filter - The filter.
 * @param fields - Other fields of the slot.
 * @returns The slot.
 */
function slotOf(filter: pixi.Filter, fields: Partial<FilterSlot> = {}): FilterSlot {
  return { filter, passes: 1, cache: "local", ...fields };
}

/**
 * Spawns a 40 x 40 shape at a place, with a filter on it, and builds its view.
 *
 * @param drawn - The running renderer.
 * @param slot - Its filter slot.
 * @param x - Its x.
 * @returns The entity.
 */
function filtered(drawn: Drawn, slot: FilterSlot, x = 100): Entity {
  const entity = drawn.spawn(Transform({ x, y: 100 }), Shape({ w: 40, h: 40 }));

  drawn.mock.api.sync.filters.set(entity, [slot]);
  drawn.frame();

  return entity;
}

/**
 * The top of an entity's view: its wrapper, or its object.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns The top.
 */
function topOf(drawn: Drawn, entity: Entity): PixiContainer {
  const view = drawn.mock.ctx.state.sync.views.get(entity);

  if (view === undefined) throw new Error(`no view for ${entity}`);

  return view.wrapper ?? view.object;
}

/**
 * The renders into the textures of one stage of an entity's picture since a point of the log.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @param stage - `"#1"`, `"#3"` or `"#2.0"`.
 * @param from - The log length to count from.
 * @returns The count.
 */
function rendersOf(drawn: Drawn, entity: Entity, stage: string, from = 0): number {
  const label = `kept:${topOf(drawn, entity).label}${stage}`;

  return drawn.stage
    .targets()
    .slice(from)
    .filter(call => call.target?.source.label === label).length;
}

/**
 * The quad that draws an entity's picture: the sprite labelled for its top beside it.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns The quad, or `undefined`.
 */
function quadOf(drawn: Drawn, entity: Entity): PixiContainer | undefined {
  const top = topOf(drawn, entity);

  return top.parent?.children.find(child => child.label === `kept:${top.label}`);
}

/**
 * Tells whether an entity is drawn from its picture: the top hidden, its quad shown right after it.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns True when it is.
 */
function keptNow(drawn: Drawn, entity: Entity): boolean {
  const top = topOf(drawn, entity);
  const quad = quadOf(drawn, entity);

  return (
    !top.renderable &&
    quad !== undefined &&
    quad.visible &&
    top.parent?.children[top.parent.getChildIndex(top) + 1] === quad
  );
}

/**
 * Takes the picture of a filtered view: two still frames after its build, the take in the third.
 *
 * @param drawn - The running renderer.
 * @param slot - Its filter slot.
 * @param x - Its x.
 * @returns The entity, kept.
 */
function kept(
  drawn: Drawn,
  slot: FilterSlot = slotOf(new pixi.ColorMatrixFilter()),
  x = 100
): Entity {
  const entity = filtered(drawn, slot, x);

  drawn.frames(2);

  return entity;
}

describe("taking a picture", () => {
  it("a filtered view that stood still for two drawn frames is drawn from a picture from the third", async () => {
    const drawn = await open();
    const entity = filtered(drawn, slotOf(new pixi.ColorMatrixFilter()));

    drawn.frame();

    expect(keptNow(drawn, entity)).toBe(false);
    expect(rendersOf(drawn, entity, "#1")).toBe(0);

    drawn.frame();

    expect(keptNow(drawn, entity)).toBe(true);
    expect(rendersOf(drawn, entity, "#1")).toBe(1);
    expect(rendersOf(drawn, entity, "#3")).toBe(1);
    expect(topOf(drawn, entity).filters ?? []).toEqual([]);

    drawn.frames(5);

    expect(rendersOf(drawn, entity, "#1")).toBe(1);
    expect(drawn.mock.api.stats().kept.pictures).toBe(1);
  });

  it("a view that changes every frame is never taken", async () => {
    const drawn = await open();
    const entity = filtered(drawn, slotOf(new pixi.ColorMatrixFilter()));
    const child = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 4, y: 4 }),
      Shape({ w: 8, h: 8 }),
      Parent({ entity })
    ]);

    for (let frame = 0; frame < 20; frame += 1) {
      drawn.mock.world.ecs.set(child, Transform, { x: 4 + frame });
      drawn.frame();
    }

    expect(rendersOf(drawn, entity, "#1")).toBe(0);
    expect(keptNow(drawn, entity)).toBe(false);
  });

  it("a moving view keeps its picture and only its quad moves", async () => {
    const drawn = await open();
    const entity = kept(drawn);
    const quad = quadOf(drawn, entity);

    for (let frame = 1; frame <= 30; frame += 1) {
      drawn.mock.world.ecs.set(entity, Transform, { x: 100 + frame });
      drawn.frame();
    }

    expect(rendersOf(drawn, entity, "#1")).toBe(1);
    expect(keptNow(drawn, entity)).toBe(true);
    expect(quad?.getGlobalTransform(undefined, false).tx).toBe(130);
  });

  it("a kept view whose subtree changes three frames in a row draws live until it stood still eight frames", async () => {
    const drawn = await open();
    const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));
    const child = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 4, y: 4 }),
      Shape({ w: 8, h: 8 }),
      Parent({ entity })
    ]);

    drawn.mock.api.sync.filters.set(entity, [slotOf(new pixi.ColorMatrixFilter())]);
    drawn.frames(3);

    expect(keptNow(drawn, entity)).toBe(true);

    // Two changes in a row are retaken; the third goes live.
    for (const x of [5, 6]) {
      drawn.mock.world.ecs.set(child, Transform, { x });
      drawn.frame();

      expect(keptNow(drawn, entity)).toBe(true);
    }

    drawn.mock.world.ecs.set(child, Transform, { x: 7 });
    drawn.frame();

    expect(keptNow(drawn, entity)).toBe(false);
    expect(topOf(drawn, entity).renderable).toBe(true);
    expect(rendersOf(drawn, entity, "#1")).toBe(3);

    drawn.frames(7);

    expect(rendersOf(drawn, entity, "#1")).toBe(3);

    drawn.frame();

    expect(keptNow(drawn, entity)).toBe(true);
  });
});

describe("a picture retaken at another size", () => {
  // Bug: a retake at another size resizes the picture's textures in place, and Pixi's sprites follow a texture's
  // resize only when it is dynamic: the quad and the stand-in kept the old size and drew the picture scaled
  // (ticktoe's pieces as they settled, `renderer:stale-picture` with 895 pixels).
  it("draws its quad at the size of the new picture", async () => {
    const drawn = await open();
    const entity = kept(drawn);
    const quad = quadOf(drawn, entity) as pixi.Sprite | undefined;
    const before = quad?.texture.width ?? 0;

    // The scale frame draws the picture scaled (F67); the next one, at rest, retakes it at the new size.
    drawn.mock.world.ecs.set(entity, Transform, { scale: 2 });
    drawn.frames(2);

    const bounds = quad?.bounds;

    expect(keptNow(drawn, entity)).toBe(true);
    expect(quad?.texture.width).toBeGreaterThan(before * 1.5);
    expect(bounds === undefined ? 0 : bounds.maxX - bounds.minX).toBe(quad?.texture.width);
  });
});

describe("only the stage whose key changed is redone", () => {
  it("a filter value change redoes stage 3 only", async () => {
    const drawn = await open();
    const filter = new pixi.ColorMatrixFilter();
    const entity = kept(drawn, slotOf(filter));
    const from = drawn.stage.targets().length;

    // What `effects` does for a filter value: the call first, then the write.
    drawn.mock.api.invalidate(entity);
    filter.alpha = 0.5;
    drawn.frame();

    expect(rendersOf(drawn, entity, "#3", from)).toBe(1);
    expect(rendersOf(drawn, entity, "#1", from)).toBe(0);
    expect(keptNow(drawn, entity)).toBe(true);
  });

  it("a Display view's own invalidate retakes its subtree too", async () => {
    const drawn = await open(true);
    const flame = new pixi.Graphics().rect(0, 0, 30, 30).fill(0xff_80_00);
    const stove = drawn.spawn(Transform({ x: 100, y: 100 }), Display({ object: flame }));
    const lamp = drawn.spawn(Transform({ x: 300, y: 100 }), Shape({ w: 8, h: 8 }));

    drawn.mock.api.sync.filters.set(stove, [slotOf(new pixi.ColorMatrixFilter())]);

    // A lamp that moves every frame keeps the frames drawn.
    for (let frame = 1; frame <= 4; frame += 1) {
      drawn.mock.world.ecs.set(lamp, Transform, { x: 300 + frame });
      drawn.frame();
    }

    expect(keptNow(drawn, stove)).toBe(true);

    const from = drawn.stage.targets().length;

    drawn.mock.api.invalidate(stove);
    flame.clear().rect(0, 0, 30, 30).fill(0x00_80_ff);
    drawn.frame();

    expect(rendersOf(drawn, stove, "#1", from)).toBe(1);
  });

  it("an alpha change of the kept view itself retakes stage 1", async () => {
    const drawn = await open();
    const entity = kept(drawn);
    const from = drawn.stage.targets().length;

    drawn.mock.world.ecs.set(entity, Shape, { alpha: 0.5 });
    drawn.frame();

    expect(rendersOf(drawn, entity, "#1", from)).toBe(1);
  });
});

describe("what is never kept", () => {
  it("a screen filter, a slot without a category, a filter with blendRequired or a non-normal blend mode makes no picture", async () => {
    const drawn = await open();
    const backdrop = new pixi.ColorMatrixFilter();
    const added = new pixi.ColorMatrixFilter();

    backdrop.blendRequired = true;
    added.blendMode = "add";

    const entities = [
      kept(drawn, slotOf(new pixi.ColorMatrixFilter(), { cache: "screen" }), 100),
      kept(drawn, { filter: new pixi.ColorMatrixFilter(), passes: 1 }, 200),
      kept(drawn, slotOf(backdrop), 300),
      kept(drawn, slotOf(added), 400)
    ];

    drawn.frames(3);

    expect(entities.map(entity => rendersOf(drawn, entity, "#1"))).toEqual([0, 0, 0, 0]);
    expect(entities.map(entity => topOf(drawn, entity).renderable)).toEqual([
      true,
      true,
      true,
      true
    ]);
  });

  it("a placed filter under a filtered ancestor is drawn live; a local one there is kept", async () => {
    const drawn = await open();
    const panel = drawn.spawn(Transform({ x: 50, y: 50 }), Shape({ w: 300, h: 200 }));
    const lamp = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 10, y: 10 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: panel })
    ]);
    const icon = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 100, y: 10 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: panel })
    ]);

    // The panel's filter is drawn live in every frame: its own slot names no category.
    drawn.mock.api.sync.filters.set(panel, [{ filter: new pixi.ColorMatrixFilter(), passes: 1 }]);
    drawn.mock.api.sync.filters.set(lamp, [
      slotOf(new pixi.ColorMatrixFilter(), { cache: "placed", origin: new Float32Array(2) })
    ]);
    drawn.mock.api.sync.filters.set(icon, [slotOf(new pixi.ColorMatrixFilter())]);
    drawn.frames(4);

    expect(keptNow(drawn, lamp)).toBe(false);
    expect(keptNow(drawn, icon)).toBe(true);
  });

  it("with onDemand off, a filtered view holding a Display is not kept; with onDemand on, it is", async () => {
    for (const onDemand of [false, true]) {
      const drawn = await open(onDemand);
      const panel = drawn.spawn(Transform({ x: 50, y: 50 }), Shape({ w: 200, h: 200 }));
      const lamp = drawn.spawn(Transform({ x: 600, y: 100 }), Shape({ w: 8, h: 8 }));

      drawn.mock.world.ecs.spawn(OWNER, [
        Transform({ x: 10, y: 10 }),
        Display({ object: new pixi.Graphics().rect(0, 0, 20, 20).fill(0xff_00_00) }),
        Parent({ entity: panel })
      ]);
      drawn.mock.api.sync.filters.set(panel, [slotOf(new pixi.ColorMatrixFilter())]);

      for (let frame = 1; frame <= 5; frame += 1) {
        drawn.mock.world.ecs.set(lamp, Transform, { x: 600 + frame });
        drawn.frame();
      }

      expect(keptNow(drawn, panel)).toBe(onDemand);
    }
  });
});

describe("nested pictures, new tops, dropped views", () => {
  it("a nested kept view is rendered before its kept parent, and a change inside it retakes both", async () => {
    const drawn = await open();
    const panel = drawn.spawn(Transform({ x: 50, y: 50 }), Shape({ w: 200, h: 200 }));
    const icon = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 10, y: 10 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: panel })
    ]);
    const dot = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 2, y: 2 }),
      Shape({ w: 4, h: 4 }),
      Parent({ entity: icon })
    ]);

    drawn.mock.api.sync.filters.set(panel, [slotOf(new pixi.ColorMatrixFilter())]);
    drawn.mock.api.sync.filters.set(icon, [slotOf(new pixi.ColorMatrixFilter())]);
    drawn.frames(3);

    // The inner take changed what the outer picture holds: the outer stands still from then on.
    expect([keptNow(drawn, panel), keptNow(drawn, icon)]).toEqual([false, true]);

    drawn.frames(2);

    expect([keptNow(drawn, panel), keptNow(drawn, icon)]).toEqual([true, true]);

    const from = drawn.stage.targets().length;

    drawn.mock.world.ecs.set(dot, Transform, { x: 3 });
    drawn.frame();

    const labels = drawn.stage
      .targets()
      .slice(from)
      .map(call => call.target?.source.label)
      .filter(label => label?.endsWith("#1"));

    expect(labels).toEqual([
      `kept:${topOf(drawn, icon).label}#1`,
      `kept:${topOf(drawn, panel).label}#1`
    ]);
  });

  it("a view that gets a wrapper (it became a parent) is drawn live in that frame and taken again later", async () => {
    // A game's container draws nothing itself, so it is kept without a wrapper (D4) until it becomes a parent.
    const drawn = await open(true);
    const panel = new pixi.Container();
    const lamp = drawn.spawn(Transform({ x: 300, y: 100 }), Shape({ w: 8, h: 8 }));
    let lampX = 300;

    /** One drawn frame: the lamp moves. */
    const step = (): void => {
      lampX += 1;
      drawn.mock.world.ecs.set(lamp, Transform, { x: lampX });
      drawn.frame();
    };

    panel.addChild(new pixi.Graphics().rect(0, 0, 30, 30).fill(0xff_80_00));

    const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Display({ object: panel }));

    drawn.mock.api.sync.filters.set(entity, [slotOf(new pixi.ColorMatrixFilter())]);
    for (let frame = 0; frame < 4; frame += 1) step();

    const object = topOf(drawn, entity);

    expect(object).toBe(panel);
    expect(keptNow(drawn, entity)).toBe(true);

    drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 4, y: 4 }),
      Shape({ w: 8, h: 8 }),
      Parent({ entity })
    ]);
    step();

    const wrapper = topOf(drawn, entity);

    expect(wrapper).not.toBe(object);
    expect(wrapper.renderable).toBe(true);
    expect(wrapper.filters).toHaveLength(1);
    expect(keptNow(drawn, entity)).toBe(false);

    step();
    step();

    expect(keptNow(drawn, entity)).toBe(true);
  });

  it("a kept bare view that becomes a parent keeps its wrapper: the child hangs in it and the picture is retaken", async () => {
    const drawn = await open();
    const entity = kept(drawn);
    const wrapper = topOf(drawn, entity);
    const from = drawn.stage.targets().length;

    drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 4, y: 4 }),
      Shape({ w: 8, h: 8 }),
      Parent({ entity })
    ]);
    drawn.frame();

    expect(topOf(drawn, entity)).toBe(wrapper);
    expect(wrapper.children).toHaveLength(2);
    expect(rendersOf(drawn, entity, "#1", from)).toBe(1);
    expect(keptNow(drawn, entity)).toBe(true);
  });

  it("taking and releasing are atomic: in every drawn frame the view or its quad is drawn, never both, never neither", async () => {
    const drawn = await open();
    const entity = filtered(drawn, slotOf(new pixi.ColorMatrixFilter()));
    const child = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 4, y: 4 }),
      Shape({ w: 8, h: 8 }),
      Parent({ entity })
    ]);
    const shown: string[] = [];

    // Still, churning, calm, still again: takes and releases in turn.
    for (let frame = 0; frame < 30; frame += 1) {
      if (frame % 10 >= 4 && frame % 10 < 7)
        drawn.mock.world.ecs.set(child, Transform, { x: frame });

      drawn.frame();

      const top = topOf(drawn, entity);
      const quad = quadOf(drawn, entity);

      shown.push(`${top.renderable ? "view" : ""}${quad?.visible === true ? "quad" : ""}`);
    }

    expect(shown.filter(entry => entry !== "view" && entry !== "quad")).toEqual([]);
    expect(shown).toContain("view");
    expect(shown).toContain("quad");
  });

  it("a dropped view's record is gone before the object returns to the pool: no filters, no reasons, no render group", async () => {
    const drawn = await open();
    const entity = kept(drawn);
    const object = topOf(drawn, entity);
    const quad = quadOf(drawn, entity);

    expect(object.isRenderGroup).toBe(true);

    drawn.mock.world.ecs.despawn(entity);
    drawn.frame();

    expect(object.parent).toBeNull();
    expect(object.filters ?? []).toEqual([]);
    expect(object.renderable).toBe(true);
    expect(object.isRenderGroup).toBe(false);
    expect(quad?.destroyed).toBe(true);
    expect(drawn.mock.ctx.state.kept.records).toEqual([]);
  });
});

describe("the debug switch", () => {
  it("debug.kept(false) draws every view live in the next drawn frame; true lets them be taken again", async () => {
    const drawn = await open(true);
    const lamp = drawn.spawn(Transform({ x: 600, y: 100 }), Shape({ w: 8, h: 8 }));
    const entity = filtered(drawn, slotOf(new pixi.ColorMatrixFilter()));
    /** Moves the lamp, so frames are drawn. */
    const glide = (frames: number): void => {
      for (let frame = 0; frame < frames; frame += 1) {
        drawn.mock.world.ecs.set(lamp, Transform, { x: (drawn.objectOf(lamp)?.x ?? 0) + 1 });
        drawn.frame();
      }
    };

    glide(3);

    expect(keptNow(drawn, entity)).toBe(true);

    drawn.mock.api.sync.debug.kept(false);

    expect(drawn.frame()).toBe(true);
    expect(keptNow(drawn, entity)).toBe(false);
    expect(drawn.mock.api.sync.debug.state().kept).toBe(false);

    drawn.mock.api.sync.debug.kept(true);
    glide(3);

    expect(keptNow(drawn, entity)).toBe(true);
  });
});

describe("the debug switch called without a boolean", () => {
  // Bug (F121): `debug.kept()` meant as a read switched every kept picture off and spoiled a measuring log.
  // `0` and `null` read as off before the guard; `undefined` is the call with no argument.
  // eslint-disable-next-line unicorn/no-null -- a console caller may pass null.
  it.each([undefined, null, 0, "false"])("switches nothing for %s and names the call", async on => {
    const drawn = await open(true);
    const warn = vi.spyOn(drawn.mock.log, "warn");
    const toggle = drawn.mock.api.sync.debug.kept as (on?: unknown) => void;

    toggle(on);

    expect(drawn.mock.api.sync.debug.state().kept).toBe(true);
    expect(warn).toHaveBeenCalledWith("renderer:debug-kept-needs-boolean", { on });
  });
});

describe("placed filters and settling", () => {
  it("a placed filter's origin is the picture's canvas origin in the picture and 0 drawn live", async () => {
    const drawn = await open();
    const origin = new Float32Array(2);
    const entity = kept(drawn, slotOf(new pixi.ColorMatrixFilter(), { cache: "placed", origin }));

    expect([...origin]).toEqual([100, 100]);

    drawn.mock.api.sync.debug.kept(false);
    drawn.frame();

    expect([...origin]).toEqual([0, 0]);
    expect(keptNow(drawn, entity)).toBe(false);
  });

  it("a placed view that moves redoes stage 3 only, and nothing at rest", async () => {
    const drawn = await open();
    const origin = new Float32Array(2);
    const entity = kept(drawn, slotOf(new pixi.ColorMatrixFilter(), { cache: "placed", origin }));
    const from = drawn.stage.targets().length;

    for (let frame = 1; frame <= 5; frame += 1) {
      drawn.mock.world.ecs.set(entity, Transform, { x: 100 + frame });
      drawn.frame();
    }

    expect(rendersOf(drawn, entity, "#3", from)).toBe(5);
    expect(rendersOf(drawn, entity, "#1", from)).toBe(0);
    expect([...origin]).toEqual([105, 100]);

    const rest = drawn.stage.targets().length;

    drawn.frames(5);

    expect(drawn.stage.targets().length).toBe(rest);
  });

  it("a settle retake happens once at rest after a fractional move, and asks for that frame", async () => {
    const drawn = await open(true);
    const lamp = drawn.spawn(Transform({ x: 600, y: 100 }), Shape({ w: 8, h: 8 }));
    const entity = filtered(drawn, slotOf(new pixi.ColorMatrixFilter()));

    for (let frame = 1; frame <= 3; frame += 1) {
      drawn.mock.world.ecs.set(lamp, Transform, { x: 600 + frame });
      drawn.frame();
    }

    expect(keptNow(drawn, entity)).toBe(true);

    const from = drawn.stage.targets().length;

    drawn.mock.world.ecs.set(entity, Transform, { x: 100.25 });

    expect(drawn.frame()).toBe(true);
    expect(rendersOf(drawn, entity, "#1", from)).toBe(0);
    // Nothing changed, yet the frame is drawn: the settle asked for it, and retakes the picture at its new phase.
    expect(drawn.frame()).toBe(true);
    expect(rendersOf(drawn, entity, "#1", from)).toBe(1);
    expect(drawn.frames(3)).toBe(0);
  });

  it("a whole-texel move owes no settle", async () => {
    const drawn = await open(true);
    const lamp = drawn.spawn(Transform({ x: 600, y: 100 }), Shape({ w: 8, h: 8 }));
    const entity = filtered(drawn, slotOf(new pixi.ColorMatrixFilter()));

    for (let frame = 1; frame <= 3; frame += 1) {
      drawn.mock.world.ecs.set(lamp, Transform, { x: 600 + frame });
      drawn.frame();
    }

    const from = drawn.stage.targets().length;

    drawn.mock.world.ecs.set(entity, Transform, { x: 101 });

    expect(drawn.frame()).toBe(true);
    expect(drawn.frames(3)).toBe(0);
    expect(rendersOf(drawn, entity, "#1", from)).toBe(0);
    expect(keptNow(drawn, entity)).toBe(true);
  });
});

describe("device loss and the stop", () => {
  it("a lost device destroys every kept texture; the view rebuilt after the restore is taken again", async () => {
    const drawn = await open();
    const entity = kept(drawn);
    const record = drawn.mock.ctx.state.kept.byEntity.get(entity);
    const textures = [record?.s1, record?.s3];

    // What `host.onLoss` and `host.onRestore` run.
    drawn.mock.modules.sync.forget();

    expect(textures.map(texture => texture?.destroyed)).toEqual([true, true]);
    expect(drawn.mock.ctx.state.kept.records).toEqual([]);
    expect(drawn.mock.ctx.state.kept.bytes).toBe(0);

    drawn.mock.modules.sync.rebuildAll();
    drawn.frames(3);

    expect(keptNow(drawn, entity)).toBe(true);
  });

  it("stopRenderer destroys every kept texture before the application goes", async () => {
    const drawn = await startDrawn({ onDemand: false });
    const entity = kept(drawn);
    const record = drawn.mock.ctx.state.kept.byEntity.get(entity);
    const textures = [record?.s1, record?.s3];
    const app = drawn.stage.last();
    const destroy = app.destroy.bind(app);
    let atDestroy: Array<boolean | undefined> = [];

    app.destroy = () => {
      atDestroy = textures.map(texture => texture?.destroyed);
      destroy();
    };
    drawn.mock.stop();

    expect(atDestroy).toEqual([true, true]);
    expect(drawn.mock.ctx.state.kept.records).toEqual([]);
  });
});

/**
 * A 40 x 40 label with a filter inside a camera container, kept.
 *
 * @param drawn - The running renderer.
 * @returns The camera and the label.
 */
function zoomed(drawn: Drawn): { camera: Entity; label: Entity } {
  const camera = drawn.spawn(Transform({ x: 0, y: 0 }), Shape({ w: 1, h: 1 }));
  const label = drawn.mock.world.ecs.spawn(OWNER, [
    Transform({ x: 100, y: 100 }),
    Shape({ w: 40, h: 40 }),
    Parent({ entity: camera })
  ]);

  drawn.mock.api.sync.filters.set(label, [slotOf(new pixi.ColorMatrixFilter())]);
  drawn.frames(4);

  return { camera, label };
}

describe("a kept picture under an ancestor's zoom (F67)", () => {
  // Bug F67: every frame of a glide changed the linear part above the picture, so it was retaken three times and then
  // drawn live, its filter pass every frame (the case-sheet's perspective labels: 2 passes a frame during each glide).
  it("draws the picture scaled while an ancestor zooms: no retake, no render into a texture, still kept", async () => {
    const drawn = await open();
    const { camera, label } = zoomed(drawn);

    expect(keptNow(drawn, label)).toBe(true);

    const from = drawn.stage.targets().length;

    for (let frame = 1; frame <= 12; frame += 1) {
      drawn.mock.world.ecs.set(camera, Transform, { scale: 1 + frame * 0.05 });
      drawn.frame();

      expect(keptNow(drawn, label)).toBe(true);
    }

    expect(drawn.stage.targets().length - from).toBe(0);
  });

  // Bug: the quad's place under a zoom stands, but its inverse rounds otherwise in every frame (about 1e-13), so the
  // quad was placed again in every frame through Pixi's `decompose`: 88 B a frame once its setters box.
  it("places the quad no more than once while an ancestor zooms: its place under the zoom stands", async () => {
    const drawn = await open();
    const { camera, label } = zoomed(drawn);
    const quad = quadOf(drawn, label);

    if (quad === undefined) throw new Error("no quad");

    const placed = vi.spyOn(quad, "setFromMatrix");

    for (let frame = 1; frame <= 12; frame += 1) {
      drawn.mock.world.ecs.set(camera, Transform, { scale: frame % 2 === 0 ? 1.1 : 1.2 });
      drawn.frame();
    }

    expect(placed.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("retakes the picture once at rest, at the new scale", async () => {
    const drawn = await open();
    const { camera, label } = zoomed(drawn);
    const from = drawn.stage.targets().length;

    for (let frame = 1; frame <= 6; frame += 1) {
      drawn.mock.world.ecs.set(camera, Transform, { scale: 1 + frame * 0.1 });
      drawn.frame();
    }

    drawn.frames(3);

    expect(rendersOf(drawn, label, "#1", from)).toBe(1);
    expect(keptNow(drawn, label)).toBe(true);
    expect((quadOf(drawn, label) as pixi.Sprite | undefined)?.texture.width).toBeCloseTo(
      40 * 1.6,
      0
    );
  });

  it("retakes a picture zoomed past twice its scale, and draws it scaled again from there", async () => {
    const drawn = await open();
    const { camera, label } = zoomed(drawn);
    const from = drawn.stage.targets().length;

    // 1 → 2.5 in fifteen frames: the area scale passes 4 once, at 2.1.
    for (let frame = 1; frame <= 15; frame += 1) {
      drawn.mock.world.ecs.set(camera, Transform, { scale: 1 + frame * 0.1 });
      drawn.frame();

      expect(keptNow(drawn, label)).toBe(true);
    }

    expect(rendersOf(drawn, label, "#1", from)).toBe(1);
  });
});

/**
 * A 40 x 40 icon with a filter under a 200 x 200 panel, built and not taken yet.
 *
 * @param drawn - The running renderer.
 * @param slot - The icon's filter slot.
 * @returns The panel and the icon.
 */
function underPanel(
  drawn: Drawn,
  slot: FilterSlot = slotOf(new pixi.ColorMatrixFilter())
): { panel: Entity; icon: Entity } {
  const panel = drawn.spawn(Transform({ x: 50, y: 50 }), Shape({ w: 200, h: 200 }));
  const icon = drawn.mock.world.ecs.spawn(OWNER, [
    Transform({ x: 10, y: 10 }),
    Shape({ w: 40, h: 40 }),
    Parent({ entity: panel })
  ]);

  drawn.mock.api.sync.filters.set(icon, [slot]);
  drawn.frame();

  return { panel, icon };
}

/**
 * The alpha the stage pass draws a node at: its own times every ancestor's.
 *
 * @param node - The node.
 * @returns The product.
 */
function worldAlphaOf(node: PixiContainer): number {
  let alpha = 1;

  for (let at: PixiContainer | null = node; at !== null; at = at.parent) alpha *= at.alpha;

  return alpha;
}

describe("a still picture under a fading or zooming ancestor (F113)", () => {
  // Bug F113: a fading ancestor drew every filtered view under it live, 2–3 passes a view in every frame of the fade
  // (A Memory Missing's board under a memory fading out: 10 passes a frame for one generator).
  it("keeps the picture under a fading ancestor, drawn at the ancestor's alpha, and live with no pass at alpha 0", async () => {
    const drawn = await open();
    const { panel, icon } = underPanel(drawn);

    drawn.frames(2);

    expect(keptNow(drawn, icon)).toBe(true);

    const from = drawn.stage.targets().length;

    for (const alpha of [0.5, 0.25]) {
      drawn.mock.world.ecs.set(panel, Shape, { alpha });
      drawn.frame();

      expect(keptNow(drawn, icon)).toBe(true);
      expect(topOf(drawn, icon).filters ?? []).toEqual([]);
      expect(worldAlphaOf(quadOf(drawn, icon) as PixiContainer)).toBeCloseTo(alpha, 6);
    }

    expect(drawn.stage.targets().length - from).toBe(0);

    drawn.mock.world.ecs.set(panel, Shape, { alpha: 0 });
    drawn.frame();

    expect(keptNow(drawn, icon)).toBe(false);
    expect(drawn.stage.targets().length - from).toBe(0);

    drawn.mock.world.ecs.set(panel, Shape, { alpha: 1 });
    drawn.frames(3);

    expect(keptNow(drawn, icon)).toBe(true);
    expect(rendersOf(drawn, icon, "#1", from)).toBe(1);
  });

  // Bug F113: under an ancestor that zooms every frame a view never stood still, so it was drawn live for the whole
  // zoom (the board's entry: every piece's shadow live for 24 frames).
  it("takes a still view while an ancestor zooms, once, and draws it scaled from there", async () => {
    const drawn = await open();
    const { panel, icon } = underPanel(drawn);
    const from = drawn.stage.targets().length;

    for (let frame = 1; frame <= 10; frame += 1) {
      drawn.mock.world.ecs.set(panel, Transform, { scale: 1 + frame * 0.05 });
      drawn.frame();
    }

    expect(keptNow(drawn, icon)).toBe(true);
    expect(rendersOf(drawn, icon, "#1", from)).toBe(1);
  });

  // Bug: counted still under a zoom, a view whose subtree changes every frame is taken anyway and retaken every frame.
  it("counts a change under the view during a zoom: no take until two frames without one", async () => {
    const drawn = await open();
    const { panel, icon } = underPanel(drawn);

    for (let frame = 1; frame <= 6; frame += 1) {
      drawn.mock.world.ecs.set(panel, Transform, { scale: 1 + frame * 0.05 });
      drawn.mock.world.ecs.set(icon, Shape, { w: 40 + frame });
      drawn.frame();
    }

    expect(rendersOf(drawn, icon, "#1")).toBe(0);

    drawn.mock.world.ecs.set(panel, Transform, { scale: 1.4 });
    drawn.frame();
    drawn.mock.world.ecs.set(panel, Transform, { scale: 1.45 });
    drawn.frame();

    expect(keptNow(drawn, icon)).toBe(true);
  });

  // Bug: a placed filter is never drawn scaled; taken under a zoom it was retaken in every frame, went calm and was
  // taken again after eight, where it stays live.
  it("keeps a placed filter live through a zoom", async () => {
    const drawn = await open();
    const { panel, icon } = underPanel(
      drawn,
      slotOf(new pixi.ColorMatrixFilter(), { cache: "placed" })
    );

    for (let frame = 1; frame <= 12; frame += 1) {
      drawn.mock.world.ecs.set(panel, Transform, { scale: 1 + frame * 0.05 });
      drawn.frame();
    }

    expect(rendersOf(drawn, icon, "#1")).toBe(0);
    expect(keptNow(drawn, icon)).toBe(false);
  });

  // Bug: a view that churned waits for real rest; counted still under a zoom it was taken and churned again.
  it("keeps a view that churned live through a zoom, and takes it at rest", async () => {
    const drawn = await open();
    const { panel, icon } = underPanel(drawn);

    drawn.frames(2);

    for (const alpha of [0.9, 0.8, 0.7]) {
      drawn.mock.world.ecs.set(icon, Shape, { alpha });
      drawn.frame();
    }

    expect(keptNow(drawn, icon)).toBe(false);

    const from = drawn.stage.targets().length;

    for (let frame = 1; frame <= 12; frame += 1) {
      drawn.mock.world.ecs.set(panel, Transform, { scale: 1 + frame * 0.05 });
      drawn.frame();
    }

    expect(rendersOf(drawn, icon, "#1", from)).toBe(0);

    drawn.frames(9);

    expect(keptNow(drawn, icon)).toBe(true);
  });

  // Bug: the quad of a view taken under a zoom moves by rounding every frame, and the picture holding it is retaken in
  // every frame of the zoom.
  it("does not retake an outer picture in every frame of a zoom above it and an inner view", async () => {
    const drawn = await open();
    const camera = drawn.spawn(Transform({ x: 0, y: 0 }), Shape({ w: 1, h: 1 }));
    const outer = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 50, y: 50 }),
      Shape({ w: 200, h: 200 }),
      Parent({ entity: camera })
    ]);
    const inner = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 10, y: 10 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: outer })
    ]);

    drawn.mock.api.sync.filters.set(outer, [slotOf(new pixi.ColorMatrixFilter())]);
    drawn.mock.api.sync.filters.set(inner, [slotOf(new pixi.ColorMatrixFilter())]);
    drawn.frame();

    for (let frame = 1; frame <= 16; frame += 1) {
      drawn.mock.world.ecs.set(camera, Transform, { scale: 1 + frame * 0.03 });
      drawn.frame();
    }

    expect(keptNow(drawn, outer)).toBe(true);
    expect(rendersOf(drawn, outer, "#1")).toBeLessThanOrEqual(2);
  });
});

describe("the first takes of a frame (F114)", () => {
  // Bug F114: every view that stood still took its first picture in the same frame, the take passes of a whole board in
  // one frame (A Memory Missing's board appearing under a fading memory: 10 passes against a budget of 7).
  it("takes one first picture per frame of views not drawn as an alpha, the others the frames after", async () => {
    const drawn = await open();
    const views = [100, 200, 300].map(x =>
      drawn.spawn(Transform({ x, y: 100 }), Shape({ w: 40, h: 40 }))
    );

    drawn.frame();
    for (const view of views)
      drawn.mock.api.sync.filters.set(view, [slotOf(new pixi.ColorMatrixFilter())]);

    const taken: number[] = [];

    for (let frame = 0; frame < 6; frame += 1) {
      drawn.frame();
      taken.push(views.filter(view => keptNow(drawn, view)).length);
    }

    expect(taken).toEqual([0, 0, 1, 2, 3, 3]);
  });

  // Bug F114: a stack of alphas drawn live for two frames costs two passes each, where its picture costs one.
  it("takes every view drawn as an alpha in its first eligible frame, no cap among them", async () => {
    const drawn = await open();
    const views = [100, 200].map(x =>
      drawn.spawn(Transform({ x, y: 100 }), Shape({ w: 40, h: 40 }))
    );

    drawn.frame();
    for (const view of views)
      drawn.mock.api.sync.filters.set(view, [slotOf(new pixi.AlphaFilter({ alpha: 0.5 }))]);
    drawn.frame();

    expect(views.map(view => keptNow(drawn, view))).toEqual([false, false]);

    drawn.frame();

    expect(views.map(view => keptNow(drawn, view))).toEqual([true, true]);
    expect(views.map(view => rendersOf(drawn, view, "#1"))).toEqual([1, 1]);
  });

  // Guard (the owner's instant-reaction rule): no view waits hidden for its picture. A new alpha is drawn in its first
  // frame, live with its filter on its top, and from its quad the next.
  it("draws a new alpha live in its first frame and from its quad the next", async () => {
    const drawn = await open();
    const sheet = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.frame();
    drawn.mock.api.sync.filters.set(sheet, [slotOf(new pixi.AlphaFilter({ alpha: 0.5 }))]);
    drawn.frame();

    expect(topOf(drawn, sheet).renderable).toBe(true);
    expect(topOf(drawn, sheet).filters ?? []).toHaveLength(1);

    drawn.frame();

    expect(keptNow(drawn, sheet)).toBe(true);
    expect(quadOf(drawn, sheet)?.visible).toBe(true);
  });

  // Guard (the owner's instant-reaction rule): a view whose first take waits for another's is drawn live meanwhile,
  // its filter on its top, never hidden.
  it("draws a view whose first take waits live, its filter on its top", async () => {
    const drawn = await open();
    const [first, second] = [200, 300].map(x =>
      drawn.spawn(Transform({ x, y: 100 }), Shape({ w: 40, h: 40 }))
    ) as [Entity, Entity];

    drawn.frame();
    for (const view of [first, second])
      drawn.mock.api.sync.filters.set(view, [slotOf(new pixi.ColorMatrixFilter())]);
    drawn.frames(3);

    expect([keptNow(drawn, first), keptNow(drawn, second)].filter(Boolean)).toHaveLength(1);

    const waiting = keptNow(drawn, first) ? second : first;

    expect(topOf(drawn, waiting).renderable).toBe(true);
    expect(topOf(drawn, waiting).filters ?? []).toHaveLength(1);
  });

  // Bug: inner views taking their first pictures one per frame retake the kept picture around them in each of those
  // frames; counted as churn, it fell to live for eight frames.
  it("keeps the picture around views that take their first pictures one per frame", async () => {
    const drawn = await open();
    const panel = drawn.spawn(Transform({ x: 50, y: 50 }), Shape({ w: 300, h: 200 }));
    const icons = [10, 80, 150].map(x =>
      drawn.mock.world.ecs.spawn(OWNER, [
        Transform({ x, y: 10 }),
        Shape({ w: 40, h: 40 }),
        Parent({ entity: panel })
      ])
    );

    drawn.mock.api.sync.filters.set(panel, [slotOf(new pixi.ColorMatrixFilter())]);
    drawn.frames(4);

    expect(keptNow(drawn, panel)).toBe(true);

    for (const icon of icons)
      drawn.mock.api.sync.filters.set(icon, [slotOf(new pixi.ColorMatrixFilter())]);

    for (let frame = 0; frame < 7; frame += 1) {
      drawn.frame();

      expect(keptNow(drawn, panel)).toBe(true);
    }

    expect(icons.map(icon => keptNow(drawn, icon))).toEqual([true, true, true]);
  });

  // Bug (A Memory Missing, the memory leaving over the board): an alpha's first frame drawn counted as a change, so it
  // was drawn live for two passes, and its take then fell in the frame of another view's first take (8 passes, not 7).
  it("takes an alpha in the first frame its panel shows, and the other view due then waits a frame", async () => {
    const drawn = await open();
    const panel = drawn.spawn(Transform({ x: 50, y: 50 }), Shape({ w: 200, h: 200, alpha: 0 }));
    const sheet = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 10, y: 10 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: panel })
    ]);
    // Deeper than the sheet, so its record steps first.
    const outer = drawn.spawn(Transform({ x: 300, y: 50 }), Shape({ w: 200, h: 200 }));
    const inner = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 0, y: 0 }),
      Shape({ w: 100, h: 100 }),
      Parent({ entity: outer })
    ]);
    const blurred = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 10, y: 10 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: inner })
    ]);

    drawn.frame();
    drawn.mock.api.sync.filters.set(sheet, [slotOf(new pixi.AlphaFilter({ alpha: 0.5 }))]);
    drawn.mock.api.sync.filters.set(blurred, [slotOf(new pixi.ColorMatrixFilter())]);
    drawn.frames(2);

    expect([keptNow(drawn, sheet), keptNow(drawn, blurred)]).toEqual([false, false]);

    drawn.mock.world.ecs.set(panel, Shape, { alpha: 1 });
    drawn.frame();

    expect([keptNow(drawn, sheet), keptNow(drawn, blurred)]).toEqual([true, false]);

    drawn.frame();

    expect([keptNow(drawn, sheet), keptNow(drawn, blurred)]).toEqual([true, true]);
  });

  // Bug: an alpha cut to the canvas under a zoom is due in every frame and refused in every frame (a cut picture waits
  // for rest, F113): it held every other first take back for the whole zoom (the board's entry).
  it("lets an alpha refused under a zoom hold the other first takes back once, not for the whole zoom", async () => {
    const drawn = await open();
    const panel = drawn.spawn(Transform({ x: 0, y: 0 }), Shape({ w: 400, h: 400 }));
    const sheet = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: -1000, y: 0 }),
      Shape({ w: 3000, h: 400 }),
      Parent({ entity: panel })
    ]);
    const blurred = drawn.spawn(Transform({ x: 100, y: 500 }), Shape({ w: 40, h: 40 }));

    drawn.frame();
    drawn.mock.api.sync.filters.set(sheet, [slotOf(new pixi.AlphaFilter({ alpha: 0.5 }))]);
    drawn.mock.api.sync.filters.set(blurred, [slotOf(new pixi.ColorMatrixFilter())]);

    for (let frame = 1; frame <= 6; frame += 1) {
      drawn.mock.world.ecs.set(panel, Transform, { scale: 1 + frame * 0.05 });
      drawn.frame();
    }

    expect([keptNow(drawn, sheet), keptNow(drawn, blurred)]).toEqual([false, true]);
  });

  // Bug: a view whose take renders nothing (off the canvas) is offered again every few frames, each attempt building its
  // bounds; or it holds the frame's one first take so a view on the canvas waits for ever.
  it("tries a view off the canvas once, takes a view on the canvas, and tries again when it moves", async () => {
    const drawn = await open();
    const away = [5000, 6000, 7000].map(x =>
      drawn.spawn(Transform({ x, y: 100 }), Shape({ w: 40, h: 40 }))
    );
    const here = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.frame();
    for (const view of [...away, here])
      drawn.mock.api.sync.filters.set(view, [slotOf(new pixi.ColorMatrixFilter())]);
    drawn.frames(4);

    expect(keptNow(drawn, here)).toBe(true);

    const records = away.map(view => drawn.mock.ctx.state.kept.byEntity.get(view));

    expect(records.map(record => record?.idle)).toEqual([true, true, true]);

    drawn.mock.world.ecs.set(away[0] ?? 0, Transform, { x: 120, y: 300 });
    drawn.frames(4);

    expect(keptNow(drawn, away[0] ?? 0)).toBe(true);
    expect(records.slice(1).map(record => record?.idle)).toEqual([true, true]);
  });
});
