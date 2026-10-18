import { describe, expect, it } from "vitest";
import { Tappable } from "../../../input/components";
import { Text as TextComponent } from "../../../text/components";
import { Tree } from "../../../world/ecs/define";
import { Covered } from "../../components";
import type { UiNode } from "../../jsx/types";
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
 * @param app - The running app.
 * @param component - The component name.
 * @returns The entities, in spawn order.
 */
function rootsOf(app: StackApp, component: string): number[] {
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
