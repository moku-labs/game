import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Display, Shape, Sprite, Transform } from "../../components";
import type { FilterSlot, PixiContainer } from "../../types";
import { type Drawn, startDrawn } from "../demand-harness";
import type { RenderCall } from "../stage-pixi";

// ---------------------------------------------------------------------------
// Kept pictures of bare views (spec 23 D4): a sprite, a nine-slice or a shape
// without a wrapper gets one before its first take, so the first render of its
// picture has a plain container for its root and the visual inside keeps its own
// transform, tint and alpha. The whole renderer runs over the real Pixi of
// `stagePixi`; the tree oracle and the picture oracle check every frame.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

/**
 * Starts the renderer and keeps it for the teardown.
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
 * @returns The slot.
 */
function slot(): FilterSlot {
  return { filter: new pixi.AlphaFilter(), passes: 1, cache: "local" };
}

/**
 * The view of an entity.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns Its object and its wrapper.
 */
function viewOf(
  drawn: Drawn,
  entity: Entity
): { object: PixiContainer; wrapper: PixiContainer | undefined } {
  const view = drawn.mock.ctx.state.sync.views.get(entity);

  if (view === undefined) throw new Error(`no view for ${entity}`);

  return { object: view.object, wrapper: view.wrapper };
}

/**
 * The renders of the first stage of an entity's pictures: the subtree renders, whose root is its top.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns The render calls.
 */
function stageOneOf(drawn: Drawn, entity: Entity): RenderCall[] {
  const { object, wrapper } = viewOf(drawn, entity);
  const top = wrapper ?? object;

  return drawn.stage.targets().filter(call => call.target?.source.label === `kept:${top.label}#1`);
}

/**
 * Tells whether a node draws itself: a Pixi view holds a render pipe, a plain container none.
 *
 * @param node - The node.
 * @returns True for a sprite, a graphics, a nine-slice.
 */
function drawsItself(node: PixiContainer): boolean {
  const pipe: string | undefined = node.renderPipeId;

  return pipe !== undefined;
}

/**
 * Filters a view and lets it stand still until its picture is taken.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity, spawned this frame.
 */
function keep(drawn: Drawn, entity: Entity): void {
  drawn.mock.api.sync.filters.set(entity, [slot()]);
  drawn.frames(3);
}

describe("a kept bare view is drawn into its picture from a wrapper (D4)", () => {
  // Bug: the first take rendered the sprite itself as the root of a render group; Pixi's sprite pipe kept the group
  // transform it had cached, so the sprite landed outside its picture and the picture was empty (ticktoe's pieces).
  it("renders a bare Sprite's first picture from a plain container that holds the sprite where it stood", async () => {
    const drawn = await open();
    const piece = drawn.spawn(
      Transform({ x: 120, y: 80, scale: 0.5, pivot: { x: 0, y: -20 } }),
      Sprite({ texture: "piece", width: 40, height: 40, anchor: { x: 0.5, y: 1 } })
    );

    drawn.frame();

    const sprite = viewOf(drawn, piece).object;
    const before = sprite.getGlobalTransform(undefined, false).clone();

    keep(drawn, piece);

    const [first] = stageOneOf(drawn, piece);
    const after = sprite.getGlobalTransform(undefined, false);

    expect(first).toBeDefined();
    expect(drawsItself(first?.container ?? sprite)).toBe(false);
    expect(first?.container.children).toContain(sprite);
    expect([after.a, after.b, after.c, after.d, after.tx, after.ty]).toEqual(
      [before.a, before.b, before.c, before.d, before.tx, before.ty].map(value =>
        expect.closeTo(value, 9)
      )
    );
  });

  // Bug: a fill-only shape is white and coloured by its tint; made the root of its picture, its tint was applied
  // twice (the group's colour and its own), so the picture drew 0x3388ff as 0x0a49ff.
  it("keeps a tinted fill-only Shape's tint on the shape inside a root that tints nothing", async () => {
    const drawn = await open();
    const button = drawn.spawn(
      Transform({ x: 100, y: 100 }),
      Shape({ w: 120, h: 60, fill: 0x33_88_ff })
    );

    drawn.frame();
    keep(drawn, button);

    const [first] = stageOneOf(drawn, button);

    expect(first?.container.tint).toBe(0xff_ff_ff);
    expect(viewOf(drawn, button).object.tint).toBe(0x33_88_ff);
  });

  // Bug: made the root of its picture, a shape at alpha 0.5 drew its alpha twice: the picture at 0.25. Its alpha is
  // drawn once, by the quad (F120): the root keeps it, the shape inside is at 1.
  it("draws a Shape at alpha 0.5 once: its quad at 0.5, the root at 0.5, the shape inside at 1", async () => {
    const drawn = await open();
    const ghost = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 60, h: 60, alpha: 0.5 }));

    drawn.frame();
    keep(drawn, ghost);

    const [first] = stageOneOf(drawn, ghost);

    expect(first?.container.alpha).toBe(0.5);
    expect(drawn.mock.ctx.state.kept.byEntity.get(ghost)?.quad?.alpha).toBe(0.5);
    expect(viewOf(drawn, ghost).object.alpha).toBe(1);
  });
});

