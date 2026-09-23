import { describe, expect, it } from "vitest";
import { Shape, Transform } from "../../../renderer/components";
import { Text as TextComponent } from "../../../text/components";
import { Layer, Order } from "../../../world/ecs/define";
import type { UiNode } from "../../jsx/types";
import { type StackApp, settle, startStackApp } from "../stack-app";

// ---------------------------------------------------------------------------
// Delta 6, B5: the keyboard focus ui owns. Tab and Shift+Tab walk the controls
// of the top root in reading order, Enter and Space tap the focused one, Escape
// taps the `escape` button of the top root, a pointer tap clears the focus, and
// a ring of two shapes follows the focused rect. `app.input.key` presses keys.
// ---------------------------------------------------------------------------

/** The ring colour and the halo colour of the default `focusRing`. */
const INK = 0x3a_22_12;
const CREAM = 0xff_f3_d6;

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
 * Every node of a subtree, the top included.
 *
 * @param node - The top of the subtree.
 * @returns The nodes, depth first.
 */
function flat(node: UiNode): UiNode[] {
  return [node, ...node.children.flatMap(child => flat(child))];
}

/**
 * The key of the element the keyboard focused.
 *
 * @param app - The running app.
 * @returns The key, or `undefined` when nothing is focused.
 */
function focused(app: StackApp): string | undefined {
  return flat(app.ui.tree()).find(node => node.state.focus)?.key;
}

/**
 * The snapshot of one keyed element.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The node, or `undefined`.
 */
function nodeOf(app: StackApp, key: string): UiNode | undefined {
  return flat(app.ui.tree()).find(node => node.key === key);
}

/**
 * Presses Tab a number of times and reads the focused key after each press.
 *
 * @param app - The running app.
 * @param times - How many presses.
 * @param shift - Whether Shift is held.
 * @returns The focused keys, one per press.
 */
function tabs(app: StackApp, times: number, shift = false): (string | undefined)[] {
  const keys: (string | undefined)[] = [];

  for (let press = 0; press < times; press += 1) {
    expect(app.input.key("Tab", { shift })).toBe(true);
    keys.push(focused(app));
  }

  return keys;
}

/**
 * The two entities of the focus ring, found by their colours.
 *
 * @param app - The running app.
 * @returns The halo and the ring, `undefined` before the first focus.
 */
function ringParts(app: StackApp): { halo: number | undefined; ring: number | undefined } {
  const parts: { halo: number | undefined; ring: number | undefined } = {
    halo: undefined,
    ring: undefined
  };

  for (const [entity, shape] of app.world.ecs.query(Shape)) {
    if (shape.stroke === INK && shape.dash > 0) parts.ring = entity;
    if (shape.stroke === CREAM) parts.halo = entity;
  }

  return parts;
}

/**
 * Collects every entity `input` taps from now on, the way a game's listener would.
 *
 * @param app - The running app.
 * @returns The list the taps are pushed onto.
 */
function recordTaps(app: StackApp): number[] {
  const tapped: number[] = [];

  app.input.onTap(entity => tapped.push(entity));

  return tapped;
}

/**
 * Opens the settings popup from `home` and gives it its frames.
 *
 * @returns The running app with the settings popup on screen.
 */
async function openSettings(): Promise<StackApp> {
  const app = await startStackApp();

  expect(app.flow.gate.answer({ intent: "openSettings" })).toBe(true);
  await settle(app, 3);

  return app;
}

describe("Tab and Shift+Tab", () => {
  it("walk the controls of the screen in reading order, not markup order, and wrap", async () => {
    const app = await startStackApp();

    mount(app, ["focusScreen"]);

    expect(focused(app)).toBeUndefined();
    expect(tabs(app, 5)).toEqual(["first", "second", "pinned", "third", "first"]);

    await app.stop();
  });

  it("start from the last control on Shift+Tab and walk back, wrapping", async () => {
    const app = await startStackApp();

    mount(app, ["focusScreen"]);

    expect(tabs(app, 2, true)).toEqual(["third", "pinned"]);
    expect(tabs(app, 1)).toEqual(["third"]);
    expect(tabs(app, 1)).toEqual(["first"]);
    expect(tabs(app, 1, true)).toEqual(["third"]);

    await app.stop();
  });

  it("do nothing on a root without a control, and leave other keys alone", async () => {
    const app = await startStackApp();

    mount(app, ["slotScreen"]);

    expect(app.input.key("Tab")).toBe(false);
    expect(app.input.key("Enter")).toBe(false);
    expect(app.input.key("q")).toBe(false);
    expect(focused(app)).toBeUndefined();
    expect(ringParts(app)).toEqual({ halo: undefined, ring: undefined });

    await app.stop();
  });
});

