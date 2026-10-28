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
  MotionHandle,
  ProjectionMotion,
  SceneSwitch
} from "../../projection/types";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test (F107 parts 1–2): `projection.feed(name, sw)` hands a projection the scene switch its `from` reads as its
// third argument. The case is the leave loader of `scenes`: held while a scene stands, fed `{ from, to, progress }`
// through the switch, shown when the switch takes long enough.
// ---------------------------------------------------------------------------

/** The layers of the standing scene: its screens in `ui`, the loader in `veil`. */
const LAYERS: readonly LayerSpec[] = [
  { name: "ui", sort: "order" },
  { name: "veil", sort: "none" }
];

/** The loader projection under test. */
const LOADER = "screens.loading";

/** Who mounts and holds the loader: `scenes`. */
const SCENES: Owner = { kind: "plugin", name: "scenes" };

/** What `scenes` feeds while the ward stands. */
const WARD: SceneSwitch = { from: "ward", to: "ward", progress: 0 };

/** Half of the board's bundles loaded, on the ward → board switch. */
const HALF: SceneSwitch = { from: "ward", to: "board", progress: 0.5 };

/** The session root: coins, which the loader does not read. */
type Session = { coins?: number };

/** The one item of the loader: where the switch goes and how far it loaded. */
type Loading = { to: string; progress: number };

/** The loader's `from`, spied on. */
type LoaderFrom = (player: unknown, session: Session, sw: SceneSwitch | undefined) => Loading;

/**
 * A `from` that reads the switch alone: "" and 0 while nothing was fed.
 *
 * @returns The spy.
 */
function loaderFrom(): ReturnType<typeof vi.fn<LoaderFrom>> {
  return vi.fn<LoaderFrom>((_player, _session, sw) => ({
    to: sw?.to ?? "",
    progress: sw?.progress ?? 0
  }));
}

/**
 * The loader: a screen drawn in `veil`.
 *
 * @param from - What it reads.
 * @param name - The projection name.
 * @param motion - Its motion hooks.
 * @returns The spec.
 */
function loaderSpec(
  from: LoaderFrom,
  name = LOADER,
  motion?: ProjectionMotion<Loading>
): AnyProjectionSpec {
  return projection({
    name,
    layer: "veil",
    from,
    view: (item: Loading): DescriptionNode => ({
      type: "loader",
      props: { ...item },
      children: []
    }),
    ...(motion === undefined ? {} : { motion })
  }) as AnyProjectionSpec;
}

/**
 * A started world with the given projections registered and not mounted, and a drawing plugin's `onBuild` check that
 * passes, so a held view is built in two frames.
 *
 * @param specs - The projections.
 * @returns The world.
 */
function standing(specs: readonly AnyProjectionSpec[]): MockWorld {
  const world = createMockWorld();

  world.model.session = {};
  world.api.projection.setLayers(LAYERS);
  for (const spec of specs) world.api.projection.register(spec);
  world.start();
  world.api.projection.onBuild(() => true);

  return world;
}

/**
 * Holds the loader and runs the two frames that make its view ready: the spawn, the poll.
 *
 * @param world - The world.
 * @param sw - What `scenes` feeds right after the hold, or nothing.
 * @returns The held entity.
 */