describe("when a bare view is wrapped", () => {
  // Bug: a wrapper made at every take, or dropped when the view goes live, allocates and rebuilds the parent's
  // instructions each time a view that pulses is taken again.
  it("keeps one wrapper while the view goes live and is taken again", async () => {
    const drawn = await open();
    const lamp = drawn.spawn(
      Transform({ x: 100, y: 100 }),
      Shape({ w: 40, h: 40, fill: 0xff_00_00 })
    );

    drawn.frame();
    keep(drawn, lamp);

    const wrapper = viewOf(drawn, lamp).wrapper;

    // Three colour changes in a row draw it live; eight still frames take it again.
    for (const fill of [0x00_ff_00, 0x00_00_ff, 0xff_ff_00]) {
      drawn.mock.world.ecs.set(lamp, Shape, { fill });
      drawn.frame();
    }

    drawn.frames(9);

    expect(wrapper).toBeDefined();
    expect(viewOf(drawn, lamp).wrapper).toBe(wrapper);
    expect(stageOneOf(drawn, lamp).length).toBeGreaterThanOrEqual(3);
    expect(wrapper?.renderable).toBe(false);
  });

  // Bug: wrapping every filtered view when its record is made gives a container to views that are never kept.
  it("leaves a filtered view that changes every frame without a wrapper", async () => {
    const drawn = await open();
    const blink = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.frame();
    // Not a stack of alphas: one is taken in its first eligible frame whatever it does next (F114).
    drawn.mock.api.sync.filters.set(blink, [
      { filter: new pixi.ColorMatrixFilter(), passes: 1, cache: "local" }
    ]);

    for (let frame = 0; frame < 12; frame += 1) {
      drawn.mock.world.ecs.set(blink, Shape, { fill: frame % 2 === 0 ? 0xff_00_00 : 0x00_ff_00 });
      drawn.frame();
    }

    expect(stageOneOf(drawn, blink)).toEqual([]);
    expect(viewOf(drawn, blink).wrapper).toBeUndefined();
  });

  // Bug: a wrap that marks the view draws the next frame for nothing and retakes the picture it has just taken.
  it("marks nothing: on demand, the frames after the take draw nothing and retake nothing", async () => {
    const drawn = await open(true);
    const badge = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));
    const ticker = drawn.spawn(Transform({ x: 300, y: 100 }), Shape({ w: 8, h: 8 }));

    drawn.frame();
    drawn.mock.api.sync.filters.set(badge, [slot()]);

    // A ticker that moves keeps the frames drawn until the badge is taken.
    for (let frame = 1; stageOneOf(drawn, badge).length === 0 && frame < 10; frame += 1) {
      drawn.mock.world.ecs.set(ticker, Transform, { x: 300 + frame });
      drawn.frame();
    }

    expect(viewOf(drawn, badge).wrapper).toBeDefined();
    expect(drawn.frames(3)).toBe(0);
    expect(stageOneOf(drawn, badge)).toHaveLength(1);
  });
});

describe("a wrapped view's own visual", () => {
  // Bug: once wrapped, the top blends normally, so a visual that turned additive inside it was baked into the picture
  // against nothing instead of adding to what is drawn under it.
  it("draws the view live when its visual turns to another blend mode", async () => {
    const drawn = await open(true);
    const flame = new pixi.Sprite(drawn.texture);
    const stove = drawn.spawn(Transform({ x: 100, y: 100 }), Display({ object: flame }));
    const ticker = drawn.spawn(Transform({ x: 300, y: 100 }), Shape({ w: 8, h: 8 }));
    let tickerX = 300;

    /** One drawn frame: the ticker moves. */
    const step = (): void => {
      tickerX += 1;
      drawn.mock.world.ecs.set(ticker, Transform, { x: tickerX });
      drawn.frame();
    };

    drawn.frame();
    drawn.mock.api.sync.filters.set(stove, [slot()]);
    for (let frame = 0; frame < 4; frame += 1) step();

    const wrapper = viewOf(drawn, stove).wrapper;

    expect(wrapper?.renderable).toBe(false);

    drawn.mock.api.invalidate(stove);
    flame.blendMode = "add";
    step();

    expect(wrapper?.renderable).toBe(true);
  });
});

describe("a top that stops being a render group", () => {
  // Bug: Pixi's `disableRenderGroup` hands the children to the parent's group with the colour they had inside the
  // group they left, without the top's own alpha: a view at alpha 0.5 drew at 1 once it went live, and the oracle's
  // live read differed from its picture (the browser leg's shape at alpha 0.5, 1090 pixels).
  it("draws its subtree at the top's alpha again once its picture goes", async () => {
    const drawn = await open();
    const stage = drawn.stage.last().stage;

    stage.enableRenderGroup();

    const ghost = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 60, h: 60, alpha: 0.5 }));

    drawn.frame();
    keep(drawn, ghost);

    /** Brings every transform and colour up to date, as Pixi's render does first. */
    const update = (): void => {
      if (stage.renderGroup !== null) pixi.updateRenderGroupTransforms(stage.renderGroup, true);
    };

    update();
    drawn.mock.api.sync.debug.kept(false);
    drawn.frame();
    update();

    const { object, wrapper } = viewOf(drawn, ghost);

    expect(wrapper?.isRenderGroup).toBe(false);
    expect(object.groupAlpha).toBe(0.5);
  });
});
