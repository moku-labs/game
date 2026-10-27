import { describe, expect, it, vi } from "vitest";
import { createModules } from "../../api";
import { Order, Tree } from "../../ecs/define";
import type { Entity } from "../../ecs/types";
import { clearWorld, withDeps } from "../../lifecycle";
import { projection } from "../../projection/define";
import type {
  AnyProjectionSpec,
  DescriptionNode,
  LayerSpec,
  ProjectionMotion,
  ViewHandle,
  WarmRecord
} from "../../projection/types";
import { Level, MOUNT_OWNER, settleFrames, Transform } from "./board";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test (spec 33, slice B+D): warm windows. A mounted projection that declares `warm` keeps the
// view of that item built aside and held hidden while `from` does not show its key; the open shows the
// same entity at once, the close plays the exit and the record is built again in idle frames.
// `isBuilding`, `left` and `adopt` answer for the held view as for a scene built aside.
// ---------------------------------------------------------------------------

/** The layers of the scene: one `ui` layer sorted by order. */
const LAYERS: readonly LayerSpec[] = [{ name: "ui", sort: "order" }];

/** The sheet projection under test. */
const SHEET = "settings.sheet";

/** A second warm window, for the cases of two records. */
const SHOP = "shop.sheet";

/** One item of a sheet: its key, the page it shows and the coins it prints. */
type Sheet = { id: string; page: string; coins: number };

/** The player root: the coins, and the key the warm item of the sheet takes. */
type Player = { coins: number; warmId?: string };

/** The session root: the sheet open, on a page. */
type Session = { sheet?: { page: string } };

/** What a case changes about the sheet projection. */
type SheetOptions = {
  name?: string;
  motion?: ProjectionMotion<Sheet>;
  view?: (sheet: Sheet) => DescriptionNode;
  warm?: (player: Player, session: Session) => Sheet;
};

/**
 * The description node of a sheet: its page and its coins as props.
 *
 * @param sheet - The sheet item.
 * @returns The node.
 */
function sheetView(sheet: Sheet): DescriptionNode {
  return { type: "sheet", props: { page: sheet.page, coins: sheet.coins }, children: [] };
}

/**
 * The warm item of a sheet: its main page, with the player's coins.
 *
 * @param player - The player root.
 * @returns The item.
 */
function mainPage(player: Player): Sheet {
  return { id: player.warmId ?? "settings", page: "main", coins: player.coins };
}

/**
 * A sheet projection: shown while `session.sheet` is set, warm on its main page.
 *
 * @param options - What the case changes.
 * @returns The spec.
 */
function sheetSpec(options: SheetOptions = {}): AnyProjectionSpec {
  return projection({
    name: options.name ?? SHEET,
    layer: "ui",
    from: (player: Player, session: Session): Sheet[] =>
      session.sheet === undefined
        ? []
        : [{ id: "settings", page: session.sheet.page, coins: player.coins }],
    key: (sheet: Sheet) => sheet.id,
    view: options.view ?? sheetView,
    warm: options.warm ?? mainPage,
    ...(options.motion === undefined ? {} : { motion: options.motion })
  }) as AnyProjectionSpec;
}

/** The board the sheet opens over: a screen always shown. */
const board = projection({
  name: "board",
  layer: "ui",
  from: (player: Player) => player,
  view: (player: Player): DescriptionNode => ({
    type: "board",
    props: { coins: player.coins },
    children: []
  })
}) as AnyProjectionSpec;

/** A world showing the board, with the sheet projections mounted closed. */
type Warm = { world: MockWorld; parts: { done: boolean } };

/**
 * A started world showing the board, the sheets mounted closed and a drawing plugin's `onBuild` check
 * registered, which answers `parts.done`.
 *
 * @param specs - The sheet projections, mounted after the board in this order.
 * @param options - Whether a drawing plugin registered its check, and the session at the mount.
 * @param options.drawing - False for a world with no `onBuild` check.
 * @param options.session - The session the world starts with.
 * @returns The world and the switch of its check.
 */
function sheetWorld(
  specs: readonly AnyProjectionSpec[] = [sheetSpec()],
  options: { drawing?: boolean; session?: Session } = {}
): Warm {
  const world = createMockWorld();
  const parts = { done: true };

  world.model.player = { coins: 5 };
  world.model.session = options.session ?? {};
  world.api.projection.setLayers(LAYERS);
  world.api.projection.register(board);
  for (const spec of specs) world.api.projection.register(spec);
  world.start();
  if (options.drawing !== false) world.api.projection.onBuild(() => parts.done);
  world.api.projection.mount(["board", ...specs.map(spec => spec.name)], MOUNT_OWNER);

  return { world, parts };
}

/**
 * The warm record of a projection.
 *
 * @param world - The world.
 * @param name - The projection.
 * @returns The record, or `undefined` for a projection with none.
 */
function recordOf(world: MockWorld, name = SHEET): WarmRecord | undefined {
  return world.ctx.state.projection.warm.get(name);
}

