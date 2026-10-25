import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { NineSlice, Parent, Sprite, type SpriteBlend, Transform } from "../../components";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";
import { type FakeSprite, FakeTexture } from "../fake-pixi";
import { createMockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test of `blend` on `Sprite` and `NineSlice` (F68): `"add"` and `"screen"` go on the view's own Pixi object,
// `"normal"` and a value without the field go back to `"inherit"`, each written only when it differs and marked
// before; any other value is never handed to Pixi and warned once; a pooled object waits with no blend. The whole
// renderer runs over the real Pixi of `stagePixi`, drawn on demand, the tree oracle checking every frame.
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
 * Builds the view of an entity spawned in the `items` layer and lets the frames after it rest.
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

/**
 * The blend mode Pixi holds on the object of an entity's view.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns The blend mode, or `"no view"`.
 */
function blendOf(drawn: Drawn, entity: Entity): string {
  return drawn.objectOf(entity)?.blendMode ?? "no view";
}

/**
 * The details of every warning with one message.
 *
 * @param drawn - The running renderer.
 * @param message - The message.
 * @returns The details, in order.
 */
function warnings(drawn: Drawn, message: string): unknown[] {
  return vi
    .mocked(drawn.mock.log.warn)
    .mock.calls.filter(([logged]) => logged === message)
    .map(([, detail]) => detail);
}

describe("sync blend: a Sprite", () => {
  // Bug: the field never reaches Pixi, or a glow that was on can never be turned off again.
  it("draws add and screen with Pixi's blend of that name, normal and a value without the field as inherit", async () => {
    const drawn = await open();
    const glow = settled(
      drawn,
      Transform({ x: 100, y: 100 }),
      Sprite({ texture: "fx.glow", blend: "add" })
    );

    expect(blendOf(drawn, glow)).toBe("add");

    drawn.mock.world.ecs.set(glow, Sprite, { blend: "screen" });

    expect(drawn.frame()).toBe(true);
    expect(blendOf(drawn, glow)).toBe("screen");

    drawn.mock.world.ecs.set(glow, Sprite, { blend: "normal" });

    expect(drawn.frame()).toBe(true);
    expect(blendOf(drawn, glow)).toBe("inherit");

    drawn.mock.world.ecs.set(glow, Sprite, { blend: "add" });
    drawn.frame();
    // A new value without the field, as a variant that drops it writes.
    drawn.mock.world.ecs.add(glow, Sprite({ texture: "fx.glow" }));

    expect(drawn.frame()).toBe(true);
    expect(blendOf(drawn, glow)).toBe("inherit");
  });

  // Bug: a blend that stood is written and marked at every sync, so a glow at rest keeps the screen drawing.
  it("an unchanged blend writes nothing and marks nothing", async () => {
    const drawn = await open();
    const glow = settled(
      drawn,
      Transform({ x: 100, y: 100 }),
      Sprite({ texture: "fx.glow", blend: "screen" })
    );

    for (let index = 0; index < 3; index += 1) {
      drawn.mock.world.ecs.set(glow, Sprite, { blend: "screen" });
    }

    expect(drawn.frames(3)).toBe(0);
    expect(blendOf(drawn, glow)).toBe("screen");
  });

  // Bug: the blend goes on the wrapper like the alpha, so the glow's children add their pixels too.
  it("blends the visual alone: the wrapper of a glow with a child and the child draw normally", async () => {
    const drawn = await open();
    const glow = settled(
      drawn,
      Transform({ x: 100, y: 100 }),
      Sprite({ texture: "fx.glow", blend: "add" })
    );
    const child = drawn.mock.world.ecs.spawn(OWNER, [
      Parent({ entity: glow }),
      Transform({ x: 10, y: 10 }),
      Sprite({ texture: "board.cell" })
    ]);

    expect(drawn.frame()).toBe(true);

    const view = drawn.mock.ctx.state.sync.views.get(glow);

    expect(view?.wrapper?.blendMode).toBe("inherit");
    expect(view?.object.blendMode).toBe("add");
    expect(blendOf(drawn, child)).toBe("inherit");
  });

  // Bug: the placeholder path returns before the blend, so a glow turned off while its new key is missing keeps adding.
  it("writes the blend of a sprite drawn as the placeholder of a key nothing answers", async () => {
    const mock = createMockRenderer();
    const texture = new FakeTexture({ source: { width: 64, height: 64, destroyed: false } });

    await mock.start();
    mock.api.sync.textures.provide(key => (key === "fx.glow" ? (texture as never) : undefined));
    mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

    const glow = mock.world.ecs.spawn(OWNER, [
      Layer({ name: "items" }),
      Transform({ x: 100, y: 100 }),
      Sprite({ texture: "fx.glow", blend: "add" })
    ]);

    mock.modules.sync.pass();
    mock.world.ecs.set(glow, Sprite, { texture: "fx.late", blend: "normal" });
    mock.modules.sync.pass();

    const object = mock.api.sync.displayOf(glow) as FakeSprite;

    expect(mock.ctx.state.sync.views.get(glow)?.placeholder).toBe(true);
    expect(object.blendMode).toBe("inherit");

    mock.world.ecs.set(glow, Sprite, { blend: "screen" });
    mock.modules.sync.pass();

    expect(object.blendMode).toBe("screen");
    mock.stop();
  });
});

describe("sync blend: a NineSlice", () => {
  // Bug: only a Sprite reads the field; or the object a hollow flip swaps in keeps the pool's normal blend.
  it("carries the blend on a filled and a hollow panel, across a hollow flip both ways", async () => {
    const drawn = await open();
    const panel = settled(
      drawn,
      Transform({ x: 100, y: 100 }),
      NineSlice({ texture: "glass.frost", width: 300, height: 200, blend: "screen" })
    );
    const filled = drawn.objectOf(panel);

    expect(filled?.blendMode).toBe("screen");

    drawn.mock.world.ecs.set(panel, NineSlice, { hollow: true });

    expect(drawn.frame()).toBe(true);

    const hollow = drawn.objectOf(panel);

    expect(hollow).not.toBe(filled);
    expect(hollow?.blendMode).toBe("screen");
    // The filled object waits in its pool with no blend.
    expect(filled?.blendMode).toBe("inherit");

    drawn.mock.world.ecs.set(panel, NineSlice, { hollow: false, blend: "add" });

    expect(drawn.frame()).toBe(true);
    expect(drawn.objectOf(panel)).toBe(filled);
    expect(blendOf(drawn, panel)).toBe("add");
    expect(hollow?.blendMode).toBe("inherit");
  });
});

describe("sync blend: a value Pixi is never handed", () => {
  // Bug: an advanced mode or a typo reaches Pixi, which draws it through a filter pass of its own, or the log repeats
  // the warning at every sync.
  it("draws multiply and a typo normally, warned once per value", async () => {
    const drawn = await open();
    const multiply = "multiply" as SpriteBlend;
    const first = settled(
      drawn,
      Transform({ x: 100, y: 100 }),
      Sprite({ texture: "fx.glow", blend: multiply })
    );
    const second = settled(
      drawn,
      Transform({ x: 300, y: 100 }),
      NineSlice({ texture: "glass.frost", width: 100, height: 100, blend: multiply })
    );

    drawn.mock.world.ecs.set(first, Sprite, { alpha: 0.5 });
    drawn.frames(2);

    const typo = settled(
      drawn,
      Transform({ x: 500, y: 100 }),
      Sprite({ texture: "fx.glow", blend: "screeen" as SpriteBlend })
    );

    expect([blendOf(drawn, first), blendOf(drawn, second), blendOf(drawn, typo)]).toEqual([
      "inherit",
      "inherit",
      "inherit"
    ]);
    expect(warnings(drawn, "renderer:blend-unknown")).toEqual([
      { blend: "multiply" },
      { blend: "screeen" }
    ]);
  });
});

describe("sync blend: the pool", () => {
  // Bug: a pooled object keeps its glow, and the next view that takes it out of the pool adds its pixels.
  it("an object released with add waits in its pool blending inherit", async () => {
    const drawn = await open();
    const glow = settled(
      drawn,
      Transform({ x: 100, y: 100 }),
      Sprite({ texture: "fx.glow", blend: "add" })
    );
    const object = drawn.objectOf(glow);

    drawn.mock.world.ecs.despawn(glow);
    drawn.frame();

    expect(drawn.mock.ctx.state.sync.pools.get("Sprite:fx.glow")).toContain(object);
    expect(object?.blendMode).toBe("inherit");
  });
});
