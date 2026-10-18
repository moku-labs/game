import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureDescription, SystemsRun } from "../../../flow/features/types";
import type { FlowState } from "../../../flow/types";
import { createModules } from "../../api";
import { component, mut, system } from "../../ecs/define";
import type { AnySystem, Owner, WorldPhase } from "../../ecs/types";
import { clearWorld, withDeps } from "../../lifecycle";
import type { ProjectionMotion } from "../../projection/types";
import type { Item } from "./board";
import {
  BOARD,
  boardItems,
  commitItems,
  LAYERS,
  MOUNT_OWNER,
  settleFrames,
  Transform
} from "./board";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit: systems that run where their feature is (spec 28). A feature with
// `systemsRun: "active"` runs its systems only while a node of it is on the
// flow stack (rule N), a view of a projection it registered exists (rule V),
// or `scenes`/`ui` hold it (rules S and U, through `ecs.hold`).
// ---------------------------------------------------------------------------

const Glow = component("Glow", { at: 0 });
const OWNER: Owner = { kind: "plugin", name: "test" };

/** A view that leaves with a motion of one second, so it is `Exiting` for a while. */
const flyAway: ProjectionMotion<Item> = {
  exit: view => view.tween(Transform, { x: 900 }, { ms: 1000, ease: "linear" })
};

/** What the counting systems saw: the names in run order, and `resumed` per run. */
type Trace = { runs: string[]; resumed: boolean[] };

/**
 * A system of an empty query that records its run and the `resumed` it was handed.
 *
 * @param name - System name.
 * @param phase - Its phase.
 * @param trace - Where it records.
 * @param run - Extra work of the run.
 * @returns The system.
 */
function counter(name: string, phase: WorldPhase, trace: Trace, run?: () => void): AnySystem {
  return system({
    name,
    phase,
    query: [],
    run: (_rows, ctx) => {
      trace.runs.push(name);
      trace.resumed.push(ctx.resumed);
      run?.();
    }
  });
}

/**
 * Registers a feature with the mock flow, as a feature plugin does in `onInit`.
 *
 * @param world - The mock world.
 * @param name - Feature name.
 * @param systems - Its systems.
 * @param run - Its `systemsRun`, or none.
 * @param extra - The rest of the description; by default one scene, so it can become active.
 */
function addFeature(
  world: MockWorld,
  name: string,
  systems: readonly AnySystem[],
  run?: SystemsRun,
  extra?: FeatureDescription
): void {
  world.features.push({
    name,
    description: {
      ...(extra ?? { scenes: [{ id: name }] }),
      systems,
      ...(run === undefined ? {} : { systemsRun: run })
    }
  });
}

/**
 * A frame of the stack.
 *
 * @param flow - Flow id.
 * @param node - Node name.
 * @returns The frame.
 */
function at(flow: string, node: string): FlowState["stack"][number] {
  return { flow, node, input: {} };
}

/**
 * A fresh trace.
 *
 * @returns An empty trace.
 */
function trace(): Trace {
  return { runs: [], resumed: [] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rule N: a node of the feature on the flow stack", () => {
  // Bug caught: the skip never happens, or happens while the feature's node is on the stack.
  it("a system of an active-run feature does not run while no node of its feature is on the stack", () => {
    const world = createMockWorld();
    const seen = trace();

    world.flow.owners = { main: { home: undefined }, board: { awaitIntent: "board" } };
    addFeature(world, "board", [counter("board.looks", "animate", seen)], "active");
    world.start();
    world.flow.stack = [at("main", "home")];
    world.frame();
    world.frame();

    expect(seen.runs).toEqual([]);

    world.flow.stack = [at("main", "home"), at("board", "awaitIntent")];
    world.frame();

    expect(seen.runs).toEqual(["board.looks"]);
  });

  // Bug caught: the owner check walks up the feature tree, so a parent keeps its child running.
  it("a node of the parent does not make its sub-feature active, nor the other way round", () => {
    const world = createMockWorld();

    world.flow.owners = { episodes: { pick: "episodes" }, ep01Story: { scene1: "ep01" } };
    addFeature(world, "episodes", []);
    addFeature(world, "ep01", []);
    world.start();

    world.flow.stack = [at("episodes", "pick")];
    expect(world.api.ecs.isActive("episodes")).toBe(true);
    expect(world.api.ecs.isActive("ep01")).toBe(false);

    world.flow.stack = [at("ep01Story", "scene1")];
    expect(world.api.ecs.isActive("episodes")).toBe(false);
    expect(world.api.ecs.isActive("ep01")).toBe(true);
  });

  // Bug caught: only the top frame is read, so the board stops while the shop sheet is over it.
  it("an outer frame of a sub-flow keeps its feature active", () => {
    const world = createMockWorld();

    world.flow.owners = {
      main: { board: "board" },
      board: { merge: "board" },
      shop: { sheet: "shop" }
    };
    addFeature(world, "board", []);
    addFeature(world, "shop", []);
    world.start();
    world.flow.stack = [at("main", "board"), at("board", "merge"), at("shop", "sheet")];

    expect(world.api.ecs.isActive("board")).toBe(true);
    expect(world.api.ecs.isActive("shop")).toBe(true);
  });

  // Bug caught: the flow's id is taken for the owner, so the flow's feature runs for a node it does not own (R5).
  it("a node contributed into another feature's flow makes the feature that lists it active, not the flow's", () => {
    const world = createMockWorld();

    world.flow.owners = { board: { merge: "board", deliver: "orders" } };
    addFeature(world, "board", []);
    addFeature(world, "orders", []);
    world.start();
    world.flow.stack = [at("board", "deliver")];

    expect(world.api.ecs.isActive("orders")).toBe(true);
    expect(world.api.ecs.isActive("board")).toBe(false);
  });

  it("answers false for a name that is not a feature", () => {
    const world = createMockWorld();

    world.start();

    expect(world.api.ecs.isActive("nobody")).toBe(false);
  });
});

