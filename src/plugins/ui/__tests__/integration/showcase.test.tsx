import { describe, expect, it, vi } from "vitest";
import { PointerOver, Pressed, Tappable, Touchable } from "../../../input/components";
import { NineSlice, Shape, Sprite, Transform } from "../../../renderer/components";
import type { ViewportSize } from "../../../renderer/viewport/types";
import { Box } from "../../components";
import type { UiNode } from "../../jsx/types";
import { fitBars, startUiApp, swingDrop, tick } from "../app";

// ---------------------------------------------------------------------------
// Delta 4 of the ui plugin, on the real screen set in plain Bun: nine-slices in
// the style, image fits, the panel that swallows taps, hover, the visual
// transform styles, `fit: "contain"` on two phone viewports and overflow clip.
// ---------------------------------------------------------------------------

/** The app the tests drive. */
type App = Awaited<ReturnType<typeof startUiApp>>;

/**
 * An iPhone SE (375 x 667 CSS px) in reference units: the short side is 1080.
 */
const SE: ViewportSize = {
  width: 1080,
  height: (667 * 1080) / 375,
  scale: 375 / 1080,
  orientation: "portrait",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
};

/**
 * A Pixel 7 (412 x 915 CSS px) in reference units.
 */
const PIXEL: ViewportSize = {
  width: 1080,
  height: (915 * 1080) / 412,
  scale: 412 / 1080,
  orientation: "portrait",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
};

/**
 * Mounts one more projection on the running app and gives it two frames.
 *
 * @param app - What `startUiApp` returned.
 * @param name - The projection to mount.
 */
function mount(app: App, name: string): void {
  app.world.projection.mount(["hud", name], { kind: "plugin", name: "test" });
  app.time.step(16);
  app.time.step(16);
}

/**
 * Puts the app on a phone viewport and gives it one frame, so every root solves again.
 *
 * @param app - What `startUiApp` returned.
 * @param viewport - The viewport the renderer answers from now on.
 */
function useViewport(app: App, viewport: ViewportSize): void {
  vi.spyOn(app.renderer.viewport, "size").mockReturnValue(viewport);
  app.time.step(16);
}

/**
 * Finds a keyed node in a snapshot.
 *
 * @param node - The snapshot to search.
 * @param key - The key of the node.
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

/**
 * The entity of a keyed element, failing the test when it is not there.
 *
 * @param app - What `startUiApp` returned.
 * @param key - The key of the element.
 * @returns The entity.
 */
function entityOf(app: App, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  expect(entity).toBeDefined();

  return entity ?? 0;
}

describe("nine-slice in the style", () => {
  it("draws a button, a row and a stack with the NineSlice of their style at their rect", async () => {
    const app = await startUiApp();

    mount(app, "showcase");

    const sliced = entityOf(app, "sliced");

    expect(app.world.ecs.get(sliced, NineSlice)).toEqual({
      texture: "ui.button",
      width: 300,
      height: 120,
      alpha: 0.9,
      tint: 0xff_ee_dd,
      debug: false
    });
    expect(app.world.ecs.has(sliced, Shape)).toBe(false);
    expect(app.world.ecs.get(entityOf(app, "slicedRow"), NineSlice)?.texture).toBe("ui.strip");
    expect(app.world.ecs.get(entityOf(app, "slicedStack"), NineSlice)).toMatchObject({
      texture: "ui.card",
      width: 200,
      height: 200
    });
    expect(app.world.projection.restOf(sliced, NineSlice)?.texture).toBe("ui.button");

    await app.stop();
  });

  it("swaps the texture with a state variant", async () => {
    const app = await startUiApp();

    mount(app, "showcase");

    expect(app.world.ecs.get(entityOf(app, "offButton"), NineSlice)?.texture).toBe("ui.button-off");

    const sliced = entityOf(app, "sliced");

    app.world.ecs.tag(sliced, PointerOver);
    app.time.step(16);

    expect(app.world.ecs.get(sliced, NineSlice)?.texture).toBe("ui.button-hover");

    app.world.ecs.untag(sliced, PointerOver);
    app.time.step(16);

    expect(app.world.ecs.get(sliced, NineSlice)?.texture).toBe("ui.button");

    await app.stop();
  });

  it("trades the rectangle for the nine-slice and back when a variant adds one", async () => {
    const app = await startUiApp();

    mount(app, "showcase");

    const swapper = entityOf(app, "swapper");

    expect(app.world.ecs.get(swapper, Shape)?.fill).toBe(0x11_11_11);
    expect(app.world.ecs.has(swapper, NineSlice)).toBe(false);

    app.world.ecs.tag(swapper, PointerOver);
    app.time.step(16);

    expect(app.world.ecs.get(swapper, NineSlice)?.texture).toBe("ui.strip");
    expect(app.world.ecs.has(swapper, Shape)).toBe(false);

    app.world.ecs.untag(swapper, PointerOver);
    app.time.step(16);

    expect(app.world.ecs.has(swapper, NineSlice)).toBe(false);
    expect(app.world.ecs.get(swapper, Shape)?.fill).toBe(0x11_11_11);

    await app.stop();
  });
});

