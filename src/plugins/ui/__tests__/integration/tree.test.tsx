import { describe, expect, it } from "vitest";
import type { UiNode } from "../../jsx/types";
import { startUiApp } from "../app";
import { settle, startExtrasApp } from "../extras-app";

// ---------------------------------------------------------------------------
// Integration: `ui.tree()` carries the text a label draws, so a reader of
// `game.ui` (the editor's reference cards) sees the words of the screen.
// Real world, i18n, text and Yoga; plain Bun, inert renderer.
// ---------------------------------------------------------------------------

/**
 * Every node of a snapshot, depth first.
 *
 * @param node - The snapshot root.
 * @returns The node and all nodes under it.
 */
function flat(node: UiNode): UiNode[] {
  return [node, ...node.children.flatMap(child => flat(child))];
}

/**
 * The node with a key in the live tree.
 *
 * @param tree - What `ui.tree()` answered.
 * @param key - The key of the element.
 * @returns The node, or `undefined`.
 */
function nodeOf(tree: UiNode, key: string): UiNode | undefined {
  return flat(tree).find(node => node.key === key);
}

describe("ui.tree() content", () => {
  it("gives a text its content and leaves it off every other node", async () => {
    const app = await startUiApp();
    const tree = app.ui.tree();

    expect(nodeOf(tree, "coins")?.content).toBe("7");
    expect(nodeOf(tree, "which")?.content).toBe("audio:3");
    expect(Object.hasOwn(tree, "content")).toBe(false);
    expect(Object.hasOwn(nodeOf(tree, "settings") ?? {}, "content")).toBe(false);

    await app.stop();
  });

  it("gives a tr() label the string it resolved to", async () => {
    const app = await startUiApp();

    app.world.projection.mount(["hud", "rich"], { kind: "plugin", name: "test" });
    app.time.step(16);
    app.time.step(16);

    expect(nodeOf(app.ui.tree(), "auto")?.content).toBe("coins 3");

    await app.stop();
  });

  it("gives a bound label the number it shows", async () => {
    const app = await startExtrasApp();

    app.world.projection.mount(["boundScreen"], { kind: "plugin", name: "test" });
    await settle(app);

    expect(nodeOf(app.ui.tree(), "bound")?.content).toBe("9");
    expect(nodeOf(app.ui.tree(), "plain")?.content).toBe("9");

    await app.stop();
  });
});
