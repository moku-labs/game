import { describe, expect, it } from "vitest";
import { PointerOver } from "../../../input/components";
import { Parent, Transform } from "../../../renderer/components";
import { Order } from "../../../world/ecs/define";
import { type StackApp, startStackApp } from "../stack-app";

// ---------------------------------------------------------------------------
// Delta 6, B1 and B2: the `rotation` style in the rest pose and in a hover
// variant, and the `zIndex` style as the draw order of a child. Real flow
// runner, plain Bun, inert renderer, real Yoga.
// ---------------------------------------------------------------------------

/**
 * Mounts projections on the running app and gives them their frames.
 *
 * @param app - The running app.
 * @param names - The projections to mount.
 */
function mount(app: StackApp, names: readonly string[]): void {
  app.world.projection.mount(names, { kind: "plugin", name: "test" });
  app.time.step(16);
  app.time.step(16);
  app.time.step(16);
}

/**
 * The entity of a keyed element, failing the test when it is not mounted.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity.
 */
function entityOf(app: StackApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  expect(entity).toBeDefined();

  return entity ?? 0;
}

describe("the rotation style", () => {
  it("tilts the rest pose around the origin, and the drawn pose starts on it", async () => {
    const app = await startStackApp();

    mount(app, ["orderScreen"]);

    const plaque = entityOf(app, "plaque");

    expect(app.world.projection.restOf(plaque, Transform)).toEqual({
      x: 200,
      y: 0,
      rotation: -0.026,
      scale: 1,
      pivot: { x: 200, y: 0 }
    });
    expect(app.world.ecs.get(plaque, Transform)?.rotation).toBe(-0.026);

    await app.stop();
  });

  it("turns further in a hover variant: the rest at once, the drawn pose one step later", async () => {
    const app = await startStackApp();

    mount(app, ["orderScreen"]);

    const plaque = entityOf(app, "plaque");

    app.world.ecs.tag(plaque, PointerOver);
    app.time.step(16);

    expect(app.world.projection.restOf(plaque, Transform)?.rotation).toBe(0.1);

    app.time.step(16);

    expect(app.world.ecs.get(plaque, Transform)?.rotation).toBe(0.1);

    app.world.ecs.untag(plaque, PointerOver);
    app.time.step(16);
    app.time.step(16);

    expect(app.world.ecs.get(plaque, Transform)?.rotation).toBe(-0.026);

    await app.stop();
  });

  it("is ignored by lint, which reports only the zIndex the root sets", async () => {
    const app = await startStackApp();

    mount(app, ["orderScreen"]);

    expect(app.ui.lint()).toEqual([
      { rule: "z-index-on-root", key: "orderRoot", detail: "zIndex 3" }
    ]);

    await app.stop();
  });
});

describe("the zIndex style", () => {
  it("draws an earlier sibling over a later one, and leaves the root at its layer order", async () => {
    const app = await startStackApp();

    mount(app, ["orderScreen"]);

    expect(app.world.ecs.get(entityOf(app, "strip"), Order)).toEqual({ value: 1 });
    expect(app.world.ecs.get(entityOf(app, "tray"), Order)).toBeUndefined();
    expect(app.world.ecs.get(entityOf(app, "plaque"), Order)).toBeUndefined();
    expect(app.world.ecs.get(entityOf(app, "orderRoot"), Order)).toEqual({ value: 0 });

    await app.stop();
  });

  it("updates the order when a variant changes it, and falls back to 0", async () => {
    const app = await startStackApp();

    mount(app, ["orderScreen"]);

    const tray = entityOf(app, "tray");

    app.world.ecs.tag(tray, PointerOver);
    app.time.step(16);

    expect(app.world.ecs.get(tray, Order)).toEqual({ value: 2 });

    app.world.ecs.untag(tray, PointerOver);
    app.time.step(16);

    expect(app.world.ecs.get(tray, Order)).toEqual({ value: 0 });

    await app.stop();
  });

  it("leaves the order of the views a slot with a zIndex hosts untouched", async () => {
    const app = await startStackApp();

    mount(app, ["tokens"]);

    const views = app.world.projection.entitiesOf("tokens");
    const before = views.map(entity => app.world.ecs.get(entity, Order));

    mount(app, ["tokens", "orderScreen"]);

    const slot = entityOf(app, "zSlot");

    expect(app.world.ecs.get(slot, Order)).toEqual({ value: 2 });
    expect(views.map(entity => app.world.ecs.get(entity, Parent)?.entity)).toEqual([slot, slot]);
    expect(views.map(entity => app.world.ecs.get(entity, Order))).toEqual(before);

    await app.stop();
  });
});