describe("images", () => {
  it("draws an image and an icon at their rect with the fit of their prop", async () => {
    const app = await startUiApp();

    mount(app, "showcase");

    expect(app.world.ecs.get(entityOf(app, "cover"), Sprite)).toMatchObject({
      texture: "ui.bg",
      width: 300,
      height: 200,
      fit: "cover",
      tint: 0xaa_aa_aa,
      anchor: { x: 0, y: 0 }
    });
    expect(app.world.ecs.get(entityOf(app, "contained"), Sprite)).toMatchObject({
      width: 64,
      height: 64,
      fit: "contain"
    });
    expect(app.world.ecs.get(entityOf(app, "filled"), Sprite)).toMatchObject({
      width: 48,
      height: 48,
      fit: "fill"
    });
    expect(app.world.projection.restOf(entityOf(app, "cover"), Sprite)?.fit).toBe("cover");

    await app.stop();
  });
});

describe("a panel", () => {
  it("swallows the tap and answers nothing", async () => {
    const app = await startUiApp();

    mount(app, "showcase");

    const card = entityOf(app, "card");

    expect(app.world.ecs.has(card, Touchable)).toBe(true);
    expect(app.world.ecs.has(card, Tappable)).toBe(false);

    await app.stop();
  });
});

describe("overflow hidden", () => {
  it("clips the children of the element to its rect", async () => {
    const app = await startUiApp();

    mount(app, "showcase");

    expect(app.world.ecs.get(entityOf(app, "clipper"), Shape)?.clip).toBe(true);
    expect(app.world.ecs.get(entityOf(app, "corner"), Shape)?.clip).toBe(false);

    await app.stop();
  });
});

describe("hover", () => {
  it("applies the hover variant while the pointer is over the element", async () => {
    const app = await startUiApp();

    mount(app, "showcase");

    const sliced = entityOf(app, "sliced");

    app.world.ecs.tag(sliced, PointerOver);
    app.time.step(16);

    expect(nodeOf(app.ui.tree(), "sliced")?.state.hover).toBe(true);
    expect(nodeOf(app.ui.tree(), "sliced")?.style.offsetY).toBe(-6);

    await app.stop();
  });

  it("lets pressed win over hover", async () => {
    const app = await startUiApp();

    mount(app, "showcase");

    const sliced = entityOf(app, "sliced");

    app.world.ecs.tag(sliced, PointerOver);
    app.world.ecs.tag(sliced, Pressed);
    app.time.step(16);

    expect(app.world.ecs.get(sliced, NineSlice)?.texture).toBe("ui.button-pressed");
    expect(nodeOf(app.ui.tree(), "sliced")?.style.scale).toBe(0.95);

    await app.stop();
  });

  it("applies neither hover nor pressed to a disabled element", async () => {
    const app = await startUiApp();

    mount(app, "showcase");

    const off = entityOf(app, "offButton");

    app.world.ecs.tag(off, PointerOver);
    app.world.ecs.tag(off, Pressed);
    app.time.step(16);

    const node = nodeOf(app.ui.tree(), "offButton");

    expect(node?.state).toMatchObject({ disabled: true, hover: true, pressed: true });
    expect(node?.style.offsetY).toBeUndefined();
    expect(app.world.ecs.get(off, NineSlice)?.texture).toBe("ui.button-off");

    await app.stop();
  });
});

