/**
 * @file world plugin — the fixtures of the perf tests and benches. Not a test file. Each fixture is
 * built here over the mock world of the unit tests, outside any measured window, and hands back
 * one call of the code under measure. The phases and the sweep run on modules whose `model` and
 * `flow` answer with one kept object, so the mock's own fresh snapshot and flow state never land
 * in a window.
 */
import type { Api as FlowApi } from "../../../flow/types";
import type { Api as ModelApi, Snapshot } from "../../../model/types";
import type { Time } from "../../../time/types";
import { createModules } from "../../api";
import { clearAllChanges, markChanged } from "../../ecs/changes";
import { component, mut, Now, system } from "../../ecs/define";
import type { AnySystem, Entity, Owner, WorldPhase } from "../../ecs/types";
import { withDeps } from "../../lifecycle";
import type { MotionHandle, Track, TweenDriver } from "../../projection/types";
import type { EcsModule, ProjectionModule } from "../../types";
import { type Item, mountBoard } from "../unit/board";
import { createMockWorld, type MockWorld } from "../unit/mock-world";

/** The first term of the walk fixture: every entity carries it. */
const Cell = component("Cell", { x: 0 });

/** The second term of the walk fixture: the entities that match carry it too. */
const Lit = component("Lit", { glow: 0 });

/** A component of three numeric fields, written by a tween as a pose. */
const Spot = component("Spot", { x: 0, y: 0, scale: 1 });

/** A component with a field a plugin owns, so its muted fields join the owned ones. */
const Glow = component("Glow", { x: 0, y: 0, shown: 0 }, { owned: ["shown"] });

/** Owner of every entity a fixture spawns. */
const OWNER: Owner = { kind: "plugin", name: "perf" };

/** Entities of the walk fixture, as in the old probe `query-allocation.test.ts`. */
const ENTITIES = 300;

/** Systems of the walk fixture. */
const SYSTEMS = 40;

/** Systems of the walk fixture whose second term is `mut()`. */
const MUT_SYSTEMS = 10;

/** The four world phases, in frame order. */
const PHASES: readonly WorldPhase[] = ["input", "animate", "layout", "sync"];

/** The model snapshot every frame of a fixture reads: one kept object. */
const SNAPSHOT: Snapshot = Object.freeze({
  player: {},
  session: {},
  rng: { seed: 1, streams: {} }
});

/** The flow state every frame of a fixture reads: live, one kept object. */
const LIVE = Object.freeze({ mode: "live" });

/** A track handle that has ended. */
const ENDED: MotionHandle = {
  finish: (): void => {},
  cancel: (): void => {},
  active: (): boolean => false
};

/** A track handle that runs for good. */
const RUNNING: MotionHandle = {
  finish: (): void => {},
  cancel: (): void => {},
  active: (): boolean => true
};

/** Where a fixture puts what it reads, so no read is optimised away. */
const sink: { entity: Entity; value: unknown; flag: boolean } = {
  entity: 0,
  value: undefined,
  flag: false
};

/**
 * The world modules over the mock world's state, with a `model` and a `flow` that allocate
 * nothing per read.
 *
 * @param world - The mock world.
 * @returns The ecs and projection modules, internal halves included.
 */
function stableModules(world: MockWorld): { ecs: EcsModule; projection: ProjectionModule } {
  const deps = withDeps(world.ctx).deps;
  const model = { store: { snapshot: () => SNAPSHOT } } as unknown as ModelApi;
  const flow = { state: () => LIVE } as unknown as FlowApi;

  return createModules({ ...world.ctx, deps: { ...deps, model, flow } });
}

/**
 * The `Time` of a fixture's frames: a phone's fractional delta, the frame moved by the caller.
 *
 * @returns A mutable frame time past the frame the systems registered in.
 */
function frameTime(): Time {
  return { delta: 16.6, elapsed: 0, scale: 1, frame: 1, idle: false };
}

/**
 * A system of the walk fixture: it reads the entity of every row, as the old probe did.
 *
 * @param index - Its place in the list.
 * @returns The system; the first `MUT_SYSTEMS` mark `Lit`.
 */
function walker(index: number): AnySystem {
  const name = `perf.walk${index}`;

  if (index < MUT_SYSTEMS) {
    return system({
      name,
      phase: "animate",
      query: [Cell, mut(Lit)],
      run: rows => {
        for (const row of rows) sink.entity = row[0];
      }
    });
  }

  return system({
    name,
    phase: "animate",
    query: [Cell, Lit],
    run: rows => {
      for (const row of rows) sink.entity = row[0];
    }
  });
}

