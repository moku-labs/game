import { afterEach, describe, expect, it, vi } from "vitest";
import { OverlayLevel } from "../../../renderer/components";
import type { ViewportSize } from "../../../renderer/viewport/types";
import type { Time } from "../../../time/types";
import { Tree } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Box, ScrollState } from "../../components";
import type { Element, UiNode } from "../../jsx/types";
import type * as ScrollModule from "../../layout/scroll";
import type { ElementLookup, LayoutState } from "../../layout/types";
import type { UiCtx } from "../../types";
import { rounded } from "../parts-app";
import {
  heldTrees,
  markedIn,
  seen,
  startWarm,
  untilWarm,
  type Warm,
  type WarmOptions
} from "../warm-app";

// ---------------------------------------------------------------------------
// Unit: a window held warm (spec 33, slice B+D), ui's side. The world keeps the view of a closed
// sheet built aside and held; ui builds its root in parts, keeps it out of the screen's readers and
// of `world`'s keys, keeps its enters, scrolls and overlay still, and shows it whole in the frame it
// opens. At rest the held roots cost no walk. A headless app warms nothing. The oracle of every open
// is the same sheet opened in a headless app, where nothing is warm and the open mounts in one block.
// ---------------------------------------------------------------------------

/** The keys of the scrolls the frame step was handed, one entry per scroll and frame. */
const stepped = vi.hoisted(() => ({ keys: [] as Array<string | undefined> }));

// The reconcile hands the frame step of the scrolls the containers it moves and ranges: the spy
// notes their keys and calls the real step.
vi.mock("../../layout/scroll", async importOriginal => {
  const actual = await importOriginal<typeof ScrollModule>();

  return {
    ...actual,
    stepScroll: (
      ctx: UiCtx,
      state: LayoutState,
      containers: readonly Element[],
      lookup: ElementLookup,
      time: Readonly<Time>
    ): void => {
      for (const container of containers) stepped.keys.push(container.key);
      actual.stepScroll(ctx, state, containers, lookup, time);
    }
  };
});

const started: Warm[] = [];

afterEach(async () => {
  for (const warm of started.splice(0)) await warm.app.stop();

  vi.restoreAllMocks();
});

/**
 * Starts a fixture and stops it after the test.
 *
 * @param options - The clock step and whether the renderer draws.
 * @returns The started fixture.
 */
async function start(options: WarmOptions = {}): Promise<Warm> {
  const warm = await startWarm(options);

  started.push(warm);

  return warm;
}

/** A taller phone: the rows of the big sheet, centered in its height, move 240 u down. */
const TALL: ViewportSize = {
  width: 1080,
  height: 2400,
  scale: 0.36,
  orientation: "portrait",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
};

/**
 * Gives the app another viewport, as a turned or resized window does.
 *
 * @param warm - The started fixture.
 * @param size - The new viewport.
 */
function resize(warm: Warm, size: ViewportSize): void {
  vi.spyOn(warm.app.renderer.viewport, "size").mockReturnValue(size);
}

/**
 * The sheet opened in a headless app, where nothing is warm: the open mounts it in one block.
 *
 * @param sheet - The sheet's projection.
 * @param intent - The intent that opens it.
 * @param size - The viewport, the default one unless given.
 * @returns The snapshot of the screen three frames after the open.
 */
async function oneBlock(sheet: string, intent: string, size?: ViewportSize): Promise<UiNode> {
  const warm = await start({ drawing: false });

  if (size !== undefined) resize(warm, size);

  warm.mount([sheet]);
  warm.frame();
  await warm.answer(intent);

  for (let index = 0; index < 3; index += 1) warm.frame();

  return warm.app.ui.tree();
}

/**
 * Every key of a snapshot, all the way down.
 *
 * @param node - The snapshot node.
 * @returns The keys.
 */
function keysOf(node: UiNode): string[] {
  return [node.key ?? "", ...node.children.flatMap(child => keysOf(child))];
}