function holdReady(world: MockWorld, sw?: SceneSwitch): Entity {
  world.api.projection.hold([LOADER], SCENES);
  if (sw !== undefined) world.api.projection.feed(LOADER, sw);
  world.frame(16);
  world.frame(16);

  return world.ctx.state.projection.warm.get(LOADER)?.view?.entity ?? 0;
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
 * The props of the loader's shown root.
 *
 * @param world - The world.
 * @returns The props, or `undefined` while nothing shows.
 */
function shownProps(world: MockWorld): object | undefined {
  const entity = world.api.projection.entityOf(LOADER, LOADER);

  return entity === undefined ? undefined : propsOf(world, entity);
}

describe("feed: a shown projection", () => {
  // Bug: the switch reaches the loader on the screen only with the next commit (a switch commits nothing while it
  // loads), so the progress stands still; or the feed spawns a second root; or two feeds of one frame queue the
  // loader twice; or it reconciles in every later frame.
  it("reconciles it in the next frame with the latest value and no commit, the same entity, once", () => {
    const from = loaderFrom();
    const world = standing([loaderSpec(from)]);

    world.api.projection.mount([LOADER], SCENES);

    const shown = world.api.projection.entityOf(LOADER, LOADER);
    const reads = from.mock.calls.length;

    world.api.projection.feed(LOADER, { from: "ward", to: "board", progress: 0.25 });
    world.api.projection.feed(LOADER, HALF);

    expect(from).toHaveBeenCalledTimes(reads);
    expect(world.ctx.state.projection.showing).toEqual([LOADER]);

    world.frame(16);

    expect(world.api.projection.entityOf(LOADER, LOADER)).toBe(shown);
    expect(shownProps(world)).toEqual({ to: "board", progress: 0.5 });
    expect(from).toHaveBeenCalledTimes(reads + 1);
    expect(from.mock.lastCall?.[2]).toBe(HALF);

    world.frame(16);

    expect(from).toHaveBeenCalledTimes(reads + 1);
  });

  // Bug: the loader on the screen stands still for the whole switch on a drawing renderer: the reconcile of a build
  // aside passes over every mounted projection the coming list does not name.
  it("reads it again while the next scene is built aside", () => {
    const world = standing([loaderSpec(loaderFrom()), loaderSpec(loaderFrom(), "board")]);

    world.api.projection.mount([LOADER], SCENES);

    expect(world.api.projection.build(["board"], SCENES, [...LAYERS], 4)).toBe(true);

    world.api.projection.feed(LOADER, HALF);
    world.frame(16);

    expect(shownProps(world)).toEqual({ to: "board", progress: 0.5 });
  });

  // Bug: the enter of the loader keeps playing over a view the feed changed, as no live change ever lets it.
  it("cancels an enter that still plays, as any live change does", () => {
    const enterMotion: MotionHandle = { finish: vi.fn(), cancel: vi.fn(), active: () => true };
    const enter = vi.fn(() => enterMotion);
    const world = standing([loaderSpec(loaderFrom(), LOADER, { enter })]);

    holdReady(world, WARD);
    world.api.projection.show(LOADER);
    world.frame(16);

    expect(enter).toHaveBeenCalledTimes(1);
    expect(enterMotion.cancel).not.toHaveBeenCalled();

    world.api.projection.feed(LOADER, HALF);
    world.frame(16);

    expect(enterMotion.cancel).toHaveBeenCalledTimes(1);
    expect(shownProps(world)).toEqual({ to: "board", progress: 0.5 });
  });

  // Bug: a feed of the value the loader already has reconciles it again (a progress event that did not move it costs
  // a reconcile); or a value that differs in one field only is taken as equal and the loader shows a stale switch.
  it("changes nothing for a value equal field by field, and reconciles for one that differs in any field", () => {
    const from = loaderFrom();
    const world = standing([loaderSpec(from)]);

    world.api.projection.mount([LOADER], SCENES);
    world.api.projection.feed(LOADER, HALF);
    world.frame(16);

    const reads = from.mock.calls.length;

    world.api.projection.feed(LOADER, { from: "ward", to: "board", progress: 0.5 });
    world.frame(16);

    expect(from).toHaveBeenCalledTimes(reads);

    const others: readonly SceneSwitch[] = [
      { from: "shop", to: "board", progress: 0.5 },
      { from: "shop", to: "ward", progress: 0.5 },
      { from: "shop", to: "ward", progress: 0.75 }
    ];

    for (const [index, sw] of others.entries()) {
      world.api.projection.feed(LOADER, sw);
      world.frame(16);

      expect(from).toHaveBeenCalledTimes(reads + index + 1);
      expect(from.mock.lastCall?.[2]).toBe(sw);
    }
  });
});

describe("feed: a held projection", () => {
  // Bug: a feed while the loader is held rebuilds its root in the frames the switch loads, or shows it over the scene;
  // or the show draws the value the loader was built with, not the switch; or it spawns a new root.
  it("changes nothing until show; show reads the fed value and the root is the held entity", () => {
    const world = standing([loaderSpec(loaderFrom())]);
    const held = holdReady(world, WARD);
    const node = world.api.ecs.get(held, Tree)?.node;
    const count = world.api.ecs.count();

    expect(propsOf(world, held)).toEqual({ to: "ward", progress: 0 });

    world.api.projection.feed(LOADER, HALF);
    world.frame(16);
    world.frame(16);

    expect(world.api.ecs.get(held, Tree)?.node).toBe(node);
    expect(world.api.projection.entitiesOf(LOADER)).toEqual([]);
    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);

    world.api.projection.show(LOADER);
    world.frame(16);

    expect(world.api.projection.entityOf(LOADER, LOADER)).toBe(held);
    expect(propsOf(world, held)).toEqual({ to: "board", progress: 0.5 });
    expect(world.api.ecs.count()).toBe(count);
  });

  // Bug: a commit during the switch rebuilds the held loader with the latest feed: warm work in the frames that load.
  it("a feed after hold followed by a commit starts no warm work: the held item reads the value fed at hold", () => {
    const world = standing([loaderSpec(loaderFrom())]);
    const held = holdReady(world, WARD);
    const node = world.api.ecs.get(held, Tree)?.node;
    const wakes = world.wake.mock.calls.length;

    world.api.projection.feed(LOADER, HALF);
    world.model.session = { coins: 3 };
    world.commit("edge", ["session"]);
    world.frame(16);

    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
    expect(world.wake).toHaveBeenCalledTimes(wakes);
    expect(world.api.ecs.get(held, Tree)?.node).toBe(node);
    expect(propsOf(world, held)).toEqual({ to: "ward", progress: 0 });
  });

  // Bug: a loader held again keeps the value of the first hold, so the scene that stands now shows the switch of the
  // scene before.
  it("reads the first feed after each hold: a second hold takes the value fed after it", () => {
    const world = standing([loaderSpec(loaderFrom())]);

    holdReady(world, WARD);

    const held = holdReady(world, HALF);

    expect(propsOf(world, held)).toEqual({ to: "board", progress: 0.5 });
  });

  // Bug: a first feed after a second hold equal to the stored value is dropped, so the switch fed later becomes the
  // value the held item is read with, and a commit builds the held loader again during the switch.
  it("keeps an equal first feed after a second hold as the value the held item is read with", () => {
    const world = standing([loaderSpec(loaderFrom())]);

    holdReady(world, WARD);
    const held = holdReady(world, { ...WARD });

    world.api.projection.feed(LOADER, HALF);
    world.model.session = { coins: 3 };
    world.commit("edge", ["session"]);
    world.frame(16);

    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
    expect(propsOf(world, held)).toEqual({ to: "ward", progress: 0 });
  });
});