/**
 * The entity a warm record holds, or 0 when it holds none.
 *
 * @param world - The world.
 * @param name - The projection.
 * @returns The entity of its view.
 */
function heldOf(world: MockWorld, name = SHEET): Entity {
  return recordOf(world, name)?.view?.entity ?? 0;
}

/**
 * The props of the description node an entity carries.
 *
 * @param world - The world.
 * @param entity - The entity.
 * @returns The props, or `undefined`.
 */
function propsOf(world: MockWorld, entity: Entity): object | undefined {
  return world.api.ecs.get(entity, Tree)?.node.props;
}

/**
 * Commits a session and runs the frame that reconciles it.
 *
 * @param world - The world.
 * @param session - The new session.
 */
function commitSession(world: MockWorld, session: Session): void {
  world.model.session = session;
  world.commit("edge", ["session"]);
  world.frame(16);
}

/**
 * Commits a player root and runs the frame that reconciles it.
 *
 * @param world - The world.
 * @param player - The new player root.
 */
function commitPlayer(world: MockWorld, player: Player): void {
  world.model.player = player;
  world.commit("edge", ["player"]);
  world.frame(16);
}

/**
 * Runs the two frames that make a warm view ready with a check that passes: the spawn, then the poll.
 *
 * @param world - The world.
 * @param name - The projection.
 * @returns The held entity.
 */
function warmUp(world: MockWorld, name = SHEET): Entity {
  world.frame(16);
  world.frame(16);

  return heldOf(world, name);
}

/**
 * Records the cause every screen root leaves with, as ui's `Tree` removal hook reads it.
 *
 * @param world - The world.
 * @returns The causes, by entity, in removal order.
 */
function removalCauses(world: MockWorld): Array<[Entity, string | undefined]> {
  const causes: Array<[Entity, string | undefined]> = [];

  world.api.ecs.onRemoved(Tree, entity => {
    causes.push([entity, world.api.projection.causeOf(entity)]);
  });

  return causes;
}

/**
 * Spawns an entity the way `ui` spawns an element and marks it with `adopt`.
 *
 * @param world - The world.
 * @returns The element.
 */
function adoptElement(world: MockWorld): Entity {
  const element = world.api.ecs.spawn({ kind: "plugin", name: "ui" }, []);

  world.api.projection.adopt(element);

  return element;
}

