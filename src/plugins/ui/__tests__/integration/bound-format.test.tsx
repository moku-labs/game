import { describe, expect, it, vi } from "vitest";
import type { ViewportSize } from "../../../renderer/viewport/types";
import { Text } from "../../../text/components";
import { Box, UiCounters } from "../../components";
import { asked, Counter, type FormatApp, startFormatApp } from "../format-app";

// ---------------------------------------------------------------------------
// Integration: a text whose bind names a format of the game is sized by the
// answer of the format, and `ui` leaves its `Text.style` alone (F135). Real world,
// text and Yoga; plain Bun, inert renderer, no font loaded: "1.5K" in `digits.14`
// is 33.6 wide, 34 in whole units; "950" in `digits.17` is 30.6, 31 in whole units.
// ---------------------------------------------------------------------------

/** A viewport other than the one the fixture starts on. */
const TALL: ViewportSize = {
  width: 1080,
  height: 2400,
  scale: 0.36,
  orientation: "portrait",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
};

/**
 * Mounts the pill and runs its first frame: the reconcile and the first solve.
 *
 * @returns The running app, the screen solved once and its labels resolved after the solve.
 */
async function mountPill(): Promise<FormatApp> {
  const app = await startFormatApp();

  app.world.projection.mount(["pillScreen"], { kind: "plugin", name: "test" });
  app.time.step(16);

  return app;
}

/**
 * The entity of a keyed element.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity, 0 when there is none.
 */
function find(app: FormatApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  return app.ui.find(key) ?? 0;
}

/**
 * What the pill shows, read through the world.
 *
 * @param app - The running app.
 * @returns `Text.resolved` and `Text.style`.
 */
function shown(app: FormatApp): [string | undefined, string | undefined] {
  const text = app.world.ecs.get(find(app, "pill"), Text);

  return [text?.resolved, text?.style];
}

/**
 * Where the middle of the pill sits in its row.
 *
 * @param app - The running app.
 * @returns The distance from the left edge of the row.
 */
function centreInRow(app: FormatApp): number {
  const pill = app.world.ecs.get(find(app, "pill"), Box) ?? { x: 0, w: 0 };
  const row = app.world.ecs.get(find(app, "pillRow"), Box) ?? { x: 0 };

  return pill.x + pill.w / 2 - row.x;
}

/**
 * How many solves the app ran so far.
 *
 * @param app - The running app.
 * @returns The count.
 */
function solves(app: FormatApp): number {
  return app.world.ecs.resource(UiCounters).solves;
}

/**
 * Taps a control of the pill and gives the commit its two frames.
 *
 * @param app - The running app.
 * @param key - The key of the control.
 */
function tapAndSettle(app: FormatApp, key: string): void {
  app.input.tap(find(app, key));
  app.time.step(16);
  app.time.step(16);
}

/**
 * Finds a keyed node of the snapshot tree.
 *
 * @param node - Where the walk starts.
 * @param key - The key to look for.
 * @returns The node, when it is in the tree.
 */
function nodeNamed(
  node: ReturnType<FormatApp["ui"]["tree"]>,
  key: string
): ReturnType<FormatApp["ui"]["tree"]> | undefined {
  if (node.key === key) return node;

  for (const child of node.children) {
    const found = nodeNamed(child, key);

    if (found !== undefined) return found;
  }

  return undefined;
}

describe("a text whose bind names a format", () => {
  it("is sized by the answer on its first solve and shows it in that frame, centred", async () => {
    const app = await mountPill();

    expect(shown(app)).toEqual(["1.5K", "digits.14"]);
    expect(app.world.ecs.get(find(app, "pill"), Box)?.w).toBe(34);
    expect(Math.abs(centreInRow(app) - 150)).toBeLessThanOrEqual(0.5);

    await app.stop();
  });

  it("asks for no second solve in the frames after its first", async () => {
    const app = await mountPill();
    const before = solves(app);

    app.time.step(16);
    app.time.step(16);

    expect(solves(app)).toBe(before);

    await app.stop();
  });

  it("takes a new size over a tier, centred again", async () => {
    const app = await mountPill();

    app.time.step(16);
    app.world.ecs.set(find(app, "pill"), Counter, { value: 950 });
    app.time.step(16);

    expect(shown(app)).toEqual(["950", "digits.17"]);
    expect(app.world.ecs.get(find(app, "pill"), Box)?.w).toBe(31);
    expect(Math.abs(centreInRow(app) - 150)).toBeLessThanOrEqual(0.5);

    // "2K" in `digits.14` is 16.8 wide; in the `digits.17` of the prop it would be 20.4.
    app.world.ecs.set(find(app, "pill"), Counter, { value: 2000 });
    app.time.step(16);

    expect(shown(app)).toEqual(["2K", "digits.14"]);
    expect(app.world.ecs.get(find(app, "pill"), Box)?.w).toBe(17);
    expect(Math.abs(centreInRow(app) - 150)).toBeLessThanOrEqual(0.5);

    await app.stop();
  });

  it("asks once and solves nothing on a step with the same answer", async () => {
    const app = await mountPill();

    app.time.step(16);

    const before = solves(app);
    const calls = asked.count;

    // 1510 shows "1.5K" too.
    app.world.ecs.set(find(app, "pill"), Counter, { value: 1510 });
    app.time.step(16);
    app.time.step(16);

    expect(asked.count).toBe(calls + 1);
    expect(shown(app)).toEqual(["1.5K", "digits.14"]);
    expect(solves(app)).toBe(before);

    await app.stop();
  });

  // `text` would mend a style `ui` wrote in the same frame, so `shown` alone proves nothing here:
  // a commit that left the style alone did not make the format answer again.
  it("keeps its style through a commit that rewrites its components, with no solve", async () => {
    const app = await mountPill();

    app.time.step(16);

    const before = solves(app);
    const calls = asked.count;

    tapAndSettle(app, "touch");

    expect(shown(app)).toEqual(["1.5K", "digits.14"]);
    expect(asked.count).toBe(calls);
    expect(solves(app)).toBe(before);

    await app.stop();
  });

  it("keeps its style on a new viewport, and records it as the rest of the label", async () => {
    const app = await mountPill();

    app.time.step(16);

    const calls = asked.count;

    vi.spyOn(app.renderer.viewport, "size").mockReturnValue(TALL);
    app.time.step(16);

    expect(shown(app)).toEqual(["1.5K", "digits.14"]);
    expect(asked.count).toBe(calls);
    expect(app.world.projection.restOf(find(app, "pill"), Text)?.style).toBe("digits.14");

    await app.stop();
  });

  it("shows the style of the answer in the snapshot tree", async () => {
    const app = await mountPill();

    expect(nodeNamed(app.ui.tree(), "pill")).toMatchObject({
      content: "1.5K",
      textStyle: "digits.14"
    });

    await app.stop();
  });

  it("takes the style of its prop when the bind goes back to a built-in format", async () => {
    const app = await mountPill();

    app.time.step(16);
    tapAndSettle(app, "builtIn");

    expect(shown(app)).toEqual(["1500", "digits.17"]);

    await app.stop();
  });
});
