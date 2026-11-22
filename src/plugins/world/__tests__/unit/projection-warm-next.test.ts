import { describe, expect, it, vi } from "vitest";
import { Tree } from "../../ecs/define";
import type { Entity } from "../../ecs/types";
import { projection } from "../../projection/define";
import type {
  AnyProjectionSpec,
  DescriptionNode,
  LayerSpec,
  ProjectionMotion,
  WarmRecord
} from "../../projection/types";
import { MOUNT_OWNER, settleFrames, Transform } from "./board";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test (spec 33, slice F, F202): the open view of a gated window built under its dim. The window keeps one key
// from its dim into its open; its `warm` answers the open item while the dim shows, so the world builds the open view
// aside (W1), also under the press motion of the tapped button (W2), swaps it in at the commit of the open item (W3),
// and keeps the live dim's keys until then (W4).
// ---------------------------------------------------------------------------

/** The layers of the scene: one `ui` layer sorted by order. */
const LAYERS: readonly LayerSpec[] = [{ name: "ui", sort: "order" }];

/** The gated window under test. */
const VITRINE = "vitrine";

/** An ordinary warm window beside it, closed. */
const SHEET = "settings.sheet";

/** The one key the vitrine keeps from its dim into its open. */
const KEY = "vitrine";

/** One item of the vitrine: its phase and the page it opens on. */
type Gate = { key: string; phase: "dim" | "open"; page: string };

/** The session root: the vitrine dimmed or open on a page, the page its warm item opens on, and noise. */
type Session = {
  gate?: "dim" | "open";
  page?: string;
  warmPage?: string;
  noWarm?: boolean;
  noise?: number;
};

/** What a case changes about the vitrine. */
type GateOptions = {
  motion?: ProjectionMotion<Gate>;
  view?: (gate: Gate) => DescriptionNode;
  warm?: (player: unknown, session: Session) => Gate | undefined;
};

/**
 * The description node of the vitrine: its phase and page as props.
 *
 * @param gate - The item.
 * @returns The node.
 */
function gateView(gate: Gate): DescriptionNode {
  return { type: "window", props: { phase: gate.phase, page: gate.page }, children: [] };
}

/**
 * The warm item of a gated window: the open item while the dim shows, else nothing.
 *
 * @param _player - The player root.
 * @param session - The session root.
 * @returns The open item, or `undefined`.
 */
function openWhileDim(_player: unknown, session: Session): Gate | undefined {
  if (session.gate !== "dim" || session.noWarm === true) return undefined;

  return { key: KEY, phase: "open", page: session.warmPage ?? "main" };
}

/**
 * The vitrine: shown dimmed or open while `session.gate` is set, under one key.
 *
 * @param options - What the case changes.
 * @returns The spec.
 */
function gateSpec(options: GateOptions = {}): AnyProjectionSpec {
  const spec = projection({
    name: VITRINE,
    layer: "ui",
    from: (_player: unknown, session: Session): Gate[] =>
      session.gate === undefined
        ? []
        : [{ key: KEY, phase: session.gate, page: session.page ?? "main" }],
    key: (gate: Gate) => gate.key,
    view: options.view ?? gateView,
    ...(options.motion === undefined ? {} : { motion: options.motion })
  });

  // The stored spec: `ProjectionSpec.warm` is typed to give an item, while the world reads `undefined` as nothing
  // held, which a gated window answers while its dim does not show.
  return { ...spec, warm: options.warm ?? openWhileDim } as AnyProjectionSpec;
}

/**
 * An ordinary warm window: never shown here, warm on its main page.
 *
 * @param warm - The spy its `warm` is.
 * @returns The spec.
 */
function sheetSpec(warm: () => { id: string } = () => ({ id: "sheet" })): AnyProjectionSpec {
  return projection({
    name: SHEET,
    layer: "ui",
    from: (): Array<{ id: string }> => [],
    key: (sheet: { id: string }) => sheet.id,
    view: (): DescriptionNode => ({ type: "sheet", props: {}, children: [] }),
    warm
  }) as AnyProjectionSpec;
}