describe("warm: the held view", () => {
  // Bug: a closed window is never built ahead (the open builds it in the first frame), or a held view is spawned
  // again on every frame of the rest.
  it("spawns one held view of the warm item in the frame after the mount, and nothing more while it rests", () => {
    const { world } = sheetWorld();
    const before = world.api.ecs.count();

    world.frame(16);

    const held = heldOf(world);

    expect(world.api.ecs.count()).toBe(before + 1);
    expect(propsOf(world, held)).toEqual({ page: "main", coins: 5 });
    // The sheet's place in the scene's list: board -2, sheet -1.
    expect(world.api.ecs.get(held, Order)?.value).toBe(-1);
    expect(world.wake).toHaveBeenCalledTimes(1);

    world.frame(16);
    world.frame(16);
    world.frame(16);

    expect(world.api.ecs.count()).toBe(before + 1);
    expect(heldOf(world)).toBe(held);
    expect(world.wake).toHaveBeenCalledTimes(1);
  });

  // Bug: `input` or `guide` aim at a hidden sheet through `entityOf`, a host takes it through `entitiesOf`; or ui
  // cannot tell the held root apart in its `Tree` hook, or cannot name its projection.
  it("flags the held view before the onAdded hooks of its components; keyOf and causeOf answer, entityOf and entitiesOf do not", () => {
    const { world } = sheetWorld();
    const flagged: boolean[] = [];

    world.api.ecs.onAdded(Tree, entity => flagged.push(world.api.projection.isBuilding(entity)));
    world.frame(16);

    const held = heldOf(world);

    expect(flagged).toEqual([true]);
    expect(world.api.projection.isBuilding(held)).toBe(true);
    expect(world.api.projection.keyOf(held)).toEqual({ projection: SHEET, key: "settings" });
    expect(world.api.projection.causeOf(held)).toBe("change");
    expect(world.api.projection.entityOf(SHEET, "settings")).toBeUndefined();
    expect(world.api.projection.entitiesOf(SHEET)).toEqual([]);
  });

  // Bug: the held view is built with no budget, so ui builds the whole sheet in one frame (the long frame of the
  // open, moved to the rest); or `left()` stays finite at rest, so ui and the renderer work on every frame.
  it("counts a third of the frame interval while the held view builds, and Infinity once every check passes", () => {
    const { world, parts } = sheetWorld();

    parts.done = false;

    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);

    world.frame(16);
    world.clock.advance(2);

    expect(world.api.projection.left()).toBeCloseTo(1000 / 60 / 3 - 2, 6);

    world.frame(16);

    expect(world.api.projection.left()).toBeCloseTo(1000 / 60 / 3, 6);

    parts.done = true;
    world.frame(16);

    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
    expect(world.api.projection.isBuilding(heldOf(world))).toBe(true);
  });

  // Bug: the budget ignores the loop's rate: at 120 fps a warm frame takes 11 ms of an 8.3 ms frame; or a loop with
  // no rate yet (0) gives an infinite budget, and ui builds the whole sheet in one frame.
  it("reads the budget from the frame rate the loop runs at, a third of 60 Hz without a rate", () => {
    const fast = sheetWorld().world;
    const unknown = sheetWorld().world;

    fast.rate.fps = 120;
    fast.frame(16);
    unknown.rate.fps = 0;
    unknown.frame(16);

    expect(fast.api.projection.left()).toBeCloseTo(1000 / 120 / 3, 6);
    expect(unknown.api.projection.left()).toBeCloseTo(1000 / 60 / 3, 6);
  });

  // Bug: every window is built in one frame (the long frame slice B+D removes), or a second record starts while the
  // first one still builds.
  it("takes one step a frame: the poll of the record in work is the step, the next record waits a frame", () => {
    const { world } = sheetWorld([sheetSpec(), sheetSpec({ name: SHOP })]);
    const before = world.api.ecs.count();

    world.frame(16);

    expect(world.api.ecs.count()).toBe(before + 1);
    expect(heldOf(world, SHOP)).toBe(0);

    world.frame(16);

    expect(world.api.ecs.count()).toBe(before + 1);

    world.frame(16);

    expect(world.api.ecs.count()).toBe(before + 2);
    expect(heldOf(world, SHOP)).not.toBe(0);
  });

  // Bug: the elements ui spawns for a held root are live: drawn and hit while the sheet is closed; or an element
  // spawned at rest is taken for a held one.
  it("marks what adopt names for the record in work, and nothing once it is ready", () => {
    const { world, parts } = sheetWorld();

    parts.done = false;
    world.frame(16);

    const element = adoptElement(world);

    expect(world.api.projection.isBuilding(element)).toBe(true);

    parts.done = true;
    world.frame(16);

    const late = adoptElement(world);

    expect(world.api.projection.isBuilding(late)).toBe(false);
    expect(world.api.projection.isBuilding(element)).toBe(true);
  });

  // Bug: a row a windowed list of a closed window ranges in after its view is ready is live: `entityOf` answers for
  // it, so `input` or `guide` reach a button of a window that is not on the screen, and the renderer draws it.
  it("holds an element whose key is registered for a closed window after its view is ready, until the open", () => {
    const { world } = sheetWorld();

    warmUp(world);

    const row = adoptElement(world);

    world.api.projection.registerKey(SHEET, "w15", row);

    expect(world.api.projection.isBuilding(row)).toBe(true);
    expect(world.api.projection.entityOf(SHEET, "w15")).toBeUndefined();

    commitSession(world, { sheet: { page: "main" } });

    expect(world.api.projection.isBuilding(row)).toBe(false);
    expect(world.api.projection.entityOf(SHEET, "w15")).toBe(row);
  });

  // Bug: an element of a window on the screen is taken for one of the view its projection holds for another key:
  // a button the player sees answers no `entityOf`.
  it("holds no element registered for a projection that shows a view live", () => {
    const { world } = sheetWorld([sheetSpec()], { session: { sheet: { page: "main" } } });

    commitPlayer(world, { coins: 5, warmId: "about" });
    world.frame(16);

    expect(recordOf(world)?.phase).toBe("ready");

    const button = world.api.ecs.spawn({ kind: "plugin", name: "ui" }, []);

    world.api.projection.registerKey(SHEET, "close", button);

    expect(world.api.projection.isBuilding(button)).toBe(false);
    expect(world.api.projection.entityOf(SHEET, "close")).toBe(button);
  });

  // Bug: a hidden copy of a window that is open is built beside it (two roots, twice the memory).
  it("skips a key from shows, and warms it after the close", () => {
    const { world } = sheetWorld([sheetSpec()], { session: { sheet: { page: "main" } } });
    const shown = world.api.projection.entityOf(SHEET, "settings");
    const before = world.api.ecs.count();

    world.frame(16);
    world.frame(16);

    expect(world.api.ecs.count()).toBe(before);
    expect(heldOf(world)).toBe(0);

    commitSession(world, {});

    expect(world.api.ecs.ownerOf(shown ?? 0)).toBeUndefined();
    expect(heldOf(world)).not.toBe(0);
    expect(world.api.projection.isBuilding(heldOf(world))).toBe(true);
  });

  // Bug: the warm build starts in the middle of a motion and its spawn lands in an animated frame; or a loop, which
  // never ends, keeps every window cold for good.
  it("starts no work while a motion owns its fields, and never waits for a loop", () => {
    const { world } = sheetWorld();
    const owner = { kind: "plugin", name: "ui" } as const;
    const button = world.api.ecs.spawn(owner, [Transform()]);
    const handle = world.api.projection.viewOf(button, owner);

    handle?.tween(Transform, { scale: 2 }, { ms: 100, ease: "linear" });
    world.frame(16);

    expect(heldOf(world)).toBe(0);

    settleFrames(world);
    handle?.tween(Transform, { x: 4 }, { ms: 100_000, additive: true });
    world.frame(16);

    expect(heldOf(world)).not.toBe(0);
  });

  // Bug: a pulse that owns its field and repeats for good (a "tap here" ring) keeps every window cold for the whole
  // scene; or a motion that repeats a counted number of times is taken for one that never ends, and an animated frame
  // gets the warm spawn.
  it("never waits for a motion that repeats forever, and waits for one that repeats a counted number of times", () => {
    const owner = { kind: "plugin", name: "ui" } as const;
    const pulsing = (repeat: number | "forever"): MockWorld => {
      const { world } = sheetWorld();
      const ring = world.api.ecs.spawn(owner, [Transform()]);

      world.api.projection
        .viewOf(ring, owner)
        ?.tween(Transform, { scale: 1.2 }, { ms: 100, ease: "linear", repeat });
      world.frame(16);

      return world;
    };
    const counted = pulsing(3);

    expect(heldOf(pulsing("forever"))).not.toBe(0);
    expect(heldOf(counted)).toBe(0);

    settleFrames(counted);
    counted.frame(16);

    expect(heldOf(counted)).not.toBe(0);
  });

  // Bug: the frames of an animation get a warm step: the drawing plugins' checks run in them.
  it("polls no check while a motion owns its fields", () => {
    const { world, parts } = sheetWorld();
    const owner = { kind: "plugin", name: "ui" } as const;
    const button = world.api.ecs.spawn(owner, [Transform()]);
    const check = vi.fn(() => true);

    parts.done = false;
    world.frame(16);
    world.api.projection.onBuild(check);
    world.api.projection.viewOf(button, owner)?.tween(Transform, { scale: 2 }, { ms: 100 });
    parts.done = true;
    world.frame(16);

    expect(check).not.toHaveBeenCalled();
    expect(world.api.projection.left()).toBeLessThan(Number.POSITIVE_INFINITY);

    settleFrames(world);
    world.frame(16);

    expect(check).toHaveBeenCalled();
    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("warm: the open", () => {
  // Bug: the open spawns a second view (the slow path the slice removes), keeps the held one hidden, or plays no
  // enter; or the elements ui made for it stay held.
  it("shows the held entity when from brings its key: no spawn, no flag, the enter and loop hooks play once", () => {
    const enter = vi.fn(() => undefined);
    const loop = vi.fn(() => undefined);
    const { world, parts } = sheetWorld([sheetSpec({ motion: { enter, loop } })]);

    parts.done = false;
    world.frame(16);

    const element = adoptElement(world);

    parts.done = true;
    world.frame(16);

    const held = heldOf(world);
    const count = world.api.ecs.count();
    const version = world.api.projection.membershipVersion();

    commitSession(world, { sheet: { page: "main" } });

    expect(world.api.projection.entityOf(SHEET, "settings")).toBe(held);
    expect(world.api.projection.entitiesOf(SHEET)).toEqual([held]);
    expect(world.api.ecs.count()).toBe(count);
    expect(world.api.projection.isBuilding(held)).toBe(false);
    expect(world.api.projection.isBuilding(element)).toBe(false);
    expect(enter).toHaveBeenCalledTimes(1);
    expect(enter).toHaveBeenCalledWith(
      expect.objectContaining({ entity: held }),
      { id: "settings", page: "main", coins: 5 },
      undefined,
      "change"
    );
    expect(loop).toHaveBeenCalledTimes(1);
    expect(world.api.projection.causeOf(held)).toBe("change");
    expect(world.api.projection.membershipVersion()).toBeGreaterThan(version);
  });

  // Bug: the open runs `view` and writes `Tree` again for an item with the content of the warm one: ui diffs the
  // whole sheet in the open frame, the cost the warm view was built to save.
  it("runs no view and writes no Tree when the open item has the content of the warm one", () => {
    const view = vi.fn(sheetView);
    const { world } = sheetWorld([sheetSpec({ view })]);
    const held = warmUp(world);
    const node = world.api.ecs.get(held, Tree)?.node;

    expect(view).toHaveBeenCalledTimes(1);

    commitSession(world, { sheet: { page: "main" } });

    expect(view).toHaveBeenCalledTimes(1);
    expect(world.api.ecs.get(held, Tree)?.node).toBe(node);
  });

  // Bug: the open shows the warm page instead of the one asked, or plays a change motion on a window that appears.
  it("writes only the difference when the open item differs, with no change hook", () => {
    const change = vi.fn(() => undefined);
    const { world } = sheetWorld([sheetSpec({ motion: { change: { Tree: change } } })]);
    const held = warmUp(world);

    commitSession(world, { sheet: { page: "audio" } });

    expect(world.api.projection.entityOf(SHEET, "settings")).toBe(held);
    expect(propsOf(world, held)).toEqual({ page: "audio", coins: 5 });
    expect(change).not.toHaveBeenCalled();
  });

  // Bug: the open of a view made of components keeps a component the shown item no longer has, or lacks one it has.
  it("adds and removes components at the open when the shown item's view differs in its components", () => {
    const { world } = sheetWorld([
      projection({
        name: SHEET,
        layer: "ui",
        from: (_player: Player, session: Session): Sheet[] =>
          session.sheet === undefined
            ? []
            : [{ id: "settings", page: session.sheet.page, coins: 0 }],
        key: (sheet: Sheet) => sheet.id,
        view: (sheet: Sheet) =>
          sheet.page === "main" ? [Transform({ x: 1, y: 0, scale: 1 })] : [Level({ level: 3 })],
        warm: (): Sheet => ({ id: "settings", page: "main", coins: 0 })
      }) as AnyProjectionSpec
    ]);
    const held = warmUp(world);

    expect(world.api.ecs.get(held, Transform)?.x).toBe(1);

    commitSession(world, { sheet: { page: "audio" } });

    expect(world.api.projection.entityOf(SHEET, "settings")).toBe(held);
    expect(world.api.ecs.has(held, Transform)).toBe(false);
    expect(world.api.ecs.get(held, Level)?.level).toBe(3);
  });

  // Bug: a reopen during the rebuild spawns a second sheet, or ui keeps building a root that shows in parts.
  it("shows a record still in work: the budget ends and its elements are shown with it", () => {
    const { world, parts } = sheetWorld();

    parts.done = false;
    world.frame(16);

    const held = heldOf(world);
    const element = adoptElement(world);

    commitSession(world, { sheet: { page: "main" } });

    expect(world.api.projection.entityOf(SHEET, "settings")).toBe(held);
    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
    expect(world.api.projection.isBuilding(held)).toBe(false);
    expect(world.api.projection.isBuilding(element)).toBe(false);
  });

  // Bug: a fast walk (tests, agents, a restore) plays the enter of the window, or spawns a view beside the held one.
  it("shows the held view direct in a fast world: no hook, the loop owed", () => {
    const enter = vi.fn(() => undefined);
    const { world } = sheetWorld([sheetSpec({ motion: { enter } })]);
    const held = warmUp(world);

    world.flow.mode = "fast";
    world.model.session = { sheet: { page: "main" } };
    world.commit("edge", ["session"]);

    expect(world.api.projection.entityOf(SHEET, "settings")).toBe(held);
    expect(world.api.projection.causeOf(held)).toBe("mount");
    expect(enter).not.toHaveBeenCalled();
    expect(recordOf(world)?.view?.loopOwed).toBe(true);
  });
});

describe("warm: the close", () => {
  // Bug: a closed window is never warm again (the second open is slow), or it is built again while its exit plays.
  it("plays the exit as before, then builds the view again in idle frames once the exit motion ended", () => {
    const exit = vi.fn((handle: ViewHandle<Sheet>) =>
      handle.tween(Order, { value: 4 }, { ms: 100, ease: "linear" })
    );
    const { world } = sheetWorld([sheetSpec({ motion: { exit } })]);
    const held = warmUp(world);

    commitSession(world, { sheet: { page: "main" } });
    commitSession(world, {});

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: held }),
      { id: "settings", page: "main", coins: 5 },
      undefined,
      "change"
    );
    expect(heldOf(world)).toBe(0);
    expect(world.api.ecs.ownerOf(held)).toBeDefined();

    settleFrames(world);
    world.frame(16);

    const again = heldOf(world);

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(again).not.toBe(0);
    expect(again).not.toBe(held);
    expect(world.api.projection.isBuilding(again)).toBe(true);
    expect(propsOf(world, again)).toEqual({ page: "main", coins: 5 });
  });
});

