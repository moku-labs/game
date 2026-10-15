import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { component, Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { HudPart, Parent, Shape, Sprite, Transform } from "../../components";
import { type Drawn, startDrawn } from "../demand-harness";
import { endStage, type OverlayStage, startOverlayStage, UI_OWNER } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test (real Pixi, the tree oracle every frame): B9 of spec 26 — a view drawn at alpha 0 is not renderable
// through `setHidden("alpha")`: a built-in visual with its whole subtree (the wrapper), an adapter's text only its own
// object. The drawn alpha counts the HUD factor of an overlay. A view drawn again is drawn in that frame.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];
const stages: OverlayStage[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.mock.stop();
  }

  for (const stage of stages.splice(0)) endStage(stage);
  vi.unstubAllGlobals();
});

/** A label a plugin above draws its own way: its alpha is its own. */
const Label = component("test.b9Label", { alpha: 1 });

/**
 * Starts the renderer over real Pixi with the `Label` adapter; the test ends it in `afterEach`.
 *
 * @returns The running renderer.
 */
async function started(): Promise<Drawn> {
  const drawn = await startDrawn();

  running.push(drawn);
  drawn.mock.api.sync.displays.provide(Label, {
    create: value => {
      const text = new pixi.Graphics().rect(0, 0, 60, 20).fill(0xff_ff_ff);

      text.alpha = value.alpha;

      return text;
    },
    update: (object, _previous, next) => {
      (object as pixi.Container).alpha = next.alpha;
    },
    destroy: object => (object as pixi.Container).destroy()
  });

  return drawn;
}

/**
 * The view of an entity.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns Its visual and its wrapper.
 */
function nodesOf(
  drawn: Drawn,
  entity: Entity
): { object: pixi.Container; wrapper: pixi.Container | undefined } {
  const view = drawn.mock.ctx.state.sync.views.get(entity);

  if (view === undefined) throw new Error(`no view for ${entity}`);

  return {
    object: view.object as pixi.Container,
    wrapper: view.wrapper as pixi.Container | undefined
  };
}

/**
 * Hangs a child box under a parent and builds it.
 *
 * @param drawn - The running renderer.
 * @param parent - The parent entity.
 * @returns The child.
 */
function childOf(drawn: Drawn, parent: Entity): Entity {
  const child = drawn.mock.world.ecs.spawn(UI_OWNER, [
    Parent({ entity: parent }),
    Transform({ x: 10, y: 10 }),
    Shape({ w: 40, h: 40, fill: 0x33_66_99 })
  ]);

  drawn.frames(2);

  return child;
}

describe("B9: a view at alpha 0 is not drawn", () => {
  it("a sprite at alpha 0 is not drawn, and its subtree with it", async () => {
    const drawn = await started();
    const card = drawn.spawn(Transform({ x: 100, y: 100 }), Sprite({ texture: "card", alpha: 0 }));

    drawn.frame();

    const child = childOf(drawn, card);
    const nodes = nodesOf(drawn, card);

    expect(nodes.wrapper?.renderable).toBe(false);
    expect(nodes.object.renderable).toBe(true);
    expect(nodesOf(drawn, child).object.renderable).toBe(true);
  });

  it("alpha 0 → 0.5 draws the view again in that frame", async () => {
    const drawn = await started();
    const box = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 80, h: 80, alpha: 0 }));

    drawn.frames(2);

    const { object } = nodesOf(drawn, box);

    expect(object.renderable).toBe(false);

    drawn.mock.world.ecs.set(box, Shape, { alpha: 0.5 });

    expect(drawn.frame()).toBe(true);
    expect(object.renderable).toBe(true);
    expect(object.alpha).toBe(0.5);
  });

  it("a text at alpha 0 is not drawn; its children are", async () => {
    const drawn = await started();
    const label = drawn.spawn(Transform({ x: 100, y: 100 }), Label({ alpha: 0 }));

    drawn.frame();

    const child = childOf(drawn, label);
    const nodes = nodesOf(drawn, label);

    expect(nodes.object.renderable).toBe(false);
    expect(nodes.wrapper?.renderable).toBe(true);
    expect(nodesOf(drawn, child).object.renderable).toBe(true);

    drawn.mock.world.ecs.set(label, Label, { alpha: 1 });

    expect(drawn.frame()).toBe(true);
    expect(nodes.object.renderable).toBe(true);
  });

  it("a view that gains a wrapper at alpha 0 hides the wrapper, not the object", async () => {
    const drawn = await started();
    const box = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 80, h: 80, alpha: 0 }));

    drawn.frame();

    expect(nodesOf(drawn, box).object.renderable).toBe(false);

    childOf(drawn, box);

    const nodes = nodesOf(drawn, box);

    expect(nodes.wrapper?.renderable).toBe(false);
    expect(nodes.object.renderable).toBe(true);
  });

  it("a view at alpha 0.005 is still drawn", async () => {
    const drawn = await started();
    const box = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 80, h: 80, alpha: 0.005 }));

    drawn.frame();

    expect(nodesOf(drawn, box).object.renderable).toBe(true);
  });

  it("a HUD part whose factor falls to 0 is not drawn, and is drawn again when it rises", async () => {
    const stage = await startOverlayStage();

    stages.push(stage);
    stage.drawn.mock.api.sync.displays.provide(Label, {
      create: () => new pixi.Graphics().rect(0, 0, 60, 20).fill(0xff_ff_ff),
      update: () => true,
      destroy: object => (object as pixi.Container).destroy()
    });

    const gems = stage.view({ layer: "hud", x: 100, y: 100, extra: [HudPart({ key: "gems" })] });
    const label = stage.drawn.mock.world.ecs.spawn(UI_OWNER, [
      Label({ alpha: 1 }),
      Layer({ name: "hud" }),
      Transform({ x: 400, y: 100 }),
      HudPart({ key: "coins" })
    ]);
    const shop = stage.overlay({ hud: "none" });

    stage.frames(2);
    stage.level(shop, 1);
    stage.frame();

    const textView = stage.drawn.mock.ctx.state.sync.views.get(label);

    expect(stage.topOf(gems).renderable).toBe(false);
    expect(textView?.object.renderable).toBe(false);

    stage.level(shop, 0);

    expect(stage.frame()).toBe(true);
    expect(stage.topOf(gems).renderable).toBe(true);
    expect(textView?.object.renderable).toBe(true);
  });

  it("a pooled object comes back drawable", async () => {
    const drawn = await started();
    const box = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 80, h: 80, alpha: 0 }));

    drawn.frame();

    const { object } = nodesOf(drawn, box);

    drawn.mock.world.ecs.despawn(box);
    drawn.frame();

    expect(object.renderable).toBe(true);

    const again = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 80, h: 80 }));

    drawn.frame();

    expect(nodesOf(drawn, again).object).toBe(object);
    expect(object.renderable).toBe(true);
  });
});