/**
 * The twin of the old probe: 300 entities carry `Cell`, `matching` of them `Lit` too, and 40
 * systems of phase `animate` query `[Cell, Lit]`, ten of them with `mut(Lit)`.
 *
 * @param matching - How many entities carry both terms.
 * @returns One frame: phase `animate`, then the clear of phase `signals`.
 */
export function walkFixture(matching: number): () => void {
  const world = createMockWorld();
  const { ecs } = stableModules(world);
  const every = ENTITIES / matching;

  for (let index = 0; index < ENTITIES; index += 1) {
    world.api.ecs.spawn(OWNER, index % every === 0 ? [Cell(), Lit()] : [Cell()]);
  }

  for (let index = 0; index < SYSTEMS; index += 1) world.api.ecs.system(walker(index));

  const time = frameTime();

  return (): void => {
    time.frame += 1;
    ecs.runPhase("animate", time);
    ecs.clearChanges();
  };
}

/**
 * Forty systems in each of the four phases, each with an empty query, reading `res(Now)` and the
 * frame: what a phase costs besides the walks.
 *
 * @returns One frame: the four phases, then the clear of phase `signals`.
 */
export function phasesFixture(): () => void {
  const world = createMockWorld();
  const { ecs } = stableModules(world);

  for (const phase of PHASES) {
    for (let index = 0; index < SYSTEMS; index += 1) {
      world.api.ecs.system(
        system({
          name: `perf.${phase}${index}`,
          phase,
          query: [],
          run: (_rows, { res, time }) => {
            sink.value = res(Now);
            sink.entity = time.frame;
          }
        })
      );
    }
  }

  const time = frameTime();
  const phases = PHASES.length;

  return (): void => {
    time.frame += 1;

    // An index loop: the measured window holds the engine's work only, no iterator of the fixture.
    for (let at = 0; at < phases; at += 1) ecs.runPhase(PHASES[at] ?? "input", time);

    ecs.clearChanges();
  };
}

/**
 * One hundred entities marked changed for one component, then the clear of phase `signals`.
 *
 * @returns One frame of marks and the clear.
 */
export function marksFixture(): () => void {
  const world = createMockWorld();
  const state = world.ctx.state.ecs;
  const entities: Entity[] = [];

  for (let index = 0; index < 100; index += 1) {
    entities.push(world.api.ecs.spawn(OWNER, [Cell()]));
  }

  const count = entities.length;

  return (): void => {
    for (let index = 0; index < count; index += 1) {
      markChanged(state, "Cell", entities[index] ?? 0);
    }

    clearAllChanges(state);
  };
}

/**
 * Walks an iterable of entities as `renderer.sync` walks `ecs.changed()`.
 *
 * @param entities - The entities.
 */
function drain(entities: Iterable<Entity>): void {
  for (const entity of entities) sink.entity = entity;
}

/**
 * `ecs.changed()` of a component nothing marked this frame, walked as its readers walk it.
 *
 * @returns One read and walk.
 */
export function changedIdleFixture(): () => void {
  const world = createMockWorld();
  const { ecs } = stableModules(world);

  ecs.spawn(OWNER, [Cell(), Lit()]);
  ecs.clearChanges();

  return (): void => {
    drain(ecs.changed(Lit));
  };
}

/**
 * The board fixture's items: one per key, spread over the board.
 *
 * @param count - How many.
 * @returns The items.
 */
function boardItems(count: number): Item[] {
  const items: Item[] = [];

  for (let index = 0; index < count; index += 1) {
    items.push({ id: `i${index}`, level: 1, x: index, y: index });
  }

  return items;
}

/**
 * The sweep of phase `animate` over a mounted projection of 300 resting views. With `ending`,
 * that many tracks whose motion ended join the track table before every sweep, as tracks that
 * just finished do.
 *
 * @param ending - Ended tracks per sweep.
 * @returns One sweep.
 */
export function sweepFixture(ending: number): () => void {
  const world = createMockWorld();

  mountBoard(world, boardItems(ENTITIES));
  world.frame(16);

  const { projection } = stableModules(world);
  const state = world.ctx.state.projection;
  const ended: Track[] = [];

  for (let index = 0; index < ending; index += 1) {
    ended.push({ entity: index, component: "Transform", handle: ENDED, additive: false });
  }

  const count = ended.length;

  return (): void => {
    for (let index = 0; index < count; index += 1) {
      const track = ended[index];

      if (track !== undefined) state.tracks.push(track);
    }

    projection.sweep();
  };
}

/**
 * Fifty tracks running on fifty elements, each asking for its muted fields as a driver does on
 * every frame. With `owned`, the component gives a field to a plugin and each element mutes one
 * more field; without, nothing is muted.
 *
 * @param owned - Whether the fields join a mute and an owned field.
 * @returns One frame of the fifty asks.
 */