describe("warm: a commit while the window rests", () => {
  // Bug: every commit re-runs the view of every warm window and ui diffs it: work in every frame after a tap.
  it("changes nothing when the warm item keeps its content", () => {
    const view = vi.fn(sheetView);
    const { world } = sheetWorld([sheetSpec({ view })]);
    const held = warmUp(world);
    const node = world.api.ecs.get(held, Tree)?.node;

    commitPlayer(world, { coins: 5 });
    world.frame(16);

    expect(view).toHaveBeenCalledTimes(1);
    expect(world.api.ecs.get(held, Tree)?.node).toBe(node);
    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
  });

  // Bug: the window opens with stale content (the coins of the warm-up), or the refresh spawns a new view.
  it("writes the difference into the held view when the warm item changes, and builds it under the budget again", () => {
    const { world, parts } = sheetWorld();
    const held = warmUp(world);

    parts.done = false;
    commitPlayer(world, { coins: 9 });

    expect(heldOf(world)).toBe(held);
    expect(propsOf(world, held)).toEqual({ page: "main", coins: 9 });
    expect(world.api.projection.left()).toBeLessThan(Number.POSITIVE_INFINITY);
    expect(world.wake).toHaveBeenCalledTimes(2);

    parts.done = true;
    world.frame(16);

    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
  });

  // Bug: the held sets keep the ids of the rows a refresh took away: a window held through a long session grows them
  // with every refresh.
  it("forgets the elements of a held view that were despawned, in the next frame", () => {
    const { world, parts } = sheetWorld();

    parts.done = false;
    world.frame(16);

    const first = adoptElement(world);
    const second = adoptElement(world);
    const third = adoptElement(world);

    parts.done = true;
    world.frame(16);
    parts.done = false;
    commitPlayer(world, { coins: 9 });
    // ui takes away the rows the patched sheet no longer has.
    world.api.ecs.despawn(first);
    world.api.ecs.despawn(second);
    world.frame(16);

    const record = recordOf(world);
    const kept = [...world.ctx.state.projection.warmHeld, ...(record?.entities ?? [])];

    expect(kept.filter(entity => world.api.ecs.ownerOf(entity) === undefined)).toEqual([]);
    expect(record?.entities.has(third)).toBe(true);
    expect(world.api.projection.isBuilding(third)).toBe(true);
  });

  // Bug: the view of the old key stays held for good (memory), or the new key is never warmed.
  it("drops the held view and builds the other key when the warm key changes", () => {
    const { world } = sheetWorld();
    const held = warmUp(world);
    const causes = removalCauses(world);

    commitPlayer(world, { coins: 5, warmId: "about" });

    const again = heldOf(world);

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(causes).toEqual([[held, "discard"]]);
    expect(again).not.toBe(held);
    expect(world.api.projection.keyOf(again)).toEqual({ projection: SHEET, key: "about" });
    expect(world.api.projection.isBuilding(again)).toBe(true);
  });

  // Bug: after a new locale (a forced rerun) the window opens with the old words: its item did not change.
  it("builds the held view again after a forced rerun", () => {
    const words = { now: "hello" };
    const { world } = sheetWorld([
      sheetSpec({
        view: sheet => ({
          type: "sheet",
          props: { page: sheet.page, words: words.now },
          children: []
        })
      })
    ]);
    const held = warmUp(world);

    words.now = "hallo";
    world.api.projection.rerunAll();
    world.frame(16);

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(propsOf(world, heldOf(world))).toEqual({ page: "main", words: "hallo" });
  });
});

