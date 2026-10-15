import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { component, Layer, Order } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Display, NineSlice, Parent, Shape, Sprite, Transform } from "../../components";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// Compare on write (spec 14 D2): every write site of `sync` compares the value
// with what Pixi holds and marks before the first write that differs; equal
// writes write and mark nothing; structural writes always mark. Real Pixi
// through `stagePixi`, the tree oracle on every frame, `onDemand` on: a frame
// is drawn exactly when a mark counted.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

/**
 * Starts the renderer drawn on demand and keeps it for the teardown.
 *
 * @returns The running renderer.
 */
async function open(): Promise<Drawn> {
  const drawn = await startDrawn();

  running.push(drawn);

  return drawn;
}

/**
 * Builds the view of an entity spawned in the `items` layer and lets the frame after it rest.
 *
 * @param drawn - The running renderer.
 * @param components - The components of the entity.
 * @returns The entity.
 */
function settled(drawn: Drawn, ...components: Parameters<Drawn["spawn"]>): Entity {
  const entity = drawn.spawn(...components);

  drawn.frames(2);

  return entity;
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

describe("sync compares before it writes (D2.1–D2.7)", () => {
  it("an equal Transform rewritten by a new object marks nothing and writes nothing", async () => {
    const drawn = await open();
    const entity = settled(
      drawn,
      Transform({ x: 100, y: 200, rotation: 0.5 }),
      Shape({ w: 40, h: 40 })
    );
    const object = drawn.objectOf(entity) as pixi.Container;
    const writes = vi.spyOn(object.position, "set");

    // The glide-landed bug: a camera writes a new object with the same numbers every frame.
    for (let index = 0; index < 5; index += 1) {
      drawn.mock.world.ecs.set(entity, Transform, { x: 100, y: 200, rotation: 0.5 });
    }

    expect(drawn.frames(5)).toBe(0);
    expect(writes).not.toHaveBeenCalled();

    drawn.mock.world.ecs.set(entity, Transform, { x: 101 });

    expect(drawn.frame()).toBe(true);
    expect(object.position.x).toBe(101);
  });

  it("a sprite tint change marks once and is drawn in its frame", async () => {
    const drawn = await open();
    const entity = settled(drawn, Transform({ x: 100, y: 100 }), Sprite({ texture: "a" }));

    drawn.mock.world.ecs.set(entity, Sprite, { tint: 0x33_44_55 });

    expect(drawn.frame()).toBe(true);
    expect(drawn.mock.modules.demand.frame()).toEqual({ drawn: true, reason: "mark", marks: 1 });
    expect((drawn.objectOf(entity) as pixi.Sprite).tint).toBe(0x33_44_55);

    drawn.mock.world.ecs.set(entity, Sprite, { tint: 0x33_44_55 });

    expect(drawn.frames(3)).toBe(0);
  });

  it("a new texture identity marks", async () => {
    const drawn = await open();
    const other = new pixi.Texture({ source: new pixi.TextureSource({ width: 64, height: 64 }) });
    const entity = settled(drawn, Transform({ x: 100, y: 100 }), Sprite({ texture: "a" }));

    drawn.mock.api.sync.textures.provide(key => (key === "b" ? other : undefined));
    drawn.mock.world.ecs.set(entity, Sprite, { texture: "b" });

    expect(drawn.frame()).toBe(true);
    expect((drawn.objectOf(entity) as pixi.Sprite).texture).toBe(other);
  });

  it("an equal nine-slice rewrite marks nothing; a new width marks", async () => {
    const drawn = await open();
    const entity = settled(
      drawn,
      Transform({ x: 100, y: 100 }),
      NineSlice({ texture: "a", width: 200, height: 80 })
    );

    drawn.mock.world.ecs.set(entity, NineSlice, { width: 200, height: 80 });

    expect(drawn.frames(3)).toBe(0);

    drawn.mock.world.ecs.set(entity, NineSlice, { width: 240 });

    expect(drawn.frame()).toBe(true);
    expect((drawn.objectOf(entity) as pixi.NineSliceSprite).width).toBe(240);
  });

  it("an alpha-only change of a Shape does not redraw its path", async () => {
    const drawn = await open();
    const entity = settled(drawn, Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));
    const graphics = drawn.objectOf(entity) as pixi.Graphics;
    const redraw = vi.spyOn(graphics, "clear");

    drawn.mock.world.ecs.set(entity, Shape, { alpha: 0.5 });

    expect(drawn.frame()).toBe(true);
    expect(graphics.alpha).toBe(0.5);
    expect(redraw).not.toHaveBeenCalled();
  });

  it("an equal Shape rewrite redraws nothing; a new fill is a tint (spec 26 R2.1); a new size redraws once", async () => {
    const drawn = await open();
    const entity = settled(
      drawn,
      Transform({ x: 100, y: 100 }),
      Shape({ w: 40, h: 40, fill: 0x11 })
    );
    const redraw = vi.spyOn(drawn.objectOf(entity) as pixi.Graphics, "clear");

    drawn.mock.world.ecs.set(entity, Shape, { w: 40, h: 40, fill: 0x11 });

    expect(drawn.frames(3)).toBe(0);
    expect(redraw).not.toHaveBeenCalled();

    drawn.mock.world.ecs.set(entity, Shape, { fill: 0x22 });

    expect(drawn.frame()).toBe(true);
    expect(redraw).not.toHaveBeenCalled();
    expect((drawn.objectOf(entity) as pixi.Graphics).tint).toBe(0x22);

    drawn.mock.world.ecs.set(entity, Shape, { w: 50 });

    expect(drawn.frame()).toBe(true);
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  it("a clip turned on marks structurally, an equal clip rewrite redraws no mask", async () => {
    const drawn = await open();
    const entity = settled(drawn, Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.mock.world.ecs.set(entity, Shape, { clip: true });

    expect(drawn.frame()).toBe(true);

    const mask = drawn.mock.ctx.state.sync.views.get(entity)?.mask as pixi.Graphics;
    const redraw = vi.spyOn(mask, "clear");

    drawn.mock.world.ecs.set(entity, Shape, { clip: true, w: 40, h: 40 });

    expect(drawn.frames(3)).toBe(0);
    expect(redraw).not.toHaveBeenCalled();

    drawn.mock.world.ecs.set(entity, Shape, { clip: false });

    expect(drawn.frame()).toBe(true);
    expect(drawn.mock.ctx.state.sync.views.get(entity)?.mask).toBeUndefined();
  });

  it("an equal zIndex marks nothing; a new Order marks", async () => {
    const drawn = await open();
    const entity = settled(
      drawn,
      Transform({ x: 100, y: 100 }),
      Shape({ w: 40, h: 40 }),
      Order({ value: 2 })
    );

    drawn.mock.world.ecs.set(entity, Order, { value: 2 });

    expect(drawn.frames(3)).toBe(0);

    drawn.mock.world.ecs.set(entity, Order, { value: 3 });

    expect(drawn.frame()).toBe(true);
  });
});

describe("sync marks every structural write (D2.8–D2.18)", () => {
  it("a new view is drawn in its frame, and a despawned one is drawn away", async () => {
    const drawn = await open();
    const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    expect(drawn.frame()).toBe(true);
    expect(drawn.frames(3)).toBe(0);

    drawn.mock.world.ecs.despawn(entity);

    expect(drawn.frame()).toBe(true);
    expect(drawn.objectOf(entity)).toBeUndefined();
  });

  it("a view that moves to another layer is drawn there", async () => {
    const drawn = await open();
    const entity = settled(drawn, Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.mock.world.projection.setLayers([
      { name: "items", sort: "order" },
      { name: "hud", sort: "none" }
    ]);

    expect(drawn.frame()).toBe(true);
    expect(drawn.mock.modules.demand.frame().reason).toBe("layers");

    drawn.mock.world.ecs.set(entity, Layer, { name: "hud" });

    expect(drawn.frame()).toBe(true);
    expect(drawn.objectOf(entity)?.parent?.label).toBe("layer:hud");
  });

  it("a parent that gets a child is wrapped and drawn; its child left behind is drawn away", async () => {
    const drawn = await open();
    const parent = settled(drawn, Transform({ x: 100, y: 100 }), Shape({ w: 80, h: 80 }));
    const child = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: 10, y: 10 }),
      Shape({ w: 20, h: 20 }),
      Parent({ entity: parent })
    ]);

    expect(drawn.frame()).toBe(true);
    expect(drawn.mock.ctx.state.sync.views.get(parent)?.wrapper).toBeDefined();
    expect(drawn.frames(3)).toBe(0);

    drawn.mock.world.ecs.despawn(parent);

    expect(drawn.frame()).toBe(true);
    expect(drawn.objectOf(child)?.parent).toBeNull();
  });

  it("a new filter list is drawn; the same list again is not", async () => {
    const drawn = await open();
    const entity = settled(drawn, Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));
    const filter = new pixi.Filter({ resources: {} } as unknown as pixi.FilterOptions);

    drawn.mock.api.sync.filters.set(entity, [{ filter, passes: 1 }]);

    expect(drawn.frame()).toBe(true);

    drawn.mock.api.sync.filters.set(entity, [{ filter, passes: 1 }]);

    expect(drawn.frames(3)).toBe(0);
  });

  it("a new Display object replaces the old view in its frame", async () => {
    const drawn = await open();
    const first = new pixi.Graphics().rect(0, 0, 30, 30).fill(0x11);
    const second = new pixi.Graphics().rect(0, 0, 30, 30).fill(0x22);
    const entity = settled(drawn, Transform({ x: 100, y: 100 }), Display({ object: first }));

    drawn.mock.world.ecs.set(entity, Display, { object: second });

    expect(drawn.frame()).toBe(true);
    expect(drawn.objectOf(entity)).toBe(second);
  });

  it("a key resolved again is drawn, though its texture is the same", async () => {
    const drawn = await open();

    settled(drawn, Transform({ x: 100, y: 100 }), Sprite({ texture: "a" }));
    drawn.mock.api.sync.textures.invalidate(["a"]);

    expect(drawn.frame()).toBe(true);
    expect(drawn.frames(3)).toBe(0);
  });

  it("the outline switch draws the frame once", async () => {
    const drawn = await open();

    settled(
      drawn,
      Transform({ x: 100, y: 100 }),
      NineSlice({ texture: "a", width: 200, height: 80 })
    );
    drawn.mock.api.sync.debug.nineSlice(true);

    expect(drawn.frame()).toBe(true);
    expect(drawn.mock.modules.demand.frame().reason).toBe("debug");
    expect(drawn.frames(3)).toBe(0);
  });

  it("a restore rebuilds the tree and draws it", async () => {
    const drawn = await open();

    settled(drawn, Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    for (const restore of drawn.mock.ctx.state.host.onRestore) restore();

    expect(drawn.frame()).toBe(true);
    expect(drawn.mock.modules.demand.frame().reason).toBe("restore");
  });

  it("an adapter that answers false asks for no frame; any other answer marks", async () => {
    const drawn = await open();
    const Label = component("TestLabel", { text: "" });
    const answers: Array<boolean | undefined> = [];

    drawn.mock.api.sync.displays.provide(Label, {
      create: () => new pixi.Graphics().rect(0, 0, 30, 30).fill(0x11),
      update: (_object, previous, next) => {
        const answer = previous.text === next.text ? false : undefined;

        answers.push(answer);

        return answer;
      },
      destroy: object => (object as pixi.Container).destroy()
    });

    const entity = settled(drawn, Transform({ x: 100, y: 100 }), Label({ text: "a" }));

    drawn.mock.world.ecs.set(entity, Label, { text: "a" });

    expect(drawn.frame()).toBe(false);

    drawn.mock.world.ecs.set(entity, Label, { text: "b" });

    expect(drawn.frame()).toBe(true);
    expect(answers).toEqual([false, undefined]);
  });
});