/**
 * A world whose feature `shop` registered the board projection, mounted with one item.
 *
 * @returns The started world.
 */
function shopWorld(): MockWorld {
  const world = createMockWorld();

  world.model.player = { items: [{ id: "a", level: 1, x: 0, y: 0 }] };
  addFeature(world, "shop", [], "active", { projections: [boardItems(flyAway)] });
  world.api.projection.setLayers(LAYERS);
  world.start();
  world.api.projection.mount([BOARD], MOUNT_OWNER);

  return world;
}

describe("rule V: a view of a projection the feature registered", () => {
  // Bug caught: the count drops when the view starts its exit, so the look stalls while it leaves.
  it("a view of the feature's projection keeps it active until the view is despawned, its exit included", () => {
    const world = shopWorld();

    expect(world.api.ecs.isActive("shop")).toBe(true);

    commitItems(world, []);
    world.frame();

    expect(world.driver.active()).toBeGreaterThan(0);
    expect(world.api.ecs.isActive("shop")).toBe(true);

    settleFrames(world);

    expect(world.api.projection.entitiesOf(BOARD)).toEqual([]);
    expect(world.ctx.state.projection.byEntity.size).toBe(0);
    expect(world.api.ecs.isActive("shop")).toBe(false);
  });

  // Bug caught: a revive counts the view a second time, so the feature never stops.
  it("a revived view is counted once", () => {
    const world = shopWorld();

    commitItems(world, []);
    world.frame();
    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    world.frame();
    commitItems(world, []);
    world.frame();
    settleFrames(world);

    expect(world.ctx.state.projection.byEntity.size).toBe(0);
    expect(world.api.ecs.isActive("shop")).toBe(false);
  });

  // Bug caught: views cleared with the world or the projection keep their feature active for good.
  it("ecs.clear and projection.clear drop the view counts", () => {
    const viaEcs = shopWorld();
    const ecsModules = createModules(withDeps(viaEcs.ctx));

    ecsModules.ecs.clear();
    expect(viaEcs.api.ecs.isActive("shop")).toBe(false);

    const viaProjection = shopWorld();
    const projectionModules = createModules(withDeps(viaProjection.ctx));

    // A count the projection cannot match to a record, as a view despawned behind its back leaves.
    projectionModules.ecs.viewCame(BOARD);
    projectionModules.projection.clear();
    expect(viaProjection.api.ecs.isActive("shop")).toBe(false);
  });

  // Bug caught: a count taken below 0 leaves the next view of the feature unseen.
  it("a view count never goes below 0", () => {
    const world = shopWorld();
    const modules = createModules(withDeps(world.ctx));

    modules.ecs.viewsCleared();
    modules.ecs.viewLeft(BOARD);
    modules.ecs.viewLeft(BOARD);
    modules.ecs.viewCame(BOARD);

    expect(world.api.ecs.isActive("shop")).toBe(true);
  });
});

