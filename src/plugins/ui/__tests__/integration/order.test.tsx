import { afterEach, describe, expect, it, vi } from "vitest";
import { PointerOver } from "../../../input/components";
import { Parent, Shape, Transform } from "../../../renderer/components";
import { Order } from "../../../world/ecs/define";
import { type DrawnApp, drag, pointOf, settle, startDrawnApp } from "../drawn-app";
import { type StackApp, startStackApp } from "../stack-app";

// ---------------------------------------------------------------------------
// Delta 6, B1 and B2: the `rotation` style in the rest pose and in a hover
// variant, and the `zIndex` style as the draw order of a child. Real flow
// runner, plain Bun, inert renderer, real Yoga. Spec 16 U1 (C1): the order of
// a ui tree is what is drawn and hit, on the drawn harness.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

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
function entityOf(app: StackApp | DrawnApp, key: string): number {
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
  // The composite order of spec 16 U1: the zIndex, less a half, plus the place among the siblings.
  it("draws an earlier sibling over a later one, and leaves the root at its layer order", async () => {
    const app = await startStackApp();

    mount(app, ["orderScreen"]);

    expect(app.world.ecs.get(entityOf(app, "strip"), Order)).toEqual({ value: 0.500_244_140_625 });
    expect(app.world.ecs.get(entityOf(app, "tray"), Order)).toEqual({
      value: -0.499_633_789_062_5
    });
    expect(app.world.ecs.get(entityOf(app, "plaque"), Order)).toEqual({
      value: -0.499_877_929_687_5
    });
    expect(app.world.ecs.get(entityOf(app, "orderRoot"), Order)).toEqual({ value: -1 });

    await app.stop();
  });

  it("updates the order when a variant changes it, and falls back to its markup place", async () => {
    const app = await startStackApp();

    mount(app, ["orderScreen"]);

    const tray = entityOf(app, "tray");

    app.world.ecs.tag(tray, PointerOver);
    app.time.step(16);

    expect(app.world.ecs.get(tray, Order)).toEqual({ value: 1.500_366_210_937_5 });

    app.world.ecs.untag(tray, PointerOver);
    app.time.step(16);

    expect(app.world.ecs.get(tray, Order)).toEqual({ value: -0.499_633_789_062_5 });

    await app.stop();
  });

  it("leaves the order of the views a slot with a zIndex hosts untouched", async () => {
    const app = await startStackApp();

    mount(app, ["tokens"]);

    const views = app.world.projection.entitiesOf("tokens");
    const before = views.map(entity => app.world.ecs.get(entity, Order));

    mount(app, ["tokens", "orderScreen"]);

    const slot = entityOf(app, "zSlot");

    expect(app.world.ecs.get(slot, Order)).toEqual({ value: 1.500_488_281_25 });
    expect(views.map(entity => app.world.ecs.get(entity, Parent)?.entity)).toEqual([slot, slot]);
    expect(views.map(entity => app.world.ecs.get(entity, Order))).toEqual(before);

    await app.stop();
  });
});

/** The ring colour and the halo colour of the default `focusRing`. */
const RING_INK = 0x3a_22_12;
const RING_CREAM = 0xff_f3_d6;

describe("the focus ring of a root (spec 16 U1)", () => {
  // Bug: the ring of a root at 0 sorts at 0.75, over every view drawn in the layer at Order 0.
  it("draws above its root and under everything at Order 0", async () => {
    const app = await startStackApp();

    mount(app, ["orderScreen", "focusScreen"]);

    expect(app.input.pressKey("Tab", {})).toBe(true);

    app.time.step(16);

    const orderOf = (entity: number | undefined): number | undefined =>
      app.world.ecs.get(entity ?? 0, Order)?.value;
    const root = orderOf(entityOf(app, "focusRoot"));
    // The halo and the ring are the two shapes drawn in the colours of the default focus ring.
    const parts = [...app.world.ecs.query(Shape)]
      .filter(([, shape]) => shape.stroke === RING_INK || shape.stroke === RING_CREAM)
      .map(([entity]) => orderOf(entity));

    expect({ root, below: orderOf(entityOf(app, "orderRoot")) }).toEqual({ root: -1, below: -2 });
    expect(parts).toHaveLength(2);
    expect(parts.every(order => order !== undefined && order > -1 && order < 0)).toBe(true);

    await app.stop();
  });
});

/**
 * Taps a local-state button of the drawn app and lets the screen render again.
 *
 * @param app - The running app.
 * @param key - The key of the button.
 */
async function tapLocal(app: DrawnApp, key: string): Promise<void> {
  app.input.tap(entityOf(app, key));
  await settle(app, 2);
}

describe("the order of a drawn ui tree (spec 16 U1, C1)", () => {
  // Bug (C1): a child mounted again by a condition is inserted last and draws over its later sibling.
  it("draws and hits a child mounted again by a condition under the sibling written after it", async () => {
    const { app } = await startDrawnApp();

    app.world.projection.mount(["order.overlap"], { kind: "plugin", name: "test" });
    await settle(app, 3);
    await tapLocal(app, "hideFirst");

    expect(app.ui.find("first")).toBeUndefined();

    await tapLocal(app, "showFirst");

    const first = entityOf(app, "first");
    const second = entityOf(app, "second");

    expect(
      app.renderer.sync.hitAll(300, 300).filter(hit => hit === first || hit === second)
    ).toEqual([second, first]);
    expect(app.renderer.sync.hitTest(300, 300, hit => hit === first || hit === second)).toBe(
      second
    );

    await app.stop();
  });

  // Bug (C1, R2): the ui layer draws its roots in mount order, so a root remounted by a commit covers the next one.
  it("draws the roots of a scene in the order of its projections after one is remounted by a commit", async () => {
    const { app, pixi } = await startDrawnApp();

    app.flow.gate.answer({ intent: "board" });
    await settle(app, 4);

    const badge = app.world.projection.entityOf("board.badge", "badge");
    const item = app.world.projection.entityOf("board.items", "i1") ?? 0;
    const cell = app.world.projection.entityOf("board.cells", "c2") ?? 0;

    await drag(
      app,
      pixi,
      pointOf(app, item) ?? { x: 0, y: 0 },
      pointOf(app, cell) ?? { x: 0, y: 0 }
    );
    await settle(app, 4);

    const remounted = app.world.projection.entityOf("board.badge", "badge") ?? 0;
    const row = entityOf(app, "ordersRow");
    const hits = app.renderer.sync.hitAll(200, 1750);

    expect(remounted).not.toBe(badge);
    expect(hits.indexOf(row)).toBeLessThan(hits.indexOf(remounted));
    expect(hits).toContain(remounted);

    await app.stop();
  });

  it("draws a popup over every scene root", async () => {
    const { app } = await startDrawnApp();

    app.flow.gate.answer({ intent: "board" });
    await settle(app, 4);
    app.flow.gate.answer({ intent: "shop" });
    await settle(app, 4);

    const panel = entityOf(app, "shopPanel");
    const at = pointOf(app, panel) ?? { x: 0, y: 0 };
    const hits = app.renderer.sync.hitAll(at.x, at.y);
    const back = entityOf(app, "boardBack");

    expect(hits).toContain(back);
    expect(hits.indexOf(panel)).toBeLessThan(hits.indexOf(back));

    await app.stop();
  });
});