describe("the visual transform styles", () => {
  it("turn an element around its centre by default, keeping the unscaled pose", async () => {
    const app = await startUiApp();

    mount(app, "showcase");

    const sliced = entityOf(app, "sliced");
    const box = app.world.ecs.get(sliced, Box) ?? { x: 0, y: 0, w: 0, h: 0 };
    const parent = app.world.ecs.get(entityOf(app, "showRoot"), Box) ?? box;

    expect(app.world.projection.restOf(sliced, Transform)).toEqual({
      x: box.x - parent.x + 150,
      y: box.y - parent.y + 60,
      rotation: 0,
      scale: 1,
      pivot: { x: 150, y: 60 }
    });
    expect(app.world.ecs.get(sliced, Transform)).toEqual(
      app.world.projection.restOf(sliced, Transform)
    );

    await app.stop();
  });

  it("write offset, scale and origin into the rest transform, never into the rect", async () => {
    const app = await startUiApp();

    mount(app, "showcase");

    const lifted = entityOf(app, "lifted");
    const corner = entityOf(app, "corner");
    const root = app.world.ecs.get(entityOf(app, "showRoot"), Box) ?? { x: 0, y: 0, w: 0, h: 0 };
    const liftedBox = app.world.ecs.get(lifted, Box) ?? root;
    const cornerBox = app.world.ecs.get(corner, Box) ?? root;

    expect(liftedBox.w).toBe(100);
    expect(app.world.projection.restOf(lifted, Transform)).toEqual({
      x: liftedBox.x - root.x + 50 + 10,
      y: liftedBox.y - root.y - 20,
      rotation: 0,
      scale: 1.5,
      pivot: { x: 50, y: 0 }
    });
    expect(app.world.projection.restOf(corner, Transform)).toEqual({
      x: cornerBox.x - root.x,
      y: cornerBox.y - root.y,
      rotation: 0,
      scale: 1,
      pivot: { x: 0, y: 0 }
    });

    await app.stop();
  });

  it("applies a state change of the rest pose at once when the element has no change motion", async () => {
    const app = await startUiApp();

    mount(app, "showcase");

    const sliced = entityOf(app, "sliced");
    const before = app.world.projection.restOf(sliced, Transform);
    const snapshot = app.ui.tree();

    app.world.ecs.tag(sliced, PointerOver);
    app.time.step(16);

    const rest = app.world.projection.restOf(sliced, Transform);

    expect(rest?.y).toBe((before?.y ?? 0) - 6);
    expect(rest?.scale).toBe(1.05);
    expect(app.world.ecs.get(sliced, Transform)).toEqual(rest);
    expect(nodeOf(app.ui.tree(), "sliced")?.rect).toEqual(nodeOf(snapshot, "sliced")?.rect);

    await app.stop();
  });

  it("plays the change motion of the element when the rest pose moves", async () => {
    const app = await startUiApp();

    mount(app, "showcase");

    const bouncy = entityOf(app, "bouncy");

    for (let frame = 0; frame < 40; frame += 1) app.time.step(16);

    expect(app.world.ecs.get(bouncy, Transform)?.scale).toBe(1);

    app.world.ecs.tag(bouncy, PointerOver);
    app.time.step(16);

    expect(app.world.projection.restOf(bouncy, Transform)?.scale).toBe(1.2);
    expect(app.world.ecs.get(bouncy, Transform)?.scale).toBeLessThan(1.2);

    for (let frame = 0; frame < 40; frame += 1) app.time.step(16);

    expect(app.world.ecs.get(bouncy, Transform)?.scale).toBe(1.2);

    await app.stop();
  });
});