describe("holds", () => {
  // Bug caught: a hold is a flag, not a count, so the first release ends a feature two plugins hold.
  it("holds are counted and a release works once", () => {
    const world = createMockWorld();

    addFeature(world, "screens", []);
    world.start();

    const first = world.api.ecs.hold("screens");
    const second = world.api.ecs.hold("screens");

    first();
    first();
    expect(world.api.ecs.isActive("screens")).toBe(true);

    second();
    expect(world.api.ecs.isActive("screens")).toBe(false);
  });

  // Bug caught: a typo in a scene's feature name throws or holds a feature that does not exist.
  it("a hold of an unknown name holds nothing and warns in dev", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const world = createMockWorld();

    world.start();

    const release = world.api.ecs.hold("nobody");

    expect(world.api.ecs.isActive("nobody")).toBe(false);
    expect(world.log.warn).toHaveBeenCalledWith("world:hold-unknown-feature", {
      feature: "nobody"
    });
    expect(() => release()).not.toThrow();
  });

  // Bug caught: a release kept past the stop writes NaN into the next start's counts.
  it("a release called after the world stopped changes nothing", () => {
    const world = createMockWorld();

    addFeature(world, "screens", []);
    world.start();

    const release = world.api.ecs.hold("screens");

    clearWorld(world.ctx.state);
    release();
    world.start();

    expect(world.api.ecs.isActive("screens")).toBe(false);
    expect([...world.ctx.state.ecs.scope.holds]).toEqual([0]);
  });

  // Bug caught: a release kept across a stop and a start takes back a hold of the next run (W7.1).
  it("a release kept from before a stop leaves the holds of the next run alone", () => {
    const world = createMockWorld();

    addFeature(world, "screens", []);
    world.start();

    const stale = world.api.ecs.hold("screens");

    clearWorld(world.ctx.state);
    world.start();
    world.api.ecs.hold("screens");
    stale();

    expect([...world.ctx.state.ecs.scope.holds]).toEqual([1]);
    expect(world.api.ecs.isActive("screens")).toBe(true);
  });
});