/** A started world, the vitrine (and the sheet, when asked) mounted, and the switch of a drawing plugin's check. */
type Gated = { world: MockWorld; parts: { done: boolean } };

/**
 * A started world with the vitrine closed, a drawing plugin's `onBuild` check registered, which answers `parts.done`.
 *
 * @param specs - The projections, mounted in this order.
 * @returns The world and the switch of its check.
 */
function gatedWorld(specs: readonly AnyProjectionSpec[] = [gateSpec()]): Gated {
  const world = createMockWorld();
  const parts = { done: true };

  world.model.session = {};
  world.api.projection.setLayers(LAYERS);
  for (const spec of specs) world.api.projection.register(spec);
  world.start();
  world.api.projection.onBuild(() => parts.done);
  world.api.projection.mount(
    specs.map(spec => spec.name),
    MOUNT_OWNER
  );

  return { world, parts };
}

/**
 * The warm record of a projection.
 *
 * @param world - The world.
 * @param name - The projection.
 * @returns The record.
 */
function recordOf(world: MockWorld, name = VITRINE): WarmRecord | undefined {
  return world.ctx.state.projection.warm.get(name);
}

/**
 * The entity a warm record holds, or 0 when it holds none.
 *
 * @param world - The world.
 * @param name - The projection.
 * @returns The entity of its view.
 */
function heldOf(world: MockWorld, name = VITRINE): Entity {
  return recordOf(world, name)?.view?.entity ?? 0;
}

/**
 * The live entity of the vitrine's key.
 *
 * @param world - The world.
 * @returns The entity, or `undefined`.
 */
function liveOf(world: MockWorld): Entity | undefined {
  return world.api.projection.entityOf(VITRINE, KEY);
}

/**
 * The props of the description node an entity carries.
 *
 * @param world - The world.
 * @param entity - The entity.
 * @returns The props, or `undefined`.
 */
function propsOf(world: MockWorld, entity: Entity | undefined): object | undefined {
  return world.api.ecs.get(entity ?? 0, Tree)?.node.props;
}

/**
 * Commits a session and runs the frame that reconciles it.
 *
 * @param world - The world.
 * @param session - The new session.
 */
function commit(world: MockWorld, session: Session): void {
  world.model.session = session;
  world.commit("edge", ["session"]);
  world.frame(16);
}

/**
 * Dims the vitrine and runs the frames that build its open view and find it ready.
 *
 * @param world - The world.
 * @param session - What the dim commits besides the gate.
 * @returns The dim's entity and the held one.
 */
function dimAndBuild(world: MockWorld, session: Session = {}): { dim: Entity; held: Entity } {
  commit(world, { ...session, gate: "dim" });
  world.frame(16);

  return { dim: liveOf(world) ?? 0, held: heldOf(world) };
}

/**
 * Spawns an entity the way `ui` spawns an element of a held root and marks it with `adopt`.
 *
 * @param world - The world.
 * @returns The element.
 */
function adoptElement(world: MockWorld): Entity {
  const element = world.api.ecs.spawn({ kind: "plugin", name: "ui" }, []);

  world.api.projection.adopt(element);

  return element;
}

/**
 * Spawns an element the way `ui` spawns one of a live root: bare, never adopted.
 *
 * @param world - The world.
 * @returns The element.
 */
function liveElement(world: MockWorld): Entity {
  return world.api.ecs.spawn({ kind: "plugin", name: "ui" }, []);
}

/**
 * Starts a motion that owns its fields and runs long, as the press tween of a tapped button does.
 *
 * @param world - The world.
 * @returns The button the motion moves.
 */
function press(world: MockWorld): Entity {
  const owner = { kind: "plugin", name: "ui" } as const;
  const button = world.api.ecs.spawn(owner, [Transform()]);

  world.api.projection
    .viewOf(button, owner)
    ?.tween(Transform, { scale: 0.9 }, { ms: 250, ease: "linear" });

  return button;
}