/**
 * Where the board of the fitted screen must land, read off the slot the solve gave: centred in
 * the slot's content box, at its own size, with the scale that fits it. Yoga rounds a rect to
 * whole units, so the slot is read, never recomputed from the viewport.
 *
 * @param app - What `startUiApp` returned, solved on some viewport.
 * @returns The rect of the slot, the natural rect of the board and its fit scale.
 */
function expectedBoard(app: App) {
  const slot = app.world.ecs.get(entityOf(app, "slot"), Box) ?? { x: 0, y: 0, w: 0, h: 0 };
  const content = {
    x: slot.x + fitBars.padding,
    y: slot.y + fitBars.padding,
    w: slot.w - 2 * fitBars.padding,
    h: slot.h - 2 * fitBars.padding
  };
  const fit = Math.min(1, content.w / 970, content.h / 970);

  return {
    slot,
    fit,
    board: {
      x: content.x + (content.w - 970) / 2,
      y: content.y + (content.h - 970) / 2,
      w: 970,
      h: 970
    }
  };
}

describe("fit contain", () => {
  it("scales the board down to the slot of an SE and centres it", async () => {
    const app = await startUiApp();

    mount(app, "fitted");
    useViewport(app, SE);

    const board = entityOf(app, "board");
    const expected = expectedBoard(app);
    const box = app.world.ecs.get(board, Box) ?? { x: 0, y: 0, w: 0, h: 0 };

    // The slot takes what the bars leave of the SE's height, to the unit Yoga rounds to.
    expect(Math.abs(expected.slot.h - (SE.height - fitBars.top - fitBars.bottom))).toBeLessThan(1);
    expect(expected.fit).toBeLessThan(1);
    expect(box.x).toBeCloseTo(expected.board.x, 5);
    expect(box.y).toBeCloseTo(expected.board.y, 5);
    expect(box.w).toBe(970);

    const rest = app.world.projection.restOf(board, Transform);

    expect(rest?.scale).toBeCloseTo(expected.fit, 5);
    expect(rest?.pivot).toEqual({ x: 485, y: 485 });
    // The centre of the board sits on the centre of the slot's content box.
    expect(rest?.x).toBeCloseTo(expected.slot.w / 2, 5);
    expect(rest?.y).toBeCloseTo(expected.slot.h / 2, 5);
    expect(app.world.ecs.get(board, Transform)).toEqual(rest);

    // The slot's own rectangle follows its new rect.
    expect(app.world.ecs.get(entityOf(app, "slot"), Shape)?.h).toBeCloseTo(expected.slot.h, 5);

    await app.stop();
  });

  it("keeps the board at its own size on a Pixel, where the slot is tall enough", async () => {
    const app = await startUiApp();

    mount(app, "fitted");
    useViewport(app, PIXEL);

    const board = entityOf(app, "board");
    const expected = expectedBoard(app);

    expect(Math.abs(expected.slot.h - (PIXEL.height - fitBars.top - fitBars.bottom))).toBeLessThan(
      1
    );
    expect(expected.fit).toBe(1);
    expect(app.world.ecs.get(board, Box)?.y).toBeCloseTo(expected.board.y, 5);
    expect(app.world.projection.restOf(board, Transform)?.scale).toBe(1);

    await app.stop();
  });

  it("keeps the children in natural space and reports the fit scale in the snapshot", async () => {
    const app = await startUiApp();

    mount(app, "fitted");
    useViewport(app, SE);

    const expected = expectedBoard(app);
    const board = nodeOf(app.ui.tree(), "board");
    const cell = nodeOf(app.ui.tree(), "cell");

    expect(board?.fitScale).toBeCloseTo(expected.fit, 5);
    expect(board?.rect.w).toBe(970);
    expect(cell?.rect.w).toBe(140);
    expect(cell?.rect.x).toBeCloseTo(expected.board.x + 100, 5);
    expect(cell).not.toHaveProperty("fitScale");

    await app.stop();
  });
});