describe("the skip", () => {
  // Bug caught: the skip sits after the walk, so a sleeping system still marks and pays for its rows.
  it("a skipped system walks no query and marks nothing", () => {
    const world = createMockWorld();
    const walked = vi.fn();

    world.api.ecs.spawn(OWNER, [Glow()]);
    addFeature(
      world,
      "board",
      [
        system({
          name: "board.glow",
          phase: "animate",
          query: [mut(Glow)],
          run: rows => {
            for (const row of rows) walked(row[0]);
          }
        })
      ],
      "active"
    );
    world.start();
    world.frame();

    const store = world.ctx.state.ecs.stores.get("Glow");
    const forEach = vi.spyOn(store ?? new Map(), "forEach");
    const changed: number[] = [];

    world.api.ecs.system(
      system({
        name: "probe",
        phase: "sync",
        query: [],
        run: (_rows, ctx) => {
          for (const entity of ctx.world.changed(Glow)) changed.push(entity);
        }
      })
    );
    world.frame();
    world.frame();

    expect(walked).not.toHaveBeenCalled();
    expect(forEach).not.toHaveBeenCalled();
    expect(changed).toEqual([]);
  });

  // Bug caught: resumed stays true after the first run, or is never set, so a cache is rebuilt every frame or never.
  it("resumed is true on the first run after a skip, and only then", () => {
    const world = createMockWorld();
    const seen = trace();

    addFeature(world, "board", [counter("board.looks", "animate", seen)], "active");
    world.start();

    const released = world.api.ecs.hold("board");

    world.frame();
    released();
    world.frame();
    world.frame();

    const again = world.api.ecs.hold("board");

    world.frame();
    world.frame();
    again();

    expect(seen.resumed).toEqual([false, true, false]);
  });

  // Bug caught: a frame skipped by the mode counts as a skip for scope, or an always system reads true.
  it("resumed is false for a system that always runs and after a frame skipped by pause", () => {
    const world = createMockWorld();
    const scoped = trace();
    const always = trace();

    addFeature(world, "board", [counter("board.looks", "animate", scoped)], "active");
    addFeature(world, "hud", [counter("hud.pulse", "animate", always)]);
    world.start();
    world.api.ecs.hold("board");
    world.frame();
    world.api.ecs.setMode("paused");
    world.frame();
    world.api.ecs.setMode("live");
    world.frame();

    expect(scoped.resumed).toEqual([false, false]);
    expect(always.resumed).toEqual([false, false]);
  });

  // Bug caught: a woken system is appended at the end of its phase, so the order of the frame changes.
  it("a skipped system keeps its slot", () => {
    const world = createMockWorld();
    const seen = trace();

    addFeature(world, "hud", [counter("A", "layout", seen)]);
    addFeature(world, "board", [counter("B", "layout", seen)], "active");
    addFeature(world, "orders", [counter("C", "layout", seen)]);
    world.start();
    world.frame();

    expect(seen.runs).toEqual(["A", "C"]);

    seen.runs.length = 0;
    world.api.ecs.hold("board");
    world.frame();

    expect(seen.runs).toEqual(["A", "B", "C"]);
  });

  // Bug caught: the scope is evaluated every phase also when no feature asked for it.
  it("a game without a scoped system never reads the flow stack for the scope", () => {
    const world = createMockWorld();
    const seen = trace();

    world.flow.owners = { board: { awaitIntent: "board" } };
    addFeature(world, "board", [counter("board.looks", "animate", seen)]);
    world.start();
    world.flow.stack = [at("board", "awaitIntent")];

    for (let frame = 0; frame < 100; frame += 1) world.frame();

    expect(world.flow.describe).not.toHaveBeenCalled();
    expect(seen.runs).toHaveLength(100);
    expect(world.api.ecs.isActive("board")).toBe(true);
  });

  // Bug caught: describe() is called per phase or per stack move, a graph walk every frame.
  it("the owner table is built once", () => {
    const world = createMockWorld();

    world.flow.owners = { board: { a: "board", b: "board" } };
    addFeature(world, "board", [counter("board.looks", "input", trace())], "active");
    world.start();

    for (let move = 0; move < 50; move += 1) {
      world.flow.stack = [at("board", move % 2 === 0 ? "a" : "b")];
      world.frame();
    }

    expect(world.flow.describe).toHaveBeenCalledTimes(1);
  });

  // Bug caught: a describe that throws stops every scoped system, or logs every frame.
  it("a describe that throws keeps every feature active while the stack is not empty", () => {
    const world = createMockWorld();
    const seen = trace();

    world.flow.describe.mockImplementation(() => {
      throw new Error("graph broke");
    });
    addFeature(world, "board", [counter("board.looks", "animate", seen)], "active");
    world.start();
    world.frame();

    expect(seen.runs).toEqual([]);

    world.flow.stack = [at("main", "home")];
    world.frame();
    world.flow.stack = [at("main", "away")];
    world.frame();

    expect(seen.runs).toEqual(["board.looks", "board.looks"]);
    expect(world.log.error).toHaveBeenCalledTimes(1);
    expect(world.log.error).toHaveBeenCalledWith(
      "world:scope-owners-failed",
      {},
      new Error("graph broke")
    );
  });

  // Bug caught: the active set is read again inside the phase, so a hold of an input system wakes a later input system.
  it("a source that moves inside a phase counts from the next phase", () => {
    const world = createMockWorld();
    const seen = trace();
    const holder: { release: (() => void) | undefined } = { release: undefined };

    addFeature(world, "hud", [
      counter("holder", "input", trace(), () => {
        holder.release ??= world.api.ecs.hold("board");
      }),
      counter("releaser", "layout", trace(), () => {
        if (seen.runs.length === 4) holder.release?.();
      })
    ]);
    addFeature(
      world,
      "board",
      [
        counter("input", "input", seen),
        counter("animate", "animate", seen),
        counter("sync", "sync", seen)
      ],
      "active"
    );
    world.start();
    world.frame();

    // The hold of an input system: the later input system of the same phase still sleeps, the
    // animate system of the same frame runs.
    expect(seen.runs).toEqual(["animate", "sync"]);

    world.frame();

    // The release of a layout system: the sync system of the same frame sleeps.
    expect(seen.runs).toEqual(["animate", "sync", "input", "animate"]);
  });
});

describe("registration", () => {
  // Bug caught: a value the world does not know throws at start or silently skips the systems.
  it("an unknown systemsRun value registers the systems as always and warns", () => {
    const world = createMockWorld();
    const seen = trace();

    world.features.push({
      name: "board",
      description: {
        scenes: [{ id: "board" }],
        systems: [counter("board.looks", "animate", seen)],
        systemsRun: "scene"
      } as unknown as FeatureDescription
    });
    world.start();
    world.frame();
    world.frame();

    expect(seen.runs).toHaveLength(2);
    expect(world.log.warn).toHaveBeenCalledWith("world:bad-feature-entry", {
      feature: "board",
      key: "systemsRun"
    });
  });

  // Bug caught: a kit marked active whose systems serve its siblings never runs, and nobody is told.
  it("a feature that nothing can make active is reported in dev", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const world = createMockWorld();

    addFeature(world, "episodes-kit", [counter("kit.tick", "animate", trace())], "active", {});
    addFeature(world, "shop", [counter("shop.tick", "animate", trace())], "active", {
      projections: [boardItems()]
    });
    world.start();

    const warned = vi
      .mocked(world.log.warn)
      .mock.calls.filter(([event]) => event === "world:feature-never-active");

    expect(warned).toHaveLength(1);
    expect(warned[0]?.[1]).toMatchObject({ feature: "episodes-kit" });
  });
});