describe("warm: what drops a held view", () => {
  // Bug: a warm root in work holds ui's `asideBuilt` and the scene switch never commits; warm work runs in the frames
  // of a scene build; or the switch throws away a ready window it could keep.
  it("a scene build drops the record in work and keeps a ready one, which no commit refreshes until the build ends", () => {
    const { world, parts } = sheetWorld([sheetSpec(), sheetSpec({ name: SHOP })]);
    const sheet = warmUp(world);

    parts.done = false;
    world.frame(16);

    const shop = heldOf(world, SHOP);

    expect(world.api.projection.build(["board", SHEET, SHOP], MOUNT_OWNER, [...LAYERS], 4)).toBe(
      true
    );
    expect(world.api.ecs.ownerOf(shop)).toBeUndefined();
    expect(world.api.projection.causeOf(shop)).toBe("discard");
    expect(world.api.projection.isBuilding(sheet)).toBe(true);
    expect(world.api.projection.left()).toBe(4);

    parts.done = true;
    commitPlayer(world, { coins: 9 });
    world.frame(16);

    expect(propsOf(world, sheet)).toEqual({ page: "main", coins: 5 });
    expect(heldOf(world, SHOP)).toBe(0);

    world.api.projection.discard();
    world.frame(16);

    expect(propsOf(world, sheet)).toEqual({ page: "main", coins: 9 });
  });

  // Bug: after a switch the kept window opens at its old place, under or over the wrong roots.
  it("keeps the held view of a projection the coming scene keeps, at the Order of its new place", () => {
    const { world } = sheetWorld();
    const held = warmUp(world);
    const coming: readonly LayerSpec[] = [{ name: "ui", sort: "order" }];

    world.api.projection.build([SHEET, "board"], MOUNT_OWNER, coming, 4);
    world.api.projection.setLayers(coming);
    world.api.projection.commit();

    expect(heldOf(world)).toBe(held);
    expect(world.api.projection.isBuilding(held)).toBe(true);
    expect(world.api.ecs.get(held, Order)?.value).toBe(-2);
  });

  // Bug: the window of a scene that left stays held: its entities leak and the renderer keeps their objects.
  it("unmount despawns the held view and the entities marked for it, and nothing is built again", () => {
    const { world, parts } = sheetWorld();

    parts.done = false;
    world.frame(16);

    const held = heldOf(world);
    const element = adoptElement(world);

    world.api.projection.unmount([SHEET]);

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(world.api.projection.causeOf(held)).toBe("discard");
    expect(world.api.ecs.ownerOf(element)).toBeUndefined();
    expect(world.api.projection.isBuilding(element)).toBe(false);
    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);

    const count = world.api.ecs.count();

    parts.done = true;
    world.frame(16);
    world.frame(16);

    expect(world.api.ecs.count()).toBe(count);
    expect(recordOf(world)).toBeUndefined();
  });

  // Bug: a window open when its scene leaves is taken for a held one: it leaves as "discard", so ui drops it with no
  // exit instead of letting it leave with its screen.
  it("lets an open window leave with its screen when its projection is unmounted", () => {
    const { world } = sheetWorld();
    const held = warmUp(world);

    commitSession(world, { sheet: { page: "main" } });

    const causes = removalCauses(world);

    world.api.projection.unmount([SHEET]);

    expect(causes).toEqual([[held, "mount"]]);
    expect(world.api.projection.causeOf(held)).toBe("mount");
    expect(recordOf(world)).toBeUndefined();
  });

  // Bug: a clear leaves a held view behind, which a later world meets as a stranger.
  it("clear despawns every held view and builds none again", () => {
    const { world } = sheetWorld();
    const held = warmUp(world);

    createModules(withDeps(world.ctx)).projection.clear();
    world.frame(16);

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(world.api.projection.isBuilding(held)).toBe(false);
    expect(world.ctx.state.projection.warmList).toEqual([]);
  });

  // Bug: a stopped world keeps its warm records, so an app started again finds records of entities it never made.
  it("onStop forgets every warm record", () => {
    const { world, parts } = sheetWorld();

    parts.done = false;
    world.frame(16);

    const held = heldOf(world);

    clearWorld(world.ctx.state);

    expect(world.ctx.state.projection.warm.size).toBe(0);
    expect(world.ctx.state.projection.warmList).toEqual([]);
    expect(world.api.projection.isBuilding(held)).toBe(false);
    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
  });

  // Bug: a restore keeps the held view of the state before it, so the window opens with content the player never
  // had; or ui rebuilds the held root in one block with its other roots.
  it("a restore drops the held view before its reconcile and builds it again from the restored state", () => {
    const { world } = sheetWorld();
    const held = warmUp(world);
    const causes = removalCauses(world);

    world.model.player = { coins: 7 };
    world.commit("restore", ["player", "session"]);
    world.frame(16);

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(causes).toContainEqual([held, "discard"]);
    expect(propsOf(world, heldOf(world))).toEqual({ page: "main", coins: 7 });
  });

  // Bug: the record keeps an entity that is gone after its owner left, and the open shows nothing.
  it("warms the window again after the owner of its views left", () => {
    const { world } = sheetWorld();
    const held = warmUp(world);

    world.api.ecs.despawnOwnedBy({ kind: "projection", name: SHEET });
    world.frame(16);

    const again = heldOf(world);

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(again).not.toBe(0);
    expect(world.api.ecs.ownerOf(again)).toBeDefined();
  });
});

