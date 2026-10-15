import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeContainer } from "../../../renderer/__tests__/fake-pixi";
import { Tree } from "../../../world/ecs/define";
import type { DescriptionNode } from "../../../world/projection/types";
import { Box } from "../../components";
import { type DrawnApp, pointOf, press, settle, startDrawnApp } from "../drawn-app";

// ---------------------------------------------------------------------------
// U1.9: a JSX root draws in the layer its projection names. Drawn harness:
// real sync over the fake Pixi, real layer containers, the real hit test.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The entity of a keyed element, failing the test when it is not mounted.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity.
 */
function entityOf(app: DrawnApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  expect(entity).toBeDefined();

  return entity ?? 0;
}

/** The label `sync` gives the container of a layer, before the layer name. */
const LAYER_LABEL = "layer:";

/**
 * The layer whose container holds the display object of an entity, walking up its parents.
 *
 * @param app - The running app.
 * @param entity - The drawn entity.
 * @returns The layer name, or `undefined` when no layer container holds it.
 */
function drawnLayerOf(app: DrawnApp, entity: number): string | undefined {
  let object = app.renderer.sync.displayOf(entity) as FakeContainer | undefined;

  while (object?.parent !== null && object?.parent !== undefined) {
    object = object.parent;

    if (object.label.startsWith(LAYER_LABEL)) return object.label.slice(LAYER_LABEL.length);
  }

  return undefined;
}

describe("the layer of a JSX root", () => {
  it("a JSX root of a projection in layer scene hangs in the scene layer's container, not in ui", async () => {
    const { app } = await startDrawnApp();

    expect(drawnLayerOf(app, entityOf(app, "wardScene"))).toBe("scene");

    await app.stop();
  });

  it("draws and is hit under a ui root that overlaps it", async () => {
    const { app, pixi } = await startDrawnApp();
    const door = entityOf(app, "wardDoor");
    const shopButton = entityOf(app, "hudShop");
    const at = pointOf(app, door);

    expect(at).toBeDefined();
    expect(pointOf(app, shopButton)).toEqual(at);

    const hits = app.renderer.sync.hitAll(at?.x ?? 0, at?.y ?? 0);

    expect(hits.indexOf(shopButton)).toBeLessThan(hits.indexOf(door));
    expect(hits).toContain(door);

    await press(app, pixi, at ?? { x: 0, y: 0 });

    expect(app.flow.state().path).not.toBe("board");
    expect(app.ui.find("shopClose")).toBeDefined();

    await app.stop();
  });

  it("a root of a projection in layer ui stays in ui", async () => {
    const { app } = await startDrawnApp();

    expect(drawnLayerOf(app, entityOf(app, "wardHud"))).toBe("ui");

    await app.stop();
  });

  it("a Tree written by hand without a Layer still draws in ui", async () => {
    const { app } = await startDrawnApp();
    const node = (<column key="handRoot" style={{ width: 100, height: 100 }} />) as DescriptionNode;

    app.world.ecs.spawn({ kind: "plugin", name: "test" }, [Tree({ node })]);
    await settle(app);

    expect(drawnLayerOf(app, entityOf(app, "handRoot"))).toBe("ui");

    await app.stop();
  });
});

describe("empty layout boxes (spec 26 B7)", () => {
  it("a screen of nested stacks and a column of buttons keeps its layout and its presses; the boxes are not drawn", async () => {
    const { app, pixi } = await startDrawnApp();
    const boxes = ["wardScene", "wardStack", "wardDoor", "wardBadge"].map(key =>
      entityOf(app, key)
    );
    const drawnOf = (entity: number): boolean | undefined =>
      (app.renderer.sync.displayOf(entity) as FakeContainer | undefined)?.renderable;

    expect(boxes.map(entity => drawnOf(entity))).toEqual([false, false, false, false]);
    expect(app.world.ecs.get(entityOf(app, "wardStack"), Box)).toEqual({
      x: 0,
      y: 1200,
      w: 1080,
      h: 400
    });
    expect(app.world.ecs.get(entityOf(app, "wardBadge"), Box)).toEqual({
      x: 800,
      y: 1600,
      w: 200,
      h: 200
    });

    const badge = pointOf(app, entityOf(app, "wardBadge"));

    expect(badge).toEqual({ x: 900, y: 1700 });

    await press(app, pixi, badge ?? { x: 0, y: 0 });

    expect(app.ui.find("shopClose")).toBeDefined();

    await app.stop();
  });
});