/**
 * The keys of the screen whose element carries no `Box` yet: made, but not applied.
 *
 * @param warm - The started fixture.
 * @returns The keys.
 */
function unboxed(warm: Warm): string[] {
  // The top of a screen of two roots is the snapshot's own node: it has no key and no entity.
  return keysOf(warm.app.ui.tree()).filter(key => {
    // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
    const entity = warm.app.ui.find(key);

    return key !== "" && warm.app.world.ecs.get(entity ?? 0, Box) === undefined;
  });
}

/**
 * The key of the element the keyboard focused.
 *
 * @param warm - The started fixture.
 * @returns The key, or `undefined` when nothing on the screen is focused.
 */
function focused(warm: Warm): string | undefined {
  const flat = (node: UiNode): UiNode[] => [node, ...node.children.flatMap(child => flat(child))];

  return flat(warm.app.ui.tree()).find(node => node.state.focus)?.key;
}

/**
 * Records the frame every element of a held root was made in: `ui` marks each one as the held
 * view's right after its spawn.
 *
 * @param warm - The started fixture.
 * @returns The frames by entity, and the frame being stepped, which the test moves on.
 */
function recordMade(warm: Warm) {
  const made = new Map<Entity, number>();
  const clock = { frame: 0 };
  const adopt = warm.app.world.projection.adopt;

  vi.spyOn(warm.app.world.projection, "adopt").mockImplementation(entity => {
    made.set(entity, clock.frame);
    adopt(entity);
  });

  return { made, clock };
}

describe("a window held warm", () => {
  // Bug: `entityOf` answers for a button of a closed window nobody sees; or it answers nothing after
  // the open.
  it("is out of find, tree and focus, and answers no key, until the frame it opens", async () => {
    const warm = await start();

    warm.mount(["warm.sheet"]);
    untilWarm(warm, 1);

    expect(warm.app.ui.find("buy")).toBeUndefined();
    expect(keysOf(warm.app.ui.tree())).not.toContain("buy");
    expect(warm.app.world.projection.entityOf("warm.sheet", "buy")).toBeUndefined();
    expect(warm.app.world.projection.entityOf("warm.sheet", "sheetRoot")).toBeUndefined();
    expect(warm.app.input.pressKey("Tab")).toBe(true);
    expect(focused(warm)).toBe("wardPlay");
    expect(seen.enters).toEqual([]);

    await warm.answer("openSheet");
    warm.frame();

    // The frame of the open: the held enters played, and `world` knows every key.
    const buy = warm.app.ui.find("buy");

    expect(buy).toBeDefined();
    expect(warm.app.world.projection.entityOf("warm.sheet", "buy")).toBe(buy);
    expect(warm.app.world.projection.entityOf("warm.sheet", "d19_3b")).toBe(
      warm.app.ui.find("d19_3b")
    );
    expect(seen.enters).toEqual(["sheetRoot", "buy"]);
  });

  // Bug: the held root is made whole in the frame the world spawns it: a long frame while the scene
  // rests; or the parts end in another screen than a window opened in one block.
  it("is made in parts over several frames and opens as one block", async () => {
    const block = rounded(await oneBlock("warm.sheet", "openSheet"));
    const warm = await start({ stepMs: 1 });
    const { made, clock } = recordMade(warm);
    const rests = (): boolean => warm.app.world.projection.left() === Number.POSITIVE_INFINITY;

    warm.mount(["warm.sheet"]);

    while (heldTrees(warm).length === 0 || !rests()) {
      clock.frame += 1;
      if (clock.frame > 200) throw new Error("the sheet was not held in 200 frames");
      warm.frame();
    }

    // Every element of the sheet, the held view's root entity aside, over three frames at least.
    expect(made.size).toBe(262);
    expect(new Set(made.values()).size).toBeGreaterThanOrEqual(3);
    expect(warm.app.ui.tree().key).toBe("wardRoot");

    await warm.answer("openSheet");

    for (let index = 0; index < 3; index += 1) warm.frame();

    expect(rounded(warm.app.ui.tree())).toEqual(block);
  });
});

