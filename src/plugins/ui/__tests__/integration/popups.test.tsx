import { describe, expect, it } from "vitest";
import { Tappable } from "../../../input/components";
import { Text as TextComponent } from "../../../text/components";
import { Tree } from "../../../world/ecs/define";
import { Covered } from "../../components";
import type { UiNode } from "../../jsx/types";
import { answer, settleExits, startHeldApp } from "../held-app";
import { hold, played, type StackApp, settle, startStackApp, tick } from "../stack-app";

// ---------------------------------------------------------------------------
// Popups that outlive their answer (delta 4): the root waits until the flow rests
// on a node that shows no popup of its component, a popup of the same component
// takes the root back, and `over` keeps a popup mounted and covered beneath.
// The real flow runner drives every case.
// ---------------------------------------------------------------------------

/**
 * The root entities of one popup component, read from the `Tree` components.
 *
 * @param app - The running app: the stack app or the hold app.
 * @param component - The component name.
 * @returns The entities, in spawn order.
 */
function rootsOf(app: Pick<StackApp, "world">, component: string): number[] {
  const roots: number[] = [];

  for (const [entity, tree] of app.world.ecs.query(Tree)) {
    if (tree.node.type === component) roots.push(entity);
  }

  return roots;
}

/**
 * The mounted roots of the snapshot: one node when one root is mounted, else the children.
 *
 * @param app - The running app.
 * @returns The root nodes.
 */
function snapshotRoots(app: StackApp): UiNode[] {
  const tree = app.ui.tree();

  return tree.type === "screen" && tree.key === undefined ? tree.children : [tree];
}

/**
 * Every node of a subtree, the top included.
 *
 * @param node - The top of the subtree.
 * @returns The nodes, depth first.
 */
function flat(node: UiNode): UiNode[] {
  return [node, ...node.children.flatMap(child => flat(child))];
}

/**
 * The snapshot of one popup panel.
 *
 * @param app - The running app.
 * @param key - The key of the panel.
 * @returns The node, or `undefined` when that popup is not mounted.
 */
function panel(app: StackApp, key: string): UiNode | undefined {
  return snapshotRoots(app).find(node => node.key === key);
}

/**
 * Opens the settings popup from `home` and gives it its frames.
 *
 * @returns The running app with the settings popup on screen.
 */
async function openSettings(): Promise<StackApp> {
  const app = await startStackApp();

  expect(app.flow.gate.answer({ intent: "openSettings" })).toBe(true);
  await settle(app);

  return app;
}

describe("a popup the flow shows again", () => {
  it("stays mounted across two answered volume steps: one root, no motion, local kept", async () => {
    const app = await openSettings();
    const [root] = rootsOf(app, "Settings");
    const element = app.ui.find("settingsPanel");

    expect(root).toBeDefined();
    expect(element).toBeDefined();
    expect(played).toEqual({ enter: 1, exit: 0 });

    app.input.tap(app.ui.find("tabVideo") ?? 0);
    app.time.step(16);

    expect(panel(app, "settingsPanel")?.local).toEqual({ tab: "video" });

    for (const volume of [4, 5]) {
      expect(app.input.tap(app.ui.find("louder") ?? 0)).toBe(true);
      await settle(app);

      expect(app.flow.state().path).toBe("settings");
      expect(rootsOf(app, "Settings")).toEqual([root]);
      expect(app.ui.find("settingsPanel")).toBe(element);
      expect(panel(app, "settingsPanel")?.local).toEqual({ tab: "video" });
      expect(
        panel(app, "settingsPanel")?.children.find(child => child.key === "level")
      ).toBeDefined();
      expect(played).toEqual({ enter: 1, exit: 0 });
      expect(textOf(app)).toBe(`video:${volume}`);
    }

    await app.stop();
  });

  it("stays while the flow is in transit and unmounts at the first reconcile at rest", async () => {
    const app = await openSettings();

    expect(app.input.tap(app.ui.find("close") ?? 0)).toBe(true);
    await settle(app, 3);

    expect(app.flow.state().path).toBe("closing");
    expect(app.ui.find("settingsPanel")).toBeDefined();
    expect(played.exit).toBe(0);

    hold.release();
    await tick();

    expect(app.flow.state().path).toBe("home");
    expect(app.ui.find("settingsPanel")).toBeDefined();

    app.time.step(16);

    expect(app.ui.find("settingsPanel")).toBeUndefined();
    expect(played.exit).toBe(1);

    for (let frame = 0; frame < 20; frame += 1) app.time.step(16);

    expect(rootsOf(app, "Settings")).toEqual([]);

    await app.stop();
  });
});

