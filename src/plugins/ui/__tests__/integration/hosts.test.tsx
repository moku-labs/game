import { describe, expect, it } from "vitest";
import { Held, Tappable, Touchable } from "../../../input/components";
import { Parent } from "../../../renderer/components";
import { Layer } from "../../../world/ecs/define";
import { type StackApp, settle, startStackApp } from "../stack-app";

// ---------------------------------------------------------------------------
// Two live behaviours of delta 4: a ui slot that hosts the views of a world
// projection, and a button whose input components follow its disabled state.
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
 * The parent entity of each token view.
 *
 * @param app - The running app.
 * @returns One entry per live token, in key order.
 */
function parentsOfTokens(app: StackApp): (number | undefined)[] {
  return app.world.projection
    .entitiesOf("tokens")
    .map(entity => app.world.ecs.get(entity, Parent)?.entity);
}

describe("hosts", () => {
  it("parents every live view of a hosted projection to the slot", async () => {
    const app = await startStackApp();

    mount(app, ["tokens", "slotScreen"]);

    const slot = app.ui.find("slot");

    expect(slot).toBeDefined();
    expect(app.world.projection.entitiesOf("tokens")).toHaveLength(2);
    expect(parentsOfTokens(app)).toEqual([slot, slot]);
    // The view keeps its layer: it falls back to it when the slot leaves.
    expect(app.world.ecs.get(app.world.projection.entitiesOf("tokens")[0] ?? 0, Layer)).toEqual({
      name: "board"
    });

    await app.stop();
  });

  it("skips a held view and parents it again once the held tag goes", async () => {
    const app = await startStackApp();

    mount(app, ["tokens", "slotScreen"]);

    const slot = app.ui.find("slot");
    const [first] = app.world.projection.entitiesOf("tokens");
    const held = first ?? 0;

    // `input` takes the parent away for the drag and tags the view held.
    app.world.ecs.tag(held, Held);
    app.world.ecs.remove(held, Parent);
    app.time.step(16);
    app.time.step(16);

    expect(app.world.ecs.get(held, Parent)).toBeUndefined();

    app.world.ecs.untag(held, Held);
    app.time.step(16);
    app.time.step(16);

    expect(app.world.ecs.get(held, Parent)).toEqual({ entity: slot });

    await app.stop();
  });

  it("drops the parent of every hosted view when the slot leaves", async () => {
    const app = await startStackApp();

    mount(app, ["tokens", "slotScreen"]);

    expect(parentsOfTokens(app).every(parent => parent !== undefined)).toBe(true);

    app.world.projection.unmount(["slotScreen"]);
    app.time.step(16);
    app.time.step(16);

    expect(app.ui.find("slot")).toBeUndefined();
    expect(parentsOfTokens(app)).toEqual([undefined, undefined]);

    await app.stop();
  });

  it("gives the views to the first of two slots that name them, once", async () => {
    const app = await startStackApp();

    mount(app, ["tokens", "twinSlotScreen"]);

    const slotA = app.ui.find("slotA");

    expect(slotA).toBeDefined();
    expect(parentsOfTokens(app)).toEqual([slotA, slotA]);

    await app.stop();
  });

  it("hangs a hosted view back under its slot when something else takes the parent", async () => {
    const app = await startStackApp();

    mount(app, ["tokens", "twinSlotScreen"]);

    const slotA = app.ui.find("slotA");
    const [first] = app.world.projection.entitiesOf("tokens");
    const view = first ?? 0;

    app.world.ecs.remove(view, Parent);
    app.time.step(16);
    app.time.step(16);

    expect(app.world.ecs.get(view, Parent)).toEqual({ entity: slotA });

    await app.stop();
  });

  it("leaves a projection alone that no slot names", async () => {
    const app = await startStackApp();

    mount(app, ["tokens"]);

    expect(parentsOfTokens(app)).toEqual([undefined, undefined]);

    await app.stop();
  });
});

describe("a button that becomes disabled", () => {
  it("stops answering the gate, and answers again when it is enabled", async () => {
    const app = await startStackApp();

    mount(app, ["toggleScreen"]);

    const go = app.ui.find("go") ?? 0;
    const lock = app.ui.find("lock") ?? 0;

    expect(app.input.tap(go)).toBe(true);
    await settle(app);

    app.input.tap(lock);
    app.time.step(16);

    expect(app.ui.find("go")).toBe(go);
    expect(app.world.ecs.has(go, Tappable)).toBe(false);
    expect(app.world.ecs.has(go, Touchable)).toBe(true);
    expect(app.input.tap(go)).toBe(false);

    app.input.tap(lock);
    app.time.step(16);

    expect(app.world.ecs.has(go, Tappable)).toBe(true);
    expect(app.world.ecs.has(go, Touchable)).toBe(false);
    expect(app.input.tap(go)).toBe(true);

    await app.stop();
  });
});