describe("lint under a fitted ancestor", () => {
  it("reports a tap target that the fit scale shrinks under the minimum on an SE", async () => {
    const app = await startUiApp();

    mount(app, "fitted");
    useViewport(app, SE);

    const expected = expectedBoard(app);
    const side = Math.round(140 * expected.fit * SE.scale);

    // 140 u is 48.6 pt on an SE: large enough on its own, too small at the fit scale.
    expect(140 * SE.scale).toBeGreaterThan(44);
    expect(app.ui.lint().filter(finding => finding.key === "cell")).toEqual([
      { rule: "tap-target", key: "cell", detail: `${side} x ${side} pt` }
    ]);

    useViewport(app, PIXEL);

    expect(app.ui.lint().filter(finding => finding.key === "cell")).toEqual([]);

    await app.stop();
  });
});

describe("the guide hole over a fitted button", () => {
  it("cuts the hole where the button is drawn, not where its natural rect is", async () => {
    const app = await startUiApp();

    mount(app, "fitted");
    useViewport(app, SE);

    const expected = expectedBoard(app);
    const centre = { x: expected.board.x + 485, y: expected.board.y + 485 };
    const hole = {
      x: centre.x + expected.fit * (expected.board.x + 100 - centre.x),
      y: centre.y + expected.fit * (expected.board.y + 100 - centre.y),
      w: 140 * expected.fit,
      h: 140 * expected.fit
    };

    expect(app.flow.gate.answer({ intent: "teachFit" })).toBe(true);
    await tick();
    app.time.step(16);

    const dims = [...app.world.ecs.query(Shape, Transform)]
      .filter(([, shape]) => shape.alpha === 0.6)
      .map(([, shape, transform]) => ({ x: transform.x, y: transform.y, w: shape.w, h: shape.h }));
    const left = dims.find(dim => dim.x === 0 && dim.y > 0 && dim.w < SE.width);

    expect(dims).toHaveLength(4);
    expect(left?.y).toBeCloseTo(hole.y, 5);
    expect(left?.w).toBeCloseTo(hole.x, 5);
    expect(left?.h).toBeCloseTo(hole.h, 5);

    expect(app.flow.gate.answer({ intent: "ok" })).toBe(true);
    await tick();

    await app.stop();
  });
});

describe("a keyframed motion on an element with a pivot above its box", () => {
  it("mounts, starts on the first key and walks to the rest pose around the pivot", async () => {
    const app = await startUiApp();

    mount(app, "keyframed");

    const board = entityOf(app, "swinging");
    const rest = app.world.projection.restOf(board, Transform);
    const box = app.world.ecs.get(board, Box);

    // The pivot hangs half the height above the top edge; the position compensates.
    expect(rest?.pivot).toEqual({ x: 300, y: -200 });
    expect(rest?.y).toBe((box?.y ?? 0) - 200);

    // Two frames into the 1000 ms walk: still high above the rest and small.
    const early = app.world.ecs.get(board, Transform);

    expect(early?.y).toBeLessThan((rest?.y ?? 0) - swingDrop / 2);
    expect(early?.scale).toBeLessThan(1);

    for (let frame = 0; frame < 80; frame += 1) app.time.step(16);

    expect(app.world.ecs.get(board, Transform)).toEqual(rest);

    await app.stop();
  });

  it("outlines the slices of an element whose style asks for debug", async () => {
    const app = await startUiApp();

    mount(app, "keyframed");

    expect(app.world.ecs.get(entityOf(app, "outlined"), NineSlice)).toMatchObject({
      texture: "ui.card",
      debug: true
    });

    await app.stop();
  });
});