describe("warm: a screen and a warm with no item", () => {
  // Bug: a projection without `key` warms under another key than the one `from` shows, so the open spawns beside
  // the held view; or a warm with nothing to hold keeps the stale view of its last item.
  it("warms a screen under the projection's name, and holds nothing while warm gives no item", () => {
    const { world } = sheetWorld([
      projection({
        name: "help",
        layer: "ui",
        from: (player: Player, session: Session): Sheet | undefined =>
          session.sheet === undefined
            ? undefined
            : { id: "help", page: session.sheet.page, coins: player.coins },
        view: (sheet: Sheet | undefined): DescriptionNode =>
          sheetView(sheet ?? { id: "help", page: "none", coins: 0 }),
        warm: (player: Player): Sheet | undefined =>
          player.coins > 0 ? { id: "help", page: "main", coins: player.coins } : undefined
      }) as AnyProjectionSpec
    ]);
    const held = warmUp(world, "help");

    expect(world.api.projection.keyOf(held)).toEqual({ projection: "help", key: "help" });

    commitPlayer(world, { coins: 0 });

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(heldOf(world, "help")).toBe(0);

    commitPlayer(world, { coins: 3 });

    const again = heldOf(world, "help");

    expect(again).not.toBe(0);

    world.frame(16);
    commitSession(world, { sheet: { page: "main" } });

    expect(world.api.projection.entityOf("help", "help")).toBe(again);
  });
});

