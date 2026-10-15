import { afterEach, describe, expect, it, vi } from "vitest";
import { Parent, Shape, Transform } from "../../../renderer/components";
import { Order } from "../../../world/ecs/define";
import { Box, UiCounters } from "../../components";
import type { UiNode } from "../../types";
import { mountScreens, rowChanges, type SlotApp, startSlotApp, tick } from "../slot-app";

// ---------------------------------------------------------------------------
// Spec 16 U3 (C2): a JSX projection named in `hosts` is laid out in the slot's content box, hangs
// under the slot, follows it and is hit inside it. The slot keeps it while it exits; a slot that
// stops naming it gives it back to its layer at the viewport size with no change motion. Readers of
// an element's place (the guide hole, the focus ring, `tree()`) answer in root coordinates.
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
function entityOf(app: SlotApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  expect(entity).toBeDefined();

  return entity ?? 0;
}

/**
 * Taps a local-state button and runs the frame that renders the screen again.
 *
 * @param app - The running app.
 * @param key - The key of the button.
 */
function tapLocal(app: SlotApp, key: string): void {
  app.input.tap(entityOf(app, key));
  app.time.step(16);
}

/**
 * The host screen and the row, mounted in that order.
 *
 * @returns The running app with the row in its slot.
 */
async function mountedSlot(): Promise<SlotApp> {
  const { app } = await startSlotApp();

  mountScreens(app, ["slot.host", "slot.row"]);

  return app;
}

/**
 * The log lines of one event.
 *
 * @param app - The running app.
 * @param event - The event name.
 * @returns Their payloads.
 */
function logged(app: SlotApp, event: string): unknown[] {
  return app.log
    .trace()
    .filter(entry => entry.event === event)
    .map(entry => entry.data);
}

/**
 * Finds a keyed node of the `tree()` snapshot.
 *
 * @param node - Where the search starts.
 * @param key - The key.
 * @returns The node, or `undefined`.
 */
function nodeOf(node: UiNode, key: string): UiNode | undefined {
  if (node.key === key) return node;

  for (const child of node.children) {
    const found = nodeOf(child, key);

    if (found !== undefined) return found;
  }

  return undefined;
}