describe("the focus look", () => {
  it("applies is.focus and draws the halo under the dashed ring, offset outside the rect", async () => {
    const app = await startStackApp();

    mount(app, ["focusScreen"]);
    tabs(app, 1);

    expect(nodeOf(app, "first")?.state.focus).toBe(true);
    expect(nodeOf(app, "first")?.style.scale).toBe(1.1);

    const { halo, ring } = ringParts(app);

    expect(app.world.ecs.get(ring ?? 0, Shape)).toMatchObject({
      w: 118,
      h: 118,
      radius: 21,
      stroke: INK,
      strokeWidth: 4,
      dash: 10,
      fillAlpha: 0,
      alpha: 1
    });
    expect(app.world.ecs.get(halo ?? 0, Shape)).toMatchObject({
      w: 118,
      h: 118,
      stroke: CREAM,
      strokeWidth: 12,
      dash: 0,
      alpha: 1
    });
    expect(app.world.ecs.get(ring ?? 0, Transform)).toMatchObject({ x: -9, y: -9 });
    expect(app.world.ecs.get(ring ?? 0, Layer)).toEqual({ name: "ui" });

    const rootOrder = app.world.ecs.get(app.ui.find("focusRoot") ?? 0, Order)?.value ?? 0;
    const haloOrder = app.world.ecs.get(halo ?? 0, Order)?.value ?? 0;
    const ringOrder = app.world.ecs.get(ring ?? 0, Order)?.value ?? 0;

    expect(haloOrder).toBeGreaterThan(rootOrder);
    expect(ringOrder).toBeGreaterThan(haloOrder);
    expect(ringOrder).toBeLessThan(rootOrder + 1);

    await app.stop();
  });

  it("moves the ring with the focus and takes the look back from the element it left", async () => {
    const app = await startStackApp();

    mount(app, ["focusScreen"]);
    tabs(app, 2);
    app.time.step(16);

    const { ring } = ringParts(app);

    expect(app.world.ecs.get(ring ?? 0, Transform)).toMatchObject({ x: 101, y: -9 });
    expect(app.world.ecs.get(ring ?? 0, Shape)?.radius).toBe(9);
    expect(nodeOf(app, "first")?.state.focus).toBe(false);
    expect(nodeOf(app, "first")?.style.scale).toBeUndefined();

    await app.stop();
  });

  it("clears the focus and hides the ring on a pointer tap", async () => {
    const app = await startStackApp();

    mount(app, ["focusScreen"]);
    tabs(app, 1);
    app.input.tap(app.ui.find("second") ?? 0);
    app.time.step(16);

    const { halo, ring } = ringParts(app);

    expect(focused(app)).toBeUndefined();
    expect(app.world.ecs.get(ring ?? 0, Shape)?.alpha).toBe(0);
    expect(app.world.ecs.get(halo ?? 0, Shape)?.alpha).toBe(0);

    // The next Tab starts again from the first control and shows the ring.
    expect(tabs(app, 1)).toEqual(["first"]);
    expect(app.world.ecs.get(ring ?? 0, Shape)?.alpha).toBe(1);

    await app.stop();
  });

  it("drops the focus when its element unmounts", async () => {
    const app = await startStackApp();

    mount(app, ["focusScreen"]);
    tabs(app, 1);
    app.world.projection.unmount(["focusScreen"]);

    for (let frame = 0; frame < 4; frame += 1) app.time.step(16);

    expect(app.world.ecs.get(ringParts(app).ring ?? 0, Shape)?.alpha).toBe(0);
    expect(app.input.key("Enter")).toBe(false);

    await app.stop();
  });
});

describe("Enter and Space", () => {
  it("tap the focused control through input and keep the focus", async () => {
    const app = await startStackApp();

    mount(app, ["focusScreen"]);

    const tapped = recordTaps(app);

    tabs(app, 2);

    expect(app.input.key("Enter")).toBe(true);
    expect(tapped).toEqual([app.ui.find("second")]);
    expect(focused(app)).toBe("second");

    await app.stop();
  });

  it("Space writes the local state of a tab of the settings popup", async () => {
    const app = await openSettings();

    expect(tabs(app, 1)).toEqual(["tabVideo"]);
    expect(app.input.key(" ")).toBe(true);
    app.time.step(16);
    app.time.step(16);

    const level = app.ui.find("level") ?? 0;

    expect(app.world.ecs.get(level, TextComponent)?.content).toBe("video:3");
    expect(focused(app)).toBe("tabVideo");

    await app.stop();
  });
});

describe("Escape", () => {
  it("taps the escape button of the top popup only", async () => {
    const app = await openSettings();
    const tapped = recordTaps(app);

    app.input.tap(app.ui.find("reset") ?? 0);
    await settle(app, 3);

    const no = app.ui.find("no");

    expect(no).toBeDefined();
    expect(app.input.key("Escape")).toBe(true);
    expect(tapped.at(-1)).toBe(no);

    await settle(app, 3);

    // The confirm is gone: Escape now closes the settings.
    expect(app.input.key("Escape")).toBe(true);
    expect(tapped.at(-1)).toBe(app.ui.find("close"));

    await app.stop();
  });

  it("does nothing on a root without an escape button", async () => {
    const app = await startStackApp();

    mount(app, ["focusScreen"]);

    expect(app.input.key("Escape")).toBe(false);

    await app.stop();
  });
});

describe("a covered root", () => {
  it("loses its focus, and Tab walks the popup over it", async () => {
    const app = await openSettings();

    // `close` is marked `escape` and has no children: no Tab stop, the focus wraps past it.
    expect(tabs(app, 4)).toEqual(["tabVideo", "louder", "reset", "tabVideo"]);
    expect(tabs(app, 1, true)).toEqual(["reset"]);
    expect(app.input.key("Enter")).toBe(true);
    await settle(app, 3);

    expect(nodeOf(app, "reset")?.state.focus).toBe(false);
    expect(focused(app)).toBeUndefined();
    expect(app.world.ecs.get(ringParts(app).ring ?? 0, Shape)?.alpha).toBe(0);
    expect(tabs(app, 2)).toEqual(["yes", "no"]);

    await app.stop();
  });
});

describe("a backdrop", () => {
  it("is no Tab stop, and Escape still taps it", async () => {
    const app = await startStackApp();

    mount(app, ["backdropScreen"]);

    const tapped = recordTaps(app);

    expect(tabs(app, 3)).toEqual(["closeX", "okButton", "closeX"]);
    expect(app.input.key("Escape")).toBe(true);
    expect(tapped).toEqual([app.ui.find("backdrop")]);

    await app.stop();
  });
});