describe("warm: a hot swap", () => {
  // Bug: a hot reload that adds `warm` to a mounted window never warms it until its scene comes again; one that
  // takes `warm` away keeps the held view of the old spec for good.
  it("forgets the record of a projection replaced without warm, and warms one replaced with it", () => {
    const { world } = sheetWorld();
    const held = warmUp(world);
    const plain = projection({
      name: SHEET,
      layer: "ui",
      from: (): Sheet[] => [],
      key: (sheet: Sheet) => sheet.id,
      view: sheetView
    }) as AnyProjectionSpec;

    world.api.projection.replace(plain);
    world.frame(16);
    world.frame(16);

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(recordOf(world)).toBeUndefined();

    world.api.projection.replace(sheetSpec());
    world.frame(16);

    expect(world.api.projection.isBuilding(heldOf(world))).toBe(true);
  });
});

describe("warm: where it does not run", () => {
  // Bug: a headless test or a server spawns hidden views nobody draws: memory, and entity counts that move.
  it("builds nothing without a drawing plugin, that is no onBuild check", () => {
    const { world } = sheetWorld([sheetSpec()], { drawing: false });
    const before = world.api.ecs.count();

    world.frame(16);
    world.frame(16);

    expect(world.api.ecs.count()).toBe(before);
    expect(world.wake).not.toHaveBeenCalled();
  });

  // Bug: a paused world builds windows under a pause screen, or never builds them after the pause.
  it("builds nothing in a world that is not live, and starts when it is live again", () => {
    const { world } = sheetWorld();

    world.api.ecs.setMode("paused");
    world.frame(16);

    expect(heldOf(world)).toBe(0);

    world.api.ecs.setMode("live");
    world.frame(16);

    expect(heldOf(world)).not.toBe(0);
  });

  // Bug: a world paused while a window builds keeps `left()` finite, and the renderer asks for a frame in every frame
  // of the pause; or the record stays in work for good and the window is never ready.
  it("drops the record in work when the world stops being live, and builds it again once it is live", () => {
    const { world, parts } = sheetWorld();

    parts.done = false;
    world.frame(16);

    const held = heldOf(world);
    const lefts: number[] = [];

    world.api.ecs.setMode("paused");

    for (let frame = 0; frame < 30; frame += 1) {
      world.frame(16);
      lefts.push(world.api.projection.left());
    }

    expect(Math.min(...lefts)).toBe(Number.POSITIVE_INFINITY);
    expect(world.api.ecs.ownerOf(held)).toBeUndefined();

    parts.done = true;
    world.api.ecs.setMode("live");
    world.frame(16);
    world.frame(16);

    expect(recordOf(world)?.phase).toBe("ready");
    expect(world.api.projection.isBuilding(heldOf(world))).toBe(true);
  });
});