describe("a popup over another popup", () => {
  it("keeps the settings mounted beneath the confirm, every element covered", async () => {
    const app = await openSettings();
    const [settingsRoot] = rootsOf(app, "Settings");

    expect(app.input.tap(app.ui.find("reset") ?? 0)).toBe(true);
    await settle(app);

    expect(app.flow.state().path).toBe("confirmReset");
    expect(rootsOf(app, "Settings")).toEqual([settingsRoot]);
    expect(snapshotRoots(app).map(node => node.key)).toEqual(["confirmPanel", "settingsPanel"]);

    const settingsNodes = flat(panel(app, "settingsPanel") as UiNode);

    expect(settingsNodes.length).toBe(6);
    expect(settingsNodes.every(node => node.state.covered)).toBe(true);
    expect(flat(panel(app, "confirmPanel") as UiNode).some(node => node.state.covered)).toBe(false);
    expect(app.world.ecs.has(settingsRoot ?? 0, Covered)).toBe(true);
    expect(panel(app, "settingsPanel")?.children.at(-1)?.style.alpha).toBe(0);
    // One gate: the covered popup answers nothing.
    expect(app.world.ecs.has(app.ui.find("louder") ?? 0, Tappable)).toBe(false);
    expect(app.input.tap(app.ui.find("louder") ?? 0)).toBe(false);

    await app.stop();
  });

  it("uncovers the same settings root when the confirm is cancelled", async () => {
    const app = await openSettings();
    const [settingsRoot] = rootsOf(app, "Settings");
    const element = app.ui.find("settingsPanel");

    app.input.tap(app.ui.find("reset") ?? 0);
    await settle(app);
    expect(app.input.tap(app.ui.find("no") ?? 0)).toBe(true);
    await settle(app);

    expect(app.flow.state().path).toBe("settings");
    expect(rootsOf(app, "Settings")).toEqual([settingsRoot]);
    expect(app.ui.find("settingsPanel")).toBe(element);
    expect(app.ui.find("confirmPanel")).toBeUndefined();
    expect(flat(panel(app, "settingsPanel") as UiNode).some(node => node.state.covered)).toBe(
      false
    );
    expect(app.world.ecs.has(settingsRoot ?? 0, Covered)).toBe(false);
    expect(app.world.ecs.has(app.ui.find("louder") ?? 0, Tappable)).toBe(true);
    // The confirm played its exit; the settings never left.
    expect(played).toEqual({ enter: 2, exit: 1 });

    expect(app.input.tap(app.ui.find("louder") ?? 0)).toBe(true);
    await settle(app);

    expect(textOf(app)).toBe("audio:4");

    await app.stop();
  });

  it("unmounts both when the confirm is answered and the flow rests on home", async () => {
    const app = await openSettings();

    app.input.tap(app.ui.find("reset") ?? 0);
    await settle(app);
    expect(app.input.tap(app.ui.find("yes") ?? 0)).toBe(true);
    await settle(app, 1);

    expect(app.flow.state().path).toBe("home");
    expect(app.ui.find("confirmPanel")).toBeUndefined();
    expect(app.ui.find("settingsPanel")).toBeUndefined();
    expect(played.exit).toBe(2);

    for (let frame = 0; frame < 20; frame += 1) app.time.step(16);

    expect(rootsOf(app, "Settings")).toEqual([]);
    expect(rootsOf(app, "Confirm")).toEqual([]);
    expect(app.ui.tree().children).toEqual([]);

    await app.stop();
  });
});