describe("a window opened before it was built whole", () => {
  // Bug: a window opened while parts of its root still wait shows half built for frames: its
  // parked children come under the budget of the next window the world starts warming in the same
  // frame, or the rest of its application 100 elements a frame.
  it.each([
    { what: "children parked", stepMs: 1 },
    { what: "its application open", stepMs: 0 }
  ])("is drawn whole in the frame it opens, with $what", async ({ stepMs }) => {
    const block = rounded(await oneBlock("warm.sheet", "openSheet"));
    const warm = await start({ stepMs });
    const built = warm.checks.find(check => check.name === "asideBuilt");

    // The list is warmed after the sheet: the frame the sheet opens starts it.
    warm.mount(["warm.sheet", "warm.list"]);
    warm.frame();

    while (heldTrees(warm).length === 0) warm.frame();

    // Held, and ui's part of it not done: parts wait.
    expect(built?.()).toBe(false);

    await warm.answer("openSheet");
    warm.frame();

    expect(rounded(warm.app.ui.tree())).toEqual(block);
    expect(unboxed(warm)).toEqual([]);
    expect(warm.app.world.projection.entityOf("warm.sheet", "d19_3b")).toBe(
      warm.app.ui.find("d19_3b")
    );
    expect(seen.enters).toEqual(["sheetRoot", "buy"]);
  });
});

describe("a window held warm while the viewport changes", () => {
  // Bug: a held root keeps the layout of the old viewport and shows it at the open; or, opened
  // while its application was open, its rows applied before take their new rects with a `change`
  // motion in the frame they are first drawn.
  it.each([
    { what: "at rest", rests: true },
    { what: "while it is applied in parts", rests: false }
  ])("opens laid out for the new one, with no change motion, $what", async ({ rests }) => {
    const block = rounded(await oneBlock("warm.sheet", "openSheet", TALL));
    const warm = await start();

    warm.mount(["warm.sheet"]);

    if (rests) untilWarm(warm, 1);
    else while (heldTrees(warm).length === 0) warm.frame();

    resize(warm, TALL);
    warm.frame();

    expect(warm.app.ui.tree().key).toBe("wardRoot");

    await warm.answer("openSheet");

    for (let index = 0; index < 3; index += 1) warm.frame();

    expect(seen.changes).toBe(0);
    expect(seen.enters).toEqual(["sheetRoot", "buy"]);
    expect(rounded(warm.app.ui.tree())).toEqual(block);
  });
});

describe("a scroll of a window held warm", () => {
  // Bug: a held scroll glides to a new `offset` prop frame by frame while nobody sees it, waking
  // the loop, and is seen gliding at the open.
  it("stands at a new offset at once and does not move, held or at the open", async () => {
    const warm = await start();
    const shelf = (): Readonly<{ offset: number; moving: boolean }> | undefined =>
      warm.app.world.ecs.get(markedIn(warm, "shelf") ?? 0, ScrollState);

    warm.mount(["warm.list"]);
    untilWarm(warm, 1);

    expect(shelf()).toMatchObject({ offset: 40, moving: false });

    // The warm item changes: the world writes the new offset into the held view.
    await warm.answer("scroll");

    const stood: Array<Readonly<{ offset: number; moving: boolean }> | undefined> = [];

    for (let index = 0; index < 4; index += 1) {
      warm.frame();
      stood.push(shelf());
    }

    expect(heldTrees(warm)).toHaveLength(1);
    expect(stood.slice(1)).toEqual([
      { offset: 160, max: 600, moving: false },
      { offset: 160, max: 600, moving: false },
      { offset: 160, max: 600, moving: false }
    ]);

    await warm.answer("openList");

    for (let index = 0; index < 3; index += 1) {
      warm.frame();
      expect(shelf()).toMatchObject({ offset: 160, moving: false });
    }
  });
});