describe("warm next: the open view built under the dim (W1)", () => {
  // Bug: a record whose key `from` shows is dropped though the live item is the dim: the open view of a gated window
  // is never built aside, and the open builds it in the frame of its motion (F202).
  it("holds a view of the dim's key built for the open item, and leaves the live dim alone", () => {
    const { world, parts } = gatedWorld();

    parts.done = false;
    commit(world, { gate: "dim" });

    const dim = liveOf(world);
    const held = heldOf(world);

    expect(held).not.toBe(0);
    expect(held).not.toBe(dim);
    expect(world.api.projection.isBuilding(held)).toBe(true);
    expect(propsOf(world, held)).toEqual({ phase: "open", page: "main" });
    expect(propsOf(world, dim)).toEqual({ phase: "dim", page: "main" });
    expect(world.api.projection.isBuilding(dim ?? 0)).toBe(false);
    expect(world.api.projection.left()).toBeLessThan(Number.POSITIVE_INFINITY);
  });

  // Bug: a window open on the screen gets a hidden copy of itself built beside it (two roots, twice the memory).
  it("holds nothing when the live view has the content of the warm item", () => {
    const { world } = gatedWorld([
      gateSpec({
        warm: (_player, session) =>
          session.gate === "dim" ? { key: KEY, phase: "dim", page: "main" } : undefined
      })
    ]);

    commit(world, { gate: "dim" });
    world.frame(16);
    world.frame(16);

    expect(heldOf(world)).toBe(0);
    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("warm next: the swap (W3)", () => {
  // Bug: the swap asks for identity: `from` builds a new object on every commit, so the gate's own dim → dim commit
  // swaps the half-built open view in under the dim (the spike's bug).
  it("swaps nothing on a commit of a new object with the dim's content", () => {
    const { world } = gatedWorld();
    const { dim, held } = dimAndBuild(world);

    commit(world, { gate: "dim", noise: 1 });

    expect(liveOf(world)).toBe(dim);
    expect(world.api.ecs.ownerOf(dim)).toBeDefined();
    expect(world.api.projection.isBuilding(held)).toBe(true);
    expect(recordOf(world)?.phase).toBe("ready");
  });

  // Bug: the open of a gated window changes the dim view into the open one in the frame of its motion (the slow path),
  // plays the dim's exit, or loses the elements built aside with the held view.
  it("despawns the dim at once with the cause discard and no exit, and shows the held view with its enter", () => {
    const enter = vi.fn();
    const exit = vi.fn();
    const { world } = gatedWorld([gateSpec({ motion: { enter, exit } })]);
    const causes: Array<[Entity, string | undefined]> = [];

    world.api.ecs.onRemoved(Tree, entity => {
      causes.push([entity, world.api.projection.causeOf(entity)]);
    });
    world.model.session = { gate: "dim" };
    world.commit("edge", ["session"]);
    world.frame(16);

    const dim = liveOf(world) ?? 0;
    const buy = adoptElement(world);

    world.api.projection.registerKey(VITRINE, "buy", buy);
    world.frame(16);

    const held = heldOf(world);

    enter.mockClear();
    commit(world, { gate: "open" });

    expect(world.api.ecs.ownerOf(dim)).toBeUndefined();
    expect(causes).toEqual([[dim, "discard"]]);
    expect(exit).not.toHaveBeenCalled();
    expect(liveOf(world)).toBe(held);
    expect(world.api.projection.isBuilding(held)).toBe(false);
    expect(enter).toHaveBeenCalledOnce();
    expect(enter.mock.calls[0]?.[1]).toEqual({ key: KEY, phase: "open", page: "main" });
    expect(world.api.projection.entityOf(VITRINE, "buy")).toBe(buy);
    expect(world.api.projection.isBuilding(buy)).toBe(false);
    expect(recordOf(world)?.phase).toBe("shown");
  });

  // Bug (F221): the view shown from the warm record enters with no hint of the open's commit, or with another cause
  // than a view that commit builds (`"change"`), so its enter cannot go on from where the dim stood.
  it("hands the swapped-in view's enter the open commit's hint and the cause change", () => {
    const enter = vi.fn();
    const { world } = gatedWorld([gateSpec({ motion: { enter } })]);

    dimAndBuild(world);
    enter.mockClear();
    world.release({
      kind: "dim.fade",
      payload: { projection: VITRINE, key: KEY, at: 0.4 },
      hint: true
    });
    commit(world, { gate: "open" });

    expect(enter).toHaveBeenCalledOnce();
    expect(enter.mock.calls[0]?.[2]).toMatchObject({ kind: "dim.fade", payload: { at: 0.4 } });
    expect(enter.mock.calls[0]?.[3]).toBe("change");
  });

  // Bug: an open on another item than the warm one shows the held view as it was built, with the warm item's content.
  it("writes the difference into the held view when the open item differs from the held one", () => {
    const { world } = gatedWorld();
    const { held } = dimAndBuild(world);

    commit(world, { gate: "open", page: "about" });

    expect(liveOf(world)).toBe(held);
    expect(propsOf(world, held)).toEqual({ phase: "open", page: "about" });
  });

  // Bug: a `view` that throws for the open item breaks the reconcile half-way: the dim is gone and nothing shows, or
  // the held view is lost.
  it("keeps the dim live and the record held when view throws for the open item, and logs it", () => {
    const { world } = gatedWorld([
      gateSpec({
        view: gate => {
          if (gate.page === "boom") throw new Error("no tables");

          return gateView(gate);
        },
        // Still the open item once the gate commits it, so the warm step after the failed swap keeps the record.
        warm: (_player, session) =>
          session.gate === undefined ? undefined : { key: KEY, phase: "open", page: "main" }
      })
    ]);
    const { dim, held } = dimAndBuild(world);

    commit(world, { gate: "open", page: "boom" });

    expect(world.log.error).toHaveBeenCalledWith(
      "world:projection-failed",
      { projection: VITRINE },
      expect.objectContaining({ message: "no tables" })
    );
    expect(liveOf(world)).toBe(dim);
    expect(propsOf(world, dim)).toEqual({ phase: "dim", page: "main" });
    expect(world.api.projection.isBuilding(held)).toBe(true);
    expect(recordOf(world)?.view?.entity).toBe(held);
  });
});

describe("warm next: the motion gate (W2)", () => {
  // Bug: the press tween of the tapped button runs through the whole dim, so the open view is never built under it
  // (the album on the A26); or an ordinary closed window starts its build in an animated frame.
  it("builds the next view under an owned motion to ready, and steps no ordinary record", () => {
    const { world, parts } = gatedWorld([sheetSpec(), gateSpec()]);

    press(world);
    parts.done = false;
    commit(world, { gate: "dim" });

    const held = heldOf(world);

    expect(held).not.toBe(0);
    expect(recordOf(world)?.phase).toBe("building");

    parts.done = true;
    world.frame(16);

    expect(recordOf(world)?.phase).toBe("ready");
    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
    expect(heldOf(world, SHEET)).toBe(0);
  });

  // Bug: a record the gate passed over is marked read and the stale flag cleared: the closed window stays cold for good
  // once the motion ends; or it reads `warm` again (twice per commit).
  it("steps an ordinary record it passed over once the motion ends, from the read it made", () => {
    const warm = vi.fn(() => ({ id: "sheet" }));
    const { world } = gatedWorld([sheetSpec(warm)]);

    press(world);
    world.frame(16);
    world.frame(16);

    expect(heldOf(world, SHEET)).toBe(0);
    expect(warm).toHaveBeenCalledOnce();

    settleFrames(world);
    world.frame(16);

    expect(heldOf(world, SHEET)).not.toBe(0);
    expect(warm).toHaveBeenCalledOnce();
  });
});

describe("warm next: the keys (W4)", () => {
  // Bug: the open view's scrim takes the key of the dim's scrim while it is built: `entityOf` answers an element nobody
  // sees and a tap lands on nothing; or after the swap it still answers the dim's, which is gone.
  it("keeps the live element's key during the build and gives it to the held one at the swap", () => {
    const { world, parts } = gatedWorld();

    parts.done = false;
    commit(world, { gate: "dim" });

    const dimScrim = liveElement(world);

    world.api.projection.registerKey(VITRINE, "scrim", dimScrim);

    const openScrim = adoptElement(world);

    world.api.projection.registerKey(VITRINE, "scrim", openScrim);

    expect(world.api.projection.entityOf(VITRINE, "scrim")).toBe(dimScrim);

    parts.done = true;
    world.frame(16);
    commit(world, { gate: "open" });

    expect(world.api.projection.entityOf(VITRINE, "scrim")).toBe(openScrim);
  });

  // Bug: ui makes the open view's elements before the dim's in one frame: the dim's scrim takes the key over for
  // good, and after the swap its remover leaves the key with nobody (a tap on the scrim finds nothing).
  it("gives the key to the live element registered after the held one, and back to the held one at the swap", () => {
    const { world, parts } = gatedWorld();

    parts.done = false;
    commit(world, { gate: "dim" });

    const openScrim = adoptElement(world);

    world.api.projection.registerKey(VITRINE, "scrim", openScrim);

    const dimScrim = liveElement(world);
    const dropDim = world.api.projection.registerKey(VITRINE, "scrim", dimScrim);

    expect(world.api.projection.entityOf(VITRINE, "scrim")).toBe(dimScrim);

    parts.done = true;
    world.frame(16);
    commit(world, { gate: "open" });
    dropDim();

    expect(world.api.projection.entityOf(VITRINE, "scrim")).toBe(openScrim);
  });

  // Bug: a discard of the build drops the key the dim's element holds, or leaves the held element's waiting key to
  // take it at a later open.
  it("leaves the live key in place when the build is discarded", () => {
    const { world, parts } = gatedWorld();

    parts.done = false;
    commit(world, { gate: "dim" });

    const dimScrim = liveElement(world);

    world.api.projection.registerKey(VITRINE, "scrim", dimScrim);
    world.api.projection.registerKey(VITRINE, "scrim", adoptElement(world));
    parts.done = true;
    world.frame(16);
    commit(world, { gate: "dim", noWarm: true });

    expect(heldOf(world)).toBe(0);
    expect(world.api.projection.entityOf(VITRINE, "scrim")).toBe(dimScrim);
    expect(world.ctx.state.projection.heldKeys.size).toBe(0);
  });

  // Bug: a held element that is gone without its remover still waits with its key, and takes it from the live one at
  // the swap: `entityOf` answers an entity that does not exist.
  it("forgets the waiting key of a held element that is gone", () => {
    const { world, parts } = gatedWorld();

    parts.done = false;
    commit(world, { gate: "dim" });

    const dimScrim = liveElement(world);
    const openScrim = adoptElement(world);

    world.api.projection.registerKey(VITRINE, "scrim", dimScrim);
    world.api.projection.registerKey(VITRINE, "scrim", openScrim);
    world.api.ecs.despawn(openScrim);
    parts.done = true;
    world.frame(16);
    commit(world, { gate: "open" });

    expect(world.api.projection.entityOf(VITRINE, "scrim")).toBe(dimScrim);
  });

  // Bug: a row ranged in under the held root after it was ready is taken for one of the live dim's: `entityOf` answers
  // a row nobody sees; or a new element of the live dim is held.
  it("holds an element adopted after the build was ready, and not one of the live dim", () => {
    const { world } = gatedWorld();

    dimAndBuild(world);

    const row = adoptElement(world);

    world.api.projection.registerKey(VITRINE, "w15", row);

    const dimRow = liveElement(world);

    world.api.projection.registerKey(VITRINE, "d3", dimRow);

    expect(world.api.projection.isBuilding(row)).toBe(true);
    expect(world.api.projection.entityOf(VITRINE, "w15")).toBeUndefined();
    expect(world.api.projection.isBuilding(dimRow)).toBe(false);
    expect(world.api.projection.entityOf(VITRINE, "d3")).toBe(dimRow);

    commit(world, { gate: "open" });

    expect(world.api.projection.entityOf(VITRINE, "w15")).toBe(row);
  });
});
