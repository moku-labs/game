import { describe, expect, it, vi } from "vitest";
import { createModules } from "../../api";
import { Tree } from "../../ecs/define";
import type { Entity, Owner } from "../../ecs/types";
import { clearWorld, withDeps } from "../../lifecycle";
import { projection } from "../../projection/define";
import type {
  AnyProjectionSpec,
  DescriptionNode,
  LayerSpec,
  ProjectionMotion
} from "../../projection/types";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test (F103): a held projection. `hold` mounts a projection that shows nothing while it is held: its `from`'s
// first item is kept built and hidden by the warm machinery, in idle frames. `show` releases it: the next reconcile
// shows `from`'s item through the warm open path, the same entity. The case is the leave loader of `scenes`: held
// while a scene stands, shown when a switch takes long enough.
// ---------------------------------------------------------------------------

/** The layers of the standing scene: its screens in `ui`, the loader in `veil`. */
const LAYERS: readonly LayerSpec[] = [
  { name: "ui", sort: "order" },
  { name: "veil", sort: "none" }
];

/** The loader projection under test. */
const LOADER = "loading";

/** A warm sheet, for the cases of a held projection that also declares `warm`. */
const SHEET = "settings.sheet";

/** Who holds the loader: `scenes`. */
const SCENES: Owner = { kind: "plugin", name: "scenes" };

/** The player root: the coins the board prints. */
type Player = { coins: number };

/** The session root: the progress the loader prints, and the sheet open on a page. */
type Session = { progress?: number; sheet?: { page: string } };

/** The one item of the loader: its label and its progress. */
type Loading = { label: string; progress: number };

/** One item of the sheet. */
type Sheet = { id: string; page: string };

/** What a case changes about the loader projection. */
type LoaderOptions = {
  name?: string;
  layer?: string;
  view?: (item: Loading) => DescriptionNode;
  motion?: ProjectionMotion<Loading>;
};

/**
 * The description node of the loader: its label and its progress as props.
 *
 * @param item - The loader item.
 * @returns The node.
 */
function loaderView(item: Loading): DescriptionNode {
  return { type: "loader", props: { label: item.label, progress: item.progress }, children: [] };
}

/**
 * The loader: a screen, one item read from the session, drawn in `veil`.
 *
 * @param options - What the case changes.
 * @returns The spec.
 */
function loaderSpec(options: LoaderOptions = {}): AnyProjectionSpec {
  return projection({
    name: options.name ?? LOADER,
    layer: options.layer ?? "veil",
    from: (_player: Player, session: Session): Loading => ({
      label: "Loading",
      progress: session.progress ?? 0
    }),
    view: options.view ?? loaderView,
    ...(options.motion === undefined ? {} : { motion: options.motion })
  }) as AnyProjectionSpec;
}

/**
 * A settings sheet: shown while `session.sheet` is set, warm on its main page.
 *
 * @returns The spec.
 */
function sheetSpec(): AnyProjectionSpec {
  return projection({
    name: SHEET,
    layer: "ui",
    from: (_player: Player, session: Session): Sheet[] =>
      session.sheet === undefined ? [] : [{ id: "settings", page: session.sheet.page }],
    key: (sheet: Sheet) => sheet.id,
    view: (sheet: Sheet): DescriptionNode => ({
      type: "sheet",
      props: { page: sheet.page },
      children: []
    }),
    warm: (): Sheet => ({ id: "settings", page: "main" })
  }) as AnyProjectionSpec;
}

/**
 * A board screen in `ui`, with the `from` a case spies on.
 *
 * @param name - The projection name.
 * @param from - What it reads.
 * @returns The spec.
 */
function boardSpec(name: string, from: (player: Player) => Player): AnyProjectionSpec {
  return projection({
    name,
    layer: "ui",
    from,
    view: (player: Player): DescriptionNode => ({
      type: "board",
      props: { coins: player.coins },
      children: []
    })
  }) as AnyProjectionSpec;
}

/** A standing scene with the loader registered, and the switch of a drawing plugin's `onBuild` check. */
type Standing = {
  world: MockWorld;
  parts: { done: boolean };
  boardFrom: ReturnType<typeof vi.fn<(player: Player) => Player>>;
};