describe("a windowed list of a window held warm", () => {
  // Bug: a row the list ranges in after the world stopped marking the sheet's work is taken for a
  // row on the screen: its loop starts, or a later change of the sheet plays its `change` motion,
  // while nobody sees it.
  it("keeps the rows it ranged in after the build held until the open", async () => {
    const warm = await start();

    warm.mount(["warm.rows"]);
    untilWarm(warm, 1);

    for (let index = 0; index < 3; index += 1) warm.frame();

    // Ranged in once the list stood at its offset, after the world was done with the sheet.
    const late = markedIn(warm, "w15") ?? 0;

    expect(warm.app.world.ecs.ownerOf(late)).toBeDefined();
    // `world` holds it with the closed window: no game code reaches it by key.
    expect(warm.app.world.projection.isBuilding(late)).toBe(true);
    expect(warm.app.world.projection.entityOf("warm.rows", "w15")).toBeUndefined();

    // The warm item changes: every row is wider, so it moves.
    await warm.answer("coin");

    for (let index = 0; index < 4; index += 1) warm.frame();

    expect(seen).toMatchObject({ loops: 0, changes: 0 });

    await warm.answer("openRows");
    warm.frame();

    expect(seen.loops).toBe(10);
    expect(seen.changes).toBe(0);
  });
});

describe("an overlay of a window held warm", () => {
  // Bug: the overlay of a closed sheet starts its level or lands while it is held, so the screen
  // under it is dimmed or covered by a window nobody opened.
  it("keeps its level at 0 and does not land until the open", async () => {
    const warm = await start();
    const level = () => warm.app.world.ecs.get(markedIn(warm, "dim") ?? 0, OverlayLevel);

    warm.mount(["warm.dim"]);
    untilWarm(warm, 1);

    for (let index = 0; index < 5; index += 1) warm.frame();

    expect(level()).toEqual({ level: 0, landed: false });

    await warm.answer("openDim");

    for (let index = 0; index < 2; index += 1) warm.frame();

    expect(level()).toEqual({ level: 1, landed: true });
  });
});

describe("windows held warm at rest", () => {
  // Bug: every frame at rest walks the held roots and the queue of their held enters, a lookup in
  // the world per held element (some 600 a frame for a resting shop); or the frame step moves and
  // ranges the scrolls of the held windows.
  it("ask the world about no held element and step none of their scrolls in a frame", async () => {
    const warm = await start();

    warm.mount(["warm.sheet", "warm.list"]);
    untilWarm(warm, 2);
    warm.frame();

    const isBuilding = vi.spyOn(warm.app.world.projection, "isBuilding");

    stepped.keys.length = 0;

    for (let index = 0; index < 5; index += 1) warm.frame();

    expect(isBuilding).not.toHaveBeenCalled();
    expect(stepped.keys).toEqual([]);

    // Open, the shelf is stepped with every frame.
    await warm.answer("openList");
    warm.frame();

    expect(stepped.keys).toContain("shelf");
  });
});

describe("a headless app", () => {
  // Bug: ui registers its part of a build without a renderer that draws, so the world builds and
  // holds warm windows nobody can ever see: memory and frames for nothing.
  it("builds no warm window, and the sheet still opens", async () => {
    const warm = await start({ drawing: false });

    warm.mount(["warm.sheet"]);

    for (let index = 0; index < 20; index += 1) warm.frame();

    expect(warm.checks.map(check => check.name)).not.toContain("asideBuilt");
    expect(heldTrees(warm)).toEqual([]);
    // The ward's root alone: the world spawned no view of the closed sheet.
    expect([...warm.app.world.ecs.query(Tree)]).toHaveLength(1);

    await warm.answer("openSheet");
    warm.frame();

    expect(warm.app.ui.find("buy")).toBeDefined();
  });
});