export function mutedFixture(owned: boolean): () => void {
  const world = createMockWorld();
  const asks: Array<() => ReadonlySet<string>> = [];
  const driver: TweenDriver = {
    track: (_entity, _component, _to, _options, muted) => {
      asks.push(muted);

      return RUNNING;
    },
    cancelAll: (): void => {}
  };

  world.api.projection.setDriver(driver);

  for (let index = 0; index < 50; index += 1) {
    const entity = world.api.ecs.spawn(OWNER, [owned ? Glow() : Cell()]);
    const handle = world.api.projection.viewOf(entity, OWNER);

    if (owned) {
      handle?.tween(Glow, { x: 10 }, { ms: 1000, ease: "linear" });
      world.api.projection.mute(entity, Glow, ["y"]);
    } else {
      handle?.tween(Cell, { x: 10 }, { ms: 1000, ease: "linear" });
    }
  }

  const count = asks.length;

  return (): void => {
    for (let index = 0; index < count; index += 1) {
      sink.flag = asks[index]?.().has("x") === true;
    }
  };
}

/** The calls a game makes every frame, each on one world of one entity. */
export type EcsCalls = {
  get(): void;
  set(): void;
  setThree(): void;
  setInteger(): void;
  has(): void;
  res(): void;
};

/**
 * `ecs.get`, `ecs.set` of one double field, of three double fields and of one integer field,
 * `ecs.has` and `ecs.resource(Now)` on one entity, through the public API. The patches are made
 * once, here: the caller's patch is the caller's.
 *
 * @returns One call of each.
 */
export function ecsCallsFixture(): EcsCalls {
  const world = createMockWorld();
  const ecs = world.api.ecs;
  const entity = ecs.spawn(OWNER, [Cell(), Lit(), Spot()]);
  const patch = { x: 0.5 };
  const pose = { x: 0.5, y: 1.5, scale: 1.25 };
  const whole = { glow: 3 };

  return {
    get: (): void => {
      sink.value = ecs.get(entity, Cell);
    },
    set: (): void => {
      ecs.set(entity, Cell, patch);
    },
    setThree: (): void => {
      ecs.set(entity, Spot, pose);
    },
    setInteger: (): void => {
      ecs.set(entity, Lit, whole);
    },
    has: (): void => {
      sink.flag = ecs.has(entity, Lit);
    },
    res: (): void => {
      sink.value = ecs.resource(Now);
    }
  };
}

/** A tag on the few entities an outer query of the nested case walks. */
const Picked = component("Picked", { at: 0 });

/**
 * Walks every row of an `ecs.query()` as a game does, reading the entity.
 *
 * @param rows - The rows.
 */
function readRows(rows: Iterable<readonly unknown[]>): void {
  for (const row of rows) sink.value = row[0];
}

/**
 * `ecs.query(Cell, Lit)` outside a phase over 300 entities of which 30 carry both, as a game
 * calls it every frame. Rows stay fresh: the measure holds 30 rows and a walk.
 *
 * @returns One query, walked.
 */
export function queryFixture(): () => void {
  const world = createMockWorld();
  const ecs = world.api.ecs;

  for (let index = 0; index < ENTITIES; index += 1) {
    ecs.spawn(OWNER, index % 10 === 0 ? [Cell(), Lit()] : [Cell()]);
  }

  return (): void => {
    readRows(ecs.query(Cell, Lit));
  };
}

/**
 * The rows alone the query fixture yields: 30 fresh rows of three entries, the yardstick of its
 * budget.
 *
 * @returns One call making 30 rows.
 */
export function rowsFixture(): () => void {
  const cell = Cell().value;
  const lit = Lit().value;

  return (): void => {
    for (let index = 0; index < 30; index += 1) sink.value = [index, cell, lit];
  };
}

/**
 * A query nested in another query's loop: five picked entities walked outside a phase, and for
 * each `ecs.query(Cell, Lit)` over the 300 entities, 30 matching.
 *
 * @returns One outer query with its five inner ones, walked.
 */
export function nestedQueryFixture(): () => void {
  const world = createMockWorld();
  const ecs = world.api.ecs;

  for (let index = 0; index < ENTITIES; index += 1) {
    const picked = index % 60 === 0;

    ecs.spawn(OWNER, index % 10 === 0 ? [Cell(), Lit(), ...(picked ? [Picked()] : [])] : [Cell()]);
  }

  return (): void => {
    for (const outer of ecs.query(Picked)) {
      sink.value = outer[0];
      readRows(ecs.query(Cell, Lit));
    }
  };
}