/**
 * A started world showing the board, the given projections registered and not mounted, and a drawing plugin's
 * `onBuild` check that answers `parts.done`.
 *
 * @param specs - The projections a case holds.
 * @param session - The session the world starts with.
 * @returns The world, the switch of its check and the board's `from`.
 */
function standing(
  specs: readonly AnyProjectionSpec[] = [loaderSpec()],
  session: Session = {}
): Standing {
  const world = createMockWorld();
  const parts = { done: true };
  const boardFrom = vi.fn((player: Player): Player => player);

  world.model.player = { coins: 5 };
  world.model.session = session;
  world.api.projection.setLayers(LAYERS);
  world.api.projection.register(boardSpec("board", boardFrom));
  for (const spec of specs) world.api.projection.register(spec);
  world.start();
  world.api.projection.onBuild(() => parts.done);
  world.api.projection.mount(["board"], SCENES);

  return { world, parts, boardFrom };
}

/**
 * The entity a projection's record holds hidden, or 0 when it holds none.
 *
 * @param world - The world.
 * @param name - The projection.
 * @returns The entity of its held view.
 */
function heldOf(world: MockWorld, name = LOADER): Entity {
  return world.ctx.state.projection.warm.get(name)?.view?.entity ?? 0;
}

/**
 * Holds a projection and runs the two frames that make its view ready with a check that passes: the spawn, the poll.
 *
 * @param world - The world.
 * @param name - The projection.
 * @returns The held entity.
 */