/**
 * The text the settings popup shows: the tab and the volume.
 *
 * @param app - The running app.
 * @returns What the `level` text reads.
 */
function textOf(app: StackApp): unknown {
  const { ui, world } = app;
  const level = ui.find("level");

  return level === undefined ? undefined : world.ecs.get(level, TextComponent)?.content;
}

// ---------------------------------------------------------------------------
// The holds of `ui` (spec 28 U1–U3): a popup root holds the feature of its
// component, the JSX root of a projection the feature of its projection, from
// the moment `ui` records the root until the sweep drops it after its exit.
// The flow's nodes belong to the feature `home`, so the other features are
// active only through these holds.
// ---------------------------------------------------------------------------

describe("the feature a ui root holds", () => {
  // Bug caught: the hold ends with the answer, so the reward's systems stop while its panel still
  // plays its exit; or it is never released, so they run for good.
  it("a popup holds its component's feature until its exit ended", async () => {
    const app = await startHeldApp();

    expect(app.world.ecs.isActive("reward")).toBe(false);

    await answer(app, "reward");

    expect(app.flow.state().path).toBe("showReward");
    expect(app.world.ecs.isActive("reward")).toBe(true);

    await answer(app, "ok", 1);

    expect(app.flow.state().path).toBe("home");
    expect(app.ui.find("rewardPanel")).toBeUndefined();
    expect(rootsOf(app, "Reward")).toHaveLength(1);
    expect(app.world.ecs.isActive("reward")).toBe(true);

    settleExits(app);

    expect(rootsOf(app, "Reward")).toEqual([]);
    expect(app.world.ecs.isActive("reward")).toBe(false);

    await app.stop();
  });

  // Bug caught: covering a popup drops the hold of the one beneath, so its feature sleeps while it is shown.
  it("a popup kept covered beneath another stays held", async () => {
    const app = await startHeldApp();

    await answer(app, "prefs");
    await answer(app, "confirm");

    expect(app.flow.state().path).toBe("confirm");
    expect(app.world.ecs.isActive("prefs")).toBe(true);
    expect(app.world.ecs.isActive("confirmKit")).toBe(true);

    await answer(app, "yes", 1);
    settleExits(app);

    expect(rootsOf(app, "Prefs")).toEqual([]);
    expect(rootsOf(app, "Confirm")).toEqual([]);
    expect(app.world.ecs.isActive("prefs")).toBe(false);
    expect(app.world.ecs.isActive("confirmKit")).toBe(false);

    await app.stop();
  });

  // Bug caught: the popup that takes a released root back holds again, so the feature stays active
  // after the root is gone.
  it("a reclaimed popup root is held once", async () => {
    const app = await startHeldApp();

    await answer(app, "prefs");

    const [root] = rootsOf(app, "Prefs");

    await answer(app, "louder");
    await answer(app, "louder");

    expect(rootsOf(app, "Prefs")).toEqual([root]);
    expect(app.world.ecs.isActive("prefs")).toBe(true);

    await answer(app, "close", 1);
    settleExits(app);

    expect(rootsOf(app, "Prefs")).toEqual([]);
    expect(app.world.ecs.isActive("prefs")).toBe(false);

    await app.stop();
  });

  // Bug caught: the hold of a JSX root ends with its view, so the shop's systems stop while the
  // sheet's elements still leave.
  it("the JSX root of a projection holds the projection's feature while its elements leave", async () => {
    const app = await startHeldApp();

    expect(app.world.ecs.isActive("shop")).toBe(false);

    await answer(app, "shop");

    expect(app.world.projection.entitiesOf("shop.sheet")).toHaveLength(1);
    expect(app.world.ecs.isActive("shop")).toBe(true);

    await answer(app, "shop", 1);

    expect(app.world.projection.entitiesOf("shop.sheet")).toEqual([]);
    expect(app.world.ecs.isActive("shop")).toBe(true);

    settleExits(app);

    expect(app.world.ecs.isActive("shop")).toBe(false);

    await app.stop();
  });
});