describe("warm: a throw", () => {
  // Bug: a `warm` that throws breaks the frame, or is logged on every frame of the rest.
  it("logs a warm that throws once per commit and holds nothing", () => {
    const { world } = sheetWorld([
      sheetSpec({
        warm: () => {
          throw new Error("no tables");
        }
      })
    ]);
    const before = world.api.ecs.count();

    world.frame(16);
    world.frame(16);
    world.frame(16);

    expect(world.log.error).toHaveBeenCalledTimes(1);
    expect(world.log.error).toHaveBeenCalledWith(
      "world:projection-failed",
      { projection: SHEET },
      expect.objectContaining({ message: "no tables" })
    );
    expect(world.api.ecs.count()).toBe(before);

    commitPlayer(world, { coins: 6 });

    expect(world.log.error).toHaveBeenCalledTimes(2);
  });

  // Bug: a held view whose refresh throws is kept with its old content, and the open shows that.
  it("drops the held view when its view throws for the refreshed warm item", () => {
    const { world } = sheetWorld([
      sheetSpec({
        view: sheet => {
          if (sheet.coins === 13) throw new Error("unlucky");

          return sheetView(sheet);
        }
      })
    ]);
    const held = warmUp(world);

    commitPlayer(world, { coins: 13 });

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(heldOf(world)).toBe(0);
    expect(world.log.error).toHaveBeenCalledWith(
      "world:projection-failed",
      { projection: SHEET },
      expect.objectContaining({ message: "unlucky" })
    );
  });

  // Bug: a `view` that throws for the warm item leaves a half-made entity, or keeps the window from opening.
  it("logs a view that throws for the warm item, spawns nothing, and the window still opens", () => {
    const { world } = sheetWorld([
      sheetSpec({
        view: sheet => {
          if (sheet.page === "main") throw new Error("no main page");

          return sheetView(sheet);
        }
      })
    ]);
    const before = world.api.ecs.count();

    world.frame(16);
    world.frame(16);

    expect(world.log.error).toHaveBeenCalledTimes(1);
    expect(world.log.error).toHaveBeenCalledWith(
      "world:projection-failed",
      { projection: SHEET },
      expect.objectContaining({ message: "no main page" })
    );
    expect(world.api.ecs.count()).toBe(before);

    commitSession(world, { sheet: { page: "audio" } });

    expect(propsOf(world, world.api.projection.entityOf(SHEET, "settings") ?? 0)).toEqual({
      page: "audio",
      coins: 5
    });
  });
});