function holdReady(world: MockWorld, name = LOADER): Entity {
  world.api.projection.hold([name], SCENES);
  world.frame(16);
  world.frame(16);

  return heldOf(world, name);
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
 * Spawns an entity the way `ui` spawns an element of a root and marks it with `adopt`.
 *
 * @param world - The world.
 * @returns The element.
 */
function adoptElement(world: MockWorld): Entity {
  const element = world.api.ecs.spawn({ kind: "plugin", name: "ui" }, []);

  world.api.projection.adopt(element);

  return element;
}

describe("hold: the held view", () => {
  // Bug: a held loader is drawn over the standing scene at once, as a mount draws it; or it is never built ahead, so
  // the frame it is due builds it (the 33–49 ms of F61); or its view is spawned again on every frame of the rest.
  it("shows nothing at the hold, then builds one held view of from's item in idle frames and rests", () => {
    const { world, parts } = standing();
    const before = world.api.ecs.count();

    parts.done = false;
    world.api.projection.hold([LOADER], SCENES);

    expect(world.api.ecs.count()).toBe(before);
    expect(world.api.projection.entitiesOf(LOADER)).toEqual([]);

    world.frame(16);

    const held = heldOf(world);

    expect(world.api.ecs.count()).toBe(before + 1);
    expect(propsOf(world, held)).toEqual({ label: "Loading", progress: 0 });
    expect(world.api.projection.isBuilding(held)).toBe(true);
    expect(world.api.projection.keyOf(held)).toEqual({ projection: LOADER, key: LOADER });
    expect(world.api.projection.entityOf(LOADER, LOADER)).toBeUndefined();
    expect(world.api.projection.entitiesOf(LOADER)).toEqual([]);
    expect(world.api.projection.left()).toBeLessThan(Number.POSITIVE_INFINITY);

    parts.done = true;
    world.frame(16);
    world.frame(16);
    world.frame(16);

    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
    expect(world.api.ecs.count()).toBe(before + 1);
    expect(heldOf(world)).toBe(held);
    expect(world.wake).toHaveBeenCalledTimes(1);
  });

  // Bug: a loader whose layer the scene does not declare is held anyway, so the A2 mount at the due never reports it;
  // or a throw leaves a name of the list held, so its later mount shows nothing.
  it("checks the names as mount does: an unknown name or an undeclared layer throws and holds nothing", () => {
    const { world } = standing([loaderSpec(), loaderSpec({ name: "loading.top", layer: "top" })]);

    expect(() => world.api.projection.hold([LOADER, "nope"], SCENES)).toThrow(
      'Projection "nope" is not registered'
    );
    expect(() => world.api.projection.hold([LOADER, "loading.top"], SCENES)).toThrow(
      'names layer "top", which the scene does not declare'
    );

    world.frame(16);

    expect(heldOf(world)).toBe(0);

    world.api.projection.mount([LOADER], SCENES);

    expect(world.api.projection.entityOf(LOADER, LOADER)).not.toBeUndefined();
  });

  // Bug: a commit while the loader is held shows it over the scene; or the loader shows the progress of the frame its
  // view was built in.
  it("writes a commit into the held view, still hidden, and builds it again under the budget", () => {
    const { world, parts } = standing();
    const held = holdReady(world);

    parts.done = false;
    commitSession(world, { progress: 0.5 });

    expect(heldOf(world)).toBe(held);
    expect(propsOf(world, held)).toEqual({ label: "Loading", progress: 0.5 });
    expect(world.api.projection.entitiesOf(LOADER)).toEqual([]);
    expect(world.api.projection.isBuilding(held)).toBe(true);
    expect(world.api.projection.left()).toBeLessThan(Number.POSITIVE_INFINITY);
  });
});

describe("show", () => {
  // Bug: the due loader spawns a second view (the slow mount it replaces), stays hidden, plays no enter, or runs its
  // view and writes its Tree again, so ui diffs the whole root in the frame it appears.
  it("shows the held entity in the next reconcile: no spawn, no Tree write, the enter and loop play once", () => {
    const enter = vi.fn(() => undefined);
    const loop = vi.fn(() => undefined);
    const { world } = standing([loaderSpec({ motion: { enter, loop } })]);
    const held = holdReady(world);
    const node = world.api.ecs.get(held, Tree)?.node;
    const count = world.api.ecs.count();

    world.api.projection.show(LOADER);

    expect(world.api.projection.entityOf(LOADER, LOADER)).toBeUndefined();

    world.frame(16);

    expect(world.api.projection.entityOf(LOADER, LOADER)).toBe(held);
    expect(world.api.projection.entitiesOf(LOADER)).toEqual([held]);
    expect(world.api.ecs.count()).toBe(count);
    expect(world.api.projection.isBuilding(held)).toBe(false);
    expect(world.api.ecs.get(held, Tree)?.node).toBe(node);
    expect(enter).toHaveBeenCalledTimes(1);
    expect(enter).toHaveBeenCalledWith(
      expect.objectContaining({ entity: held }),
      { label: "Loading", progress: 0 },
      undefined,
      "change"
    );
    expect(loop).toHaveBeenCalledTimes(1);
    expect(world.api.projection.causeOf(held)).toBe("change");
  });

  // Bug: the loader appears with the progress of the frame its view was built in, or plays a change motion.
  it("writes the difference directly when from's item changed since the build, with no change hook", () => {
    const change = vi.fn(() => undefined);
    const { world } = standing([loaderSpec({ motion: { change: { Tree: change } } })]);
    const held = holdReady(world);

    world.model.session = { progress: 0.8 };
    world.commit("edge", ["session"]);
    world.api.projection.show(LOADER);
    world.frame(16);

    expect(world.api.projection.entityOf(LOADER, LOADER)).toBe(held);
    expect(propsOf(world, held)).toEqual({ label: "Loading", progress: 0.8 });
    expect(change).not.toHaveBeenCalled();
  });

  // Bug: a loader due while its root is still built in parts stays hidden or spawns a second one; or the frame budget
  // stays finite for good, and ui keeps building in parts a root that is on the screen.
  it("shows a held view still in work: the budget ends and the elements ui marked are shown with it", () => {
    const { world, parts } = standing();

    parts.done = false;
    world.api.projection.hold([LOADER], SCENES);
    world.frame(16);

    const held = heldOf(world);
    const element = adoptElement(world);

    world.api.projection.show(LOADER);
    world.frame(16);

    expect(world.api.projection.entityOf(LOADER, LOADER)).toBe(held);
    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
    expect(world.api.projection.isBuilding(held)).toBe(false);
    expect(world.api.projection.isBuilding(element)).toBe(false);
  });

  // Bug: a loader due while the next scene is built aside stays hidden until the swap: the reconcile of a build passes
  // over every mounted projection the coming list does not name.
  it("shows the held loader while the next scene is built aside", () => {
    const { world } = standing([loaderSpec(), boardSpec("ward", player => player)]);
    const held = holdReady(world);

    expect(world.api.projection.build(["ward"], SCENES, [...LAYERS], 4)).toBe(true);

    world.api.projection.show(LOADER);
    world.frame(16);

    expect(world.api.projection.entityOf(LOADER, LOADER)).toBe(held);
    expect(world.api.projection.isBuilding(held)).toBe(false);
  });

  // Bug: a paused world (the restore of a repro) plays the loader's enter under the pause.
  it("shows the held view direct in a world that is not live: no enter, the loop owed", () => {
    const enter = vi.fn(() => undefined);
    const { world } = standing([loaderSpec({ motion: { enter } })]);
    const held = holdReady(world);

    world.api.ecs.setMode("paused");
    world.api.projection.show(LOADER);
    world.frame(16);

    expect(world.api.projection.entityOf(LOADER, LOADER)).toBe(held);
    expect(world.api.projection.causeOf(held)).toBe("mount");
    expect(enter).not.toHaveBeenCalled();
    expect(world.ctx.state.projection.warm.get(LOADER)?.view?.loopOwed).toBe(true);
  });

  // Bug: a show with nothing held (a headless app: no drawing plugin builds a held view) shows nothing, so the loader
  // never appears.
  it("spawns the view as a mount does when nothing is held", () => {
    const world = createMockWorld();

    world.model.session = { progress: 0.4 };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register(loaderSpec());
    world.start();
    world.api.projection.hold([LOADER], SCENES);
    world.frame(16);

    expect(world.api.ecs.count()).toBe(0);

    world.api.projection.show(LOADER);
    world.frame(16);

    const shown = world.api.projection.entityOf(LOADER, LOADER) ?? 0;

    expect(propsOf(world, shown)).toEqual({ label: "Loading", progress: 0.4 });
    expect(world.api.projection.isBuilding(shown)).toBe(false);
  });

  // Bug: a show of a name that is not held reconciles a projection on the screen again, or mounts one nobody mounted.
  it("does nothing for a name that is not held", () => {
    const { world, boardFrom } = standing();
    const count = world.api.ecs.count();
    const reads = boardFrom.mock.calls.length;

    world.api.projection.show("board");
    world.api.projection.show(LOADER);
    world.api.projection.show("nope");
    world.frame(16);

    expect(boardFrom).toHaveBeenCalledTimes(reads);
    expect(world.api.projection.entitiesOf(LOADER)).toEqual([]);
    expect(world.api.ecs.count()).toBe(count);
  });
});

describe("hold: what drops a held view", () => {
  // Bug: the loader of a scene that left stays held: its entities leak; or its name stays held, so the A2 mount at
  // the next due shows nothing.
  it("unmount despawns the held view and the entities marked for it, and forgets the hold", () => {
    const { world, parts } = standing();

    parts.done = false;
    world.api.projection.hold([LOADER], SCENES);
    world.frame(16);

    const held = heldOf(world);
    const element = adoptElement(world);

    world.api.projection.unmount([LOADER]);

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(world.api.projection.causeOf(held)).toBe("discard");
    expect(world.api.ecs.ownerOf(element)).toBeUndefined();
    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);

    const count = world.api.ecs.count();

    parts.done = true;
    world.frame(16);
    world.frame(16);

    expect(world.api.ecs.count()).toBe(count);

    world.api.projection.mount([LOADER], SCENES);

    expect(world.api.projection.entityOf(LOADER, LOADER)).not.toBeUndefined();
  });

  // Bug: a clear keeps the held names, so the loader of the next world never shows; or it keeps the held view.
  it("clear despawns the held view and forgets every hold", () => {
    const { world } = standing();
    const held = holdReady(world);
    const projectionModule = createModules(withDeps(world.ctx)).projection;

    projectionModule.clear();

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();

    world.api.projection.setLayers(LAYERS);
    world.api.projection.register(loaderSpec());
    world.api.projection.mount([LOADER], SCENES);

    expect(world.api.projection.entityOf(LOADER, LOADER)).not.toBeUndefined();
  });

  // Bug: a stopped world keeps its held names and the shows it owed, so an app started again holds what it never held.
  it("onStop forgets every hold and every owed show", () => {
    const { world } = standing();

    holdReady(world);
    world.api.projection.show(LOADER);
    world.api.projection.hold([LOADER], SCENES);
    clearWorld(world.ctx.state);

    expect(world.ctx.state.projection.held.size).toBe(0);
    expect(world.ctx.state.projection.showing).toEqual([]);
  });

  // Bug: a restore shows the held loader (its direct reconcile reads from), or keeps the view of the state before it.
  it("a restore drops the held view and builds it again from the restored state, still hidden", () => {
    const { world } = standing();
    const held = holdReady(world);
    const causes = removalCauses(world);

    world.model.session = { progress: 0.3 };
    world.commit("restore", ["player", "session"]);
    world.frame(16);

    const again = heldOf(world);

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(causes).toContainEqual([held, "discard"]);
    expect(propsOf(world, again)).toEqual({ label: "Loading", progress: 0.3 });
    expect(world.api.projection.isBuilding(again)).toBe(true);
    expect(world.api.projection.entityOf(LOADER, LOADER)).toBeUndefined();
  });

  // Bug: a hot swap of the loader forgets its record (its spec declares no `warm`), so the due loader spawns; or the
  // forced rerun shows it.
  it("a hot swap keeps the hold: the held view is built again with the new view and the show adopts it", () => {
    const { world } = standing();
    const held = holdReady(world);

    world.api.projection.replace(
      loaderSpec({
        view: item => ({
          type: "loader",
          props: { label: "Wait", progress: item.progress },
          children: []
        })
      })
    );
    world.frame(16);

    const again = heldOf(world);

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(propsOf(world, again)).toEqual({ label: "Wait", progress: 0 });
    expect(world.api.projection.isBuilding(again)).toBe(true);
    expect(world.api.projection.entityOf(LOADER, LOADER)).toBeUndefined();

    world.frame(16);
    world.api.projection.show(LOADER);
    world.frame(16);

    expect(world.api.projection.entityOf(LOADER, LOADER)).toBe(again);
  });
});

