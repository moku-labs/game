import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewportSize } from "../../../renderer/viewport/types";
import { Text } from "../../../text/components";
import { Box } from "../../components";
import { SHORT, startTextWhenApp, TALL, type TextWhenApp } from "../text-when-app";

// ---------------------------------------------------------------------------
// Integration: a text's style object names its text style key, and a `when`
// variant may name another (F182). One text node draws and measures with the key
// of the frame, and a new frame writes `Text.style` in the frame it lands in.
// Real world, text and Yoga; plain Bun, inert renderer, no font loaded.
// ---------------------------------------------------------------------------

/** The snapshot node `app.ui.tree()` answers. */
type TreeNode = ReturnType<TextWhenApp["ui"]["tree"]>;

/**
 * The entity of a keyed element.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity, 0 when there is none.
 */
function find(app: TextWhenApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  return app.ui.find(key) ?? 0;
}

/**
 * What a text draws with and the rect it was laid out at.
 *
 * @param app - The running app.
 * @param key - The key of the text.
 * @returns Its `Text.style`, `Text.content` and `Box`.
 */
function drawn(app: TextWhenApp, key: string) {
  const entity = find(app, key);
  const text = app.world.ecs.get(entity, Text);

  return {
    entity,
    style: text?.style,
    content: text?.content,
    box: app.world.ecs.get(entity, Box)
  };
}

/**
 * The height a string takes in a style, in whole units, as the layout rounds it.
 *
 * @param app - The running app.
 * @param content - The string.
 * @param style - The text style key.
 * @returns The height.
 */