describe("a JSX projection in a slot (spec 16 U3)", () => {
  // Bug (C2): the row is laid out on the whole screen and only its invisible Tree gets a parent.
  it("is laid out in the slot's content box, in the slot's own units, and hangs under the slot", async () => {
    const app = await mountedSlot();
    const root = entityOf(app, "slotRowRoot");

    expect({
      box: app.world.ecs.get(root, Box),
      parent: app.world.ecs.get(root, Parent),
      order: app.world.ecs.get(root, Order)
    }).toEqual({
      box: { x: 30, y: 20, w: 540, h: 260 },
      parent: { entity: entityOf(app, "rowSlot") },
      order: { value: 0 }
    });

    await app.stop();
  });

  it("moves and scales with the slot without a solve", async () => {
    const app = await mountedSlot();
    const slot = entityOf(app, "rowSlot");
    const button = entityOf(app, "slotButton");
    const before = app.renderer.sync.boundsOf(button);
    const rest = app.world.ecs.get(slot, Transform);
    const solves = app.world.ecs.resource(UiCounters).solves;

    app.world.ecs.set(slot, Transform, { x: (rest?.x ?? 0) + 100, scale: 0.5 });
    app.time.step(16);

    expect(app.renderer.sync.boundsOf(button)?.width).toBe((before?.width ?? 0) / 2);
    expect(app.renderer.sync.boundsOf(button)?.x).not.toBe(before?.x);
    expect(app.world.ecs.resource(UiCounters).solves).toBe(solves);

    await app.stop();
  });

  it("solves the root again in the frame its slot is resized", async () => {
    const app = await mountedSlot();

    tapLocal(app, "widen");

    expect(app.world.ecs.get(entityOf(app, "slotRowRoot"), Box)?.w).toBe(740);

    await app.stop();
  });

  it("is hit inside the slot", async () => {
    const app = await mountedSlot();
    const button = entityOf(app, "slotButton");
    const drawn = app.renderer.sync.boundsOf(button);
    const slot = app.renderer.sync.boundsOf(entityOf(app, "rowSlot"));
    const at = { x: (drawn?.x ?? 0) + 50, y: (drawn?.y ?? 0) + 50 };

    expect(drawn).toMatchObject({ x: 130, y: 420, width: 100, height: 100 });
    expect(at.x > (slot?.x ?? 0) && at.y > (slot?.y ?? 0)).toBe(true);
    expect(app.renderer.sync.hitTest(at.x, at.y, hit => hit === button)).toBe(button);

    await app.stop();
  });

  // Bug: a root that leaves its slot plays a change motion from the slot's units to the screen's.
  it("goes back to its layer at the viewport size with no change motion when the slot stops naming it", async () => {
    const app = await mountedSlot();
    const root = entityOf(app, "slotRowRoot");
    const changes = rowChanges.box;

    tapLocal(app, "unname");

    expect({
      parent: app.world.ecs.get(root, Parent),
      box: app.world.ecs.get(root, Box),
      order: app.world.ecs.get(root, Order)
    }).toEqual({ parent: undefined, box: { x: 0, y: 0, w: 1080, h: 1920 }, order: { value: -1 } });
    expect(rowChanges.box).toBe(changes);

    await app.stop();
  });

  it("stays in a slot that exits until the slot is gone", async () => {
    const app = await mountedSlot();
    const root = entityOf(app, "slotRowRoot");
    const slot = entityOf(app, "rowSlot");

    tapLocal(app, "remove");
    app.time.step(16);

    expect(app.world.ecs.get(slot, Transform)).toBeDefined();
    expect(app.world.ecs.get(root, Parent)).toEqual({ entity: slot });

    for (let frame = 0; frame < 20; frame += 1) app.time.step(16);

    expect(app.world.ecs.get(slot, Transform)).toBeUndefined();
    expect(app.world.ecs.get(root, Parent)).toBeUndefined();

    await app.stop();
  });

  it("goes to the first of two slots that name it, and a dev build names the second", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const app = await mountedSlot();

    tapLocal(app, "twin");
    app.time.step(16);

    expect(app.world.ecs.get(entityOf(app, "slotRowRoot"), Parent)).toEqual({
      entity: entityOf(app, "rowSlot")
    });
    expect(logged(app, "ui:slot-taken")).toEqual([{ projection: "slot.row", host: "twinSlot" }]);

    await app.stop();
  });

  // Bug: two roots slotted in each other wait for each other forever and are never drawn.
  it("solves two roots slotted in each other at the viewport and logs the cycle", async () => {
    const { app } = await startSlotApp();

    mountScreens(app, ["cycle.a", "cycle.b"]);
    app.time.step(16);

    const roots = [entityOf(app, "cycleARoot"), entityOf(app, "cycleBRoot")];

    expect(roots.map(root => app.world.ecs.get(root, Parent))).toEqual([undefined, undefined]);
    expect(roots.map(root => app.world.ecs.get(root, Box))).toEqual([
      { x: 0, y: 0, w: 300, h: 300 },
      { x: 0, y: 0, w: 300, h: 300 }
    ]);
    expect(logged(app, "ui:slot-cycle")).toEqual([
      { projection: "cycle.a" },
      { projection: "cycle.b" }
    ]);

    await app.stop();
  });

  it("cuts the hole of a guide where an element of the slotted root is drawn", async () => {
    const app = await mountedSlot();

    expect(app.flow.gate.answer({ intent: "teach" })).toBe(true);
    await tick();
    app.time.step(16);

    const dims = [...app.world.ecs.query(Shape, Transform)]
      .filter(([, shape]) => shape.alpha === 0.6)
      .map(([, shape, transform]) => ({ x: transform.x, y: transform.y, w: shape.w, h: shape.h }));
    const left = dims.find(dim => dim.x === 0 && dim.y > 0 && dim.w < 1080);

    expect(left).toEqual({ x: 0, y: 420, w: 130, h: 100 });

    await app.stop();
  });

  it("reports the rect of a slotted element in root coordinates in `tree()`", async () => {
    const app = await mountedSlot();

    expect(nodeOf(app.ui.tree(), "slotButton")?.rect).toEqual({ x: 130, y: 420, w: 100, h: 100 });

    await app.stop();
  });

  it("draws the focus ring around a slotted button where the button is drawn", async () => {
    const app = await mountedSlot();

    expect(app.input.pressKey("Tab", {})).toBe(true);

    app.time.step(16);

    const drawn = app.renderer.sync.boundsOf(entityOf(app, "slotButton"));
    const ring = [...app.world.ecs.query(Shape, Transform)].find(([, shape]) => shape.dash > 0);
    const centre =
      ring === undefined
        ? undefined
        : {
            x: ring[2].x + ring[1].w / 2,
            y: ring[2].y + ring[1].h / 2
          };

    expect(centre).toEqual({
      x: (drawn?.x ?? 0) + (drawn?.width ?? 0) / 2,
      y: (drawn?.y ?? 0) + (drawn?.height ?? 0) / 2
    });

    await app.stop();
  });
});