describe("hold with warm", () => {
  // Bug: a held projection that declares `warm` holds warm's item, so the show writes the difference or spawns
  // beside it; or once shown and closed it never warms its own item again.
  it("holds from's item while held, shows it, and warms warm's item again after the close", () => {
    const { world } = standing([sheetSpec()], { sheet: { page: "audio" } });
    const held = holdReady(world, SHEET);

    expect(propsOf(world, held)).toEqual({ page: "audio" });
    expect(world.api.projection.entityOf(SHEET, "settings")).toBeUndefined();

    world.api.projection.show(SHEET);
    world.frame(16);

    expect(world.api.projection.entityOf(SHEET, "settings")).toBe(held);

    commitSession(world, {});
    world.frame(16);

    const again = heldOf(world, SHEET);

    expect(world.api.ecs.ownerOf(held)).toBeUndefined();
    expect(propsOf(world, again)).toEqual({ page: "main" });
    expect(world.api.projection.isBuilding(again)).toBe(true);
  });

  // Bug: a hold keeps the view of warm's item a mounted projection held before it until the next commit: the show
  // then adopts the wrong page.
  it("reads the item of a record held before the hold again, from from", () => {
    const { world } = standing([sheetSpec()]);

    world.api.projection.mount([SHEET], SCENES);
    world.frame(16);
    world.frame(16);

    const warmView = heldOf(world, SHEET);

    expect(propsOf(world, warmView)).toEqual({ page: "main" });

    // The next scene declares the same layers: the sheet stays mounted, and is held from now on. Its `from` shows
    // nothing while the sheet is closed, so nothing is held.
    world.api.projection.setLayers([...LAYERS]);
    world.api.projection.hold([SHEET], SCENES);
    world.frame(16);

    expect(world.api.ecs.ownerOf(warmView)).toBeUndefined();
    expect(heldOf(world, SHEET)).toBe(0);
  });
});