function heightOf(app: TextWhenApp, content: string, style: string): number {
  return Math.ceil(app.text.measure(content, style).height - 0.0001);
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Moves the app onto another viewport and runs one frame.
 *
 * @param app - The running app.
 * @param viewport - The viewport of the next frame.
 */
function frameOn(app: TextWhenApp, viewport: ViewportSize): void {
  vi.spyOn(app.renderer.viewport, "size").mockReturnValue(viewport);
  app.time.step(16);
}

/**
 * Finds a keyed node of the snapshot tree.
 *
 * @param node - Where the walk starts.
 * @param key - The key to look for.
 * @returns The node, when it is in the tree.
 */
function nodeNamed(node: TreeNode, key: string): TreeNode | undefined {
  if (node.key === key) return node;

  for (const child of node.children) {
    const found = nodeNamed(child, key);

    if (found !== undefined) return found;
  }

  return undefined;
}

describe("a text whose style object names its key in `when` (F182)", () => {
  // Catches: the key read from the `style` prop only, so an object style draws `body`.
  it("draws and measures with the base key on a short frame and the tall key on a tall one", async () => {
    const short = await startTextWhenApp(SHORT);

    expect(drawn(short, "title").style).toBe("tw.short");
    expect(drawn(short, "title").box?.h).toBe(heightOf(short, "Vitrine", "tw.short"));
    expect(drawn(short, "message").style).toBe("tw.short");

    const tall = await startTextWhenApp(TALL);

    expect(drawn(tall, "title").style).toBe("tw.tall");
    expect(drawn(tall, "title").box?.h).toBe(heightOf(tall, "Vitrine", "tw.tall"));
    expect(drawn(tall, "message").style).toBe("tw.tall");
    expect(heightOf(tall, "Vitrine", "tw.tall")).toBeGreaterThan(
      heightOf(tall, "Vitrine", "tw.short")
    );

    await short.stop();
    await tall.stop();
  });

  // Catches: a measure with the stale key, one frame late; and `Text.style` never written on a new frame.
  it("switches `Text.style` and the laid-out height of the same entity in the frame the viewport changes", async () => {
    const app = await startTextWhenApp(SHORT);
    const before = drawn(app, "title");

    frameOn(app, TALL);

    expect(drawn(app, "title")).toMatchObject({
      entity: before.entity,
      style: "tw.tall",
      box: { h: heightOf(app, "Vitrine", "tw.tall") }
    });

    frameOn(app, SHORT);

    expect(drawn(app, "title")).toMatchObject({
      entity: before.entity,
      style: "tw.short",
      box: { h: heightOf(app, "Vitrine", "tw.short") }
    });

    await app.stop();
  });

  // Catches: F167 broken (a system's style lost on an equal key), the key never written on a
  // changed one, or the content rewritten with the key.
  it("keeps a system's `Text.style` while the resolved key stands, replaces it when the key changes, and keeps its content", async () => {
    const app = await startTextWhenApp(SHORT);

    app.world.ecs.set(find(app, "steady"), Text, { style: "tw.other", content: "12" });
    app.world.ecs.set(find(app, "title"), Text, { style: "tw.other", content: "Shop" });
    app.time.step(16);
    frameOn(app, TALL);
    app.time.step(16);

    expect(drawn(app, "steady")).toMatchObject({ style: "tw.other", content: "12" });
    expect(drawn(app, "title")).toMatchObject({ style: "tw.tall", content: "Shop" });
    expect(drawn(app, "title").box?.h).toBe(heightOf(app, "Shop", "tw.tall"));

    await app.stop();
  });

  // Catches: the layout fields of the style dropped once it names a key.
  it('lays a text with `width: "100%"` beside its key out at its parent\'s width, drawn with the key', async () => {
    const app = await startTextWhenApp(TALL);

    expect(drawn(app, "rule")).toMatchObject({ style: "tw.tall", box: { w: 600 } });

    await app.stop();
  });

  // Catches: a regression of the texts that name no key in their object, or name it as a string.
  it("still draws `body` for a style object without `text`, and the key of a string style", async () => {
    const app = await startTextWhenApp(SHORT);

    expect(drawn(app, "plain").style).toBe("body");
    expect(drawn(app, "keyed").style).toBe("tw.short");

    frameOn(app, TALL);

    expect(drawn(app, "plain").style).toBe("body");
    expect(drawn(app, "keyed").style).toBe("tw.short");

    await app.stop();
  });

  // Catches: the frame's key written over the style a named format answered.
  it("keeps the style of a named format on a bound text, on both frames", async () => {
    const app = await startTextWhenApp(SHORT);

    expect(app.world.ecs.get(find(app, "coins"), Text)).toMatchObject({
      resolved: "5 c",
      style: "tw.format"
    });

    frameOn(app, TALL);
    app.time.step(16);

    expect(drawn(app, "coins").style).toBe("tw.format");

    await app.stop();
  });
});

describe("the snapshot tree of a text whose key follows the frame (F182)", () => {
  // Catches: the tree reading the key off the `style` prop, which is an object here.
  it("reports the resolved key as `textStyle`", async () => {
    const app = await startTextWhenApp(SHORT);

    expect(nodeNamed(app.ui.tree(), "title")?.textStyle).toBe("tw.short");

    frameOn(app, TALL);

    const tree = app.ui.tree();

    expect(nodeNamed(tree, "title")?.textStyle).toBe("tw.tall");
    expect(nodeNamed(tree, "keyed")?.textStyle).toBe("tw.short");
    expect(nodeNamed(tree, "coins")?.textStyle).toBe("tw.format");
    expect(nodeNamed(tree, "plain")).not.toHaveProperty("textStyle");

    await app.stop();
  });
});

describe("lint of a text whose key follows the frame (F182)", () => {
  // Catches: lint measuring with the `style` prop or with `body` instead of the frame's key.
  it("reports a tall key that overflows its box on a tall frame, and nothing on a short one", async () => {
    const app = await startTextWhenApp(SHORT);
    const overflows = (): boolean =>
      app.ui.lint().some(finding => finding.rule === "text-overflow" && finding.key === "boxed");

    expect(overflows()).toBe(false);

    frameOn(app, TALL);

    expect(overflows()).toBe(true);

    await app.stop();
  });
});