describe("feed: before the projection is placed", () => {
  // Bug: the switch fed at its start is lost for the loader mounted at due (the A2 path), or for one held later.
  it("is read by a later mount and a later hold", () => {
    const mounted = standing([loaderSpec(loaderFrom())]);

    mounted.api.projection.feed(LOADER, HALF);
    mounted.api.projection.mount([LOADER], SCENES);

    expect(shownProps(mounted)).toEqual({ to: "board", progress: 0.5 });

    const holding = standing([loaderSpec(loaderFrom())]);

    holding.api.projection.feed(LOADER, HALF);

    const held = holdReady(holding);

    expect(propsOf(holding, held)).toEqual({ to: "board", progress: 0.5 });
  });

  // Bug: a projection never fed reads a value fed to another one (one shared slot), or a stale default.
  it("hands undefined to the from of a projection never fed", () => {
    const loader = loaderFrom();
    const other = loaderFrom();
    const world = standing([loaderSpec(loader), loaderSpec(other, "screens.other")]);

    world.api.projection.feed(LOADER, HALF);
    world.api.projection.mount([LOADER, "screens.other"], SCENES);

    expect(loader.mock.lastCall?.[2]).toBe(HALF);
    expect(other.mock.lastCall).toHaveLength(3);
    expect(other.mock.lastCall?.[2]).toBeUndefined();
  });
});

describe("feed: what forgets it", () => {
  // Bug: the loader of the next scene shows the last switch of the scene before (the land unmounted it); or the
  // loader re-held under the next scene's layers (the re-hold after a fade) loses the value fed just before.
  it("the public unmount forgets it; a hold that places the name again keeps it", () => {
    const world = standing([loaderSpec(loaderFrom())]);

    world.api.projection.mount([LOADER], SCENES);
    world.api.projection.feed(LOADER, HALF);
    world.frame(16);

    expect(shownProps(world)).toEqual({ to: "board", progress: 0.5 });

    world.api.projection.unmount([LOADER]);
    world.api.projection.mount([LOADER], SCENES);

    expect(shownProps(world)).toEqual({ to: "", progress: 0 });

    // A held loader the land unmounts forgets the value its held view read too.
    world.api.projection.unmount([LOADER]);
    holdReady(world, WARD);
    world.api.projection.unmount([LOADER]);

    expect(world.ctx.state.projection.fed.size).toBe(0);
    expect(world.ctx.state.projection.heldFed.size).toBe(0);

    world.api.projection.mount([LOADER], SCENES);
    world.api.projection.feed(LOADER, HALF);
    // The next scene declares `veil` otherwise: the hold unmounts the loader and places it again.
    world.api.projection.setLayers([
      { name: "ui", sort: "order" },
      { name: "veil", sort: "order" }
    ]);

    const held = holdReady(world);

    expect(propsOf(world, held)).toEqual({ to: "board", progress: 0.5 });
  });

  // Bug: a clear keeps the values fed, so the loader of the next world shows a switch of the old one.
  it("clear forgets every value fed", () => {
    const world = standing([loaderSpec(loaderFrom())]);

    world.api.projection.feed(LOADER, HALF);

    const held = holdReady(world, WARD);

    expect(propsOf(world, held)).toEqual({ to: "ward", progress: 0 });

    createModules(withDeps(world.ctx)).projection.clear();

    world.api.projection.setLayers(LAYERS);
    world.api.projection.register(loaderSpec(loaderFrom()));
    world.api.projection.mount([LOADER], SCENES);

    expect(shownProps(world)).toEqual({ to: "", progress: 0 });
    expect(world.ctx.state.projection.heldFed.size).toBe(0);
  });

  // Bug: a stopped world keeps the values fed, so an app started again draws a switch it never made.
  it("onStop forgets every value fed", () => {
    const world = standing([loaderSpec(loaderFrom())]);

    holdReady(world, WARD);
    world.api.projection.feed(LOADER, HALF);

    expect(world.ctx.state.projection.fed.get(LOADER)).toBe(HALF);
    expect(world.ctx.state.projection.heldFed.get(LOADER)).toBe(WARD);

    clearWorld(world.ctx.state);

    expect(world.ctx.state.projection.fed.size).toBe(0);
    expect(world.ctx.state.projection.heldFed.size).toBe(0);
  });
});
