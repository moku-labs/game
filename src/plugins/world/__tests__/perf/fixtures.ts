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
import { component, Exiting, mut, Now, system } from "../../ecs/define";
import { recordFrame } from "../../ecs/history";
import type { AnySystem, Entity, Owner, WorldPhase } from "../../ecs/types";
import { withDeps } from "../../lifecycle";
import { projection } from "../../projection/define";
import type {
  AnyProjectionSpec,
  DescriptionNode,
  MotionHandle,
  Track,
  TweenDriver
} from "../../projection/types";
import type { EcsModule, ProjectionModule } from "../../types";
import { BOARD, type Item, LAYERS, MOUNT_OWNER, mountBoard, settleFrames } from "../unit/board";
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
const sink: { entity: Entity; value: unknown; flag: boolean; ms: number } = {
  entity: 0,
  value: undefined,
  flag: false,
  ms: 0
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
    ended.push({
      entity: index,
      component: "Transform",
      handle: ENDED,
      additive: false,
      forever: false
    });
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

/** A timer ring (F91): `sweep` is drawn by a system after the birth, `shown` belongs to a plugin. */
const Dial = component("Dial", { sweep: 1, alpha: 1, shown: 0 }, { owned: ["shown"] });

/** Name of the rings projection. */
const RINGS = "perf.rings";

/** One ring of the rings projection. */
type Ring = { id: string };

/**
 * The rings projection: every ring fades in when a commit brings it, and its `sweep` is another
 * writer's from the birth on.
 *
 * @returns The spec.
 */
function ringsSpec(): AnyProjectionSpec {
  return projection({
    name: RINGS,
    layer: "items",
    from: (player: { rings: Ring[] }) => player.rings,
    key: (ring: Ring) => ring.id,
    view: () => [Dial()],
    motion: { enter: view => view.tween(Dial, { alpha: 1 }, { ms: 200, ease: "linear" }) },
    initialOnly: [[Dial, ["sweep"]]]
  }) as AnyProjectionSpec;
}

/**
 * Mounts the rings projection empty, then commits `count` rings, so each is born in play mode and
 * starts its fade.
 *
 * @param world - The mock world.
 * @param count - How many rings.
 */
function mountRings(world: MockWorld, count: number): void {
  const rings: Ring[] = [];

  for (let index = 0; index < count; index += 1) rings.push({ id: `r${index}` });

  world.model.player = { rings: [] };
  world.api.projection.setLayers(LAYERS);
  world.api.projection.register(ringsSpec());
  world.start();
  world.api.projection.mount([RINGS], MOUNT_OWNER);
  world.model.player = { rings };
  world.commit();
  world.frame(16);
}

/**
 * Fifty rings fading in, each fade asking for the muted fields of its view as a driver does on
 * every frame: the `initialOnly` seed of the projection joined with the field the type owns.
 *
 * @returns One frame of the fifty asks.
 */
export function initialOnlyAsksFixture(): () => void {
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
  mountRings(world, 50);

  const count = asks.length;

  return (): void => {
    for (let index = 0; index < count; index += 1) {
      sink.flag = asks[index]?.().has("sweep") === true;
    }
  };
}

/**
 * The sweep of a still frame over 300 rings whose fade ended while a system had drawn their
 * `sweep` off the rest pose: the check at the end of the fade ran and corrected nothing, and now
 * nothing moves.
 *
 * @returns One sweep.
 */
export function initialOnlyStillFixture(): () => void {
  const world = createMockWorld();

  mountRings(world, ENTITIES);

  for (const entity of world.api.projection.entitiesOf(RINGS)) {
    world.api.ecs.set(entity, Dial, { sweep: 0.42 });
  }

  settleFrames(world);

  const { projection: module } = stableModules(world);

  return (): void => {
    module.sweep();
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
 * The rows alone a query fixture yields, made in the same process as the query: the yardstick of
 * its budget. `wide` rows of three entries, as `query(Cell, Lit)` yields, and `narrow` rows of two,
 * as `query(Picked)` yields.
 *
 * @param wide - Rows of the entity and two values.
 * @param narrow - Rows of the entity and one value.
 * @returns One call making those rows.
 */
export function rowsFixture(wide: number, narrow = 0): () => void {
  const cell = Cell().value;
  const lit = Lit().value;

  return (): void => {
    for (let index = 0; index < wide; index += 1) sink.value = [index, cell, lit];
    for (let index = 0; index < narrow; index += 1) sink.value = [index, cell];
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

/** A term of the skip fixtures that no entity carries any more: its store is there and empty. */
const Ghost = component("Ghost", { at: 0 });

/** One frame of a skip fixture and how often its systems ran. */
export type SkipFrame = { frame: () => void; runs: () => number };

/**
 * Forty systems of phase `animate` over `[Cell, mut(Ghost)]`: 300 entities carry `Cell`, and the
 * one entity that carried `Ghost` was despawned, so the smallest store among the terms is empty.
 * Before the skip each of them walked the 300 keys of `Cell` and found nothing.
 *
 * @returns One frame of the four phases and the clear, and the count of the runs.
 */
export function emptyQueryFixture(): SkipFrame {
  const world = createMockWorld();
  const { ecs } = stableModules(world);
  const counted = { runs: 0 };

  for (let index = 0; index < ENTITIES; index += 1) ecs.spawn(OWNER, [Cell()]);
  ecs.despawn(ecs.spawn(OWNER, [Ghost()]));

  for (let index = 0; index < SYSTEMS; index += 1) {
    ecs.system(
      system({
        name: `perf.ghost${index}`,
        phase: "animate",
        query: [Cell, mut(Ghost)],
        run: rows => {
          counted.runs += 1;

          for (const row of rows) sink.entity = row[0];
        }
      })
    );
  }

  const time = frameTime();

  return { frame: () => runFrame(ecs, time), runs: (): number => counted.runs };
}

/**
 * Runs the four phases of one frame and the clear of phase `signals`.
 *
 * @param ecs - The ecs module of the fixture.
 * @param time - The fixture's frame time, moved here.
 */
function runFrame(ecs: EcsModule, time: Time): void {
  time.frame += 1;

  // An index loop: the measured window holds the engine's work only, no iterator of the fixture.
  for (let at = 0; at < PHASES.length; at += 1) ecs.runPhase(PHASES[at] ?? "input", time);

  ecs.clearChanges();
}

/**
 * Forty systems of phase `animate` over `[Cell, Lit]`, every store filled, whose `run` reads no
 * row: a frame of them costs the check before each run and the call, nothing else. With
 * `withScenes`, half of them run on the mounted scene `board`, half on the scene `ward`, which
 * leaves while one entity still carries `Exiting`: the check reads the stores of two terms, the
 * mounted scene and the list of the leaving ones.
 *
 * @param withScenes - Whether the systems list `scenes`.
 * @returns One frame of the four phases and the clear, and the count of the runs.
 */
export function skipCheckFixture(withScenes = true): SkipFrame {
  const world = createMockWorld();
  const { ecs } = stableModules(world);
  const counted = { runs: 0 };

  for (let index = 0; index < ENTITIES; index += 1) {
    ecs.spawn(OWNER, index % 10 === 0 ? [Cell(), Lit()] : [Cell()]);
  }

  ecs.spawn(OWNER, [Exiting()]);

  for (let index = 0; index < SYSTEMS; index += 1) {
    ecs.system(
      system({
        name: `perf.check${index}`,
        phase: "animate",
        query: [Cell, Lit],
        ...(withScenes ? { scenes: [index % 2 === 0 ? "board" : "ward"] } : {}),
        run: () => {
          counted.runs += 1;
        }
      })
    );
  }

  ecs.setScene("ward");
  ecs.setScene("board");

  const time = frameTime();

  return { frame: () => runFrame(ecs, time), runs: (): number => counted.runs };
}

/**
 * Forty systems of phase `animate` over `[Cell]`, every store filled, that run on the scene
 * `board` while the ward is mounted and nothing leaves: each is skipped for its scenes.
 *
 * @returns One frame of the four phases and the clear, and the count of the runs.
 */
export function sceneSkipFixture(): SkipFrame {
  const world = createMockWorld();
  const { ecs } = stableModules(world);
  const counted = { runs: 0 };

  for (let index = 0; index < ENTITIES; index += 1) ecs.spawn(OWNER, [Cell()]);

  for (let index = 0; index < SYSTEMS; index += 1) {
    ecs.system(
      system({
        name: `perf.board${index}`,
        phase: "animate",
        query: [Cell],
        scenes: ["board"],
        run: rows => {
          counted.runs += 1;

          for (const row of rows) sink.entity = row[0];
        }
      })
    );
  }

  ecs.setScene("ward");

  const time = frameTime();

  return { frame: () => runFrame(ecs, time), runs: (): number => counted.runs };
}

/** Calls before a measure, so a tier-up of V8 never falls inside one of `alloc`'s windows. */
const SETTLE = 30_000;

/**
 * Runs a fixture until V8 has settled on its code, then hands it back: `alloc` compares two
 * windows, and a tier-up between them reads as a GC inside the window.
 *
 * @param fn - The fixture call.
 * @returns The same call.
 */
export function settled(fn: () => void): () => void {
  for (let call = 0; call < SETTLE; call += 1) fn();

  return fn;
}

/**
 * One recorded frame of a dev build (F70): 100 entities carry a `Spot`, 20 of them move a little and are marked, as a
 * glide or an idle tween writes them, then the recorder of phase `signals` reads the marks and the change sets are
 * cleared. The recording started before the measure.
 *
 * @returns One frame of writes, its record and the clear.
 */
export function recordedFrameFixture(): () => void {
  const world = createMockWorld();
  const state = world.ctx.state.ecs;
  const entities: Entity[] = [];

  for (let index = 0; index < 100; index += 1) {
    entities.push(world.api.ecs.spawn(OWNER, [Spot()]));
  }

  const store = state.stores.get("Spot");
  const ctx = withDeps(world.ctx);
  let frame = 1;

  recordFrame(ctx, frame);
  clearAllChanges(state);

  return (): void => {
    frame += 1;

    for (let index = 0; index < 20; index += 1) {
      const entity = entities[index * 5] ?? 0;
      const spot = store?.get(entity) as { x: number } | undefined;

      if (spot !== undefined) spot.x = frame % 1000;
      markChanged(state, "Spot", entity);
    }

    recordFrame(ctx, frame);
    clearAllChanges(state);
  };
}

/** The frame calls of a scene build (F61 S2) that ui, renderer, scenes and world make every frame. */
export type BuildCalls = {
  left(): void;
  isBuilding(): void;
  built(): void;
  startFrame(): void;
};

/**
 * `projection.left()`, `isBuilding(entity)`, `built()` and the frame start of phase `input`, with or without a
 * running build. The building world holds a build of 300 board items and two `onBuild` checks that answer true, as
 * ui and renderer register them; `isBuilding` asks about one of its views. The idle world built nothing.
 *
 * @param building - Whether a build runs.
 * @returns One call of each.
 */
export function buildCallsFixture(building: boolean): BuildCalls {
  const world = createMockWorld();

  mountBoard(world, []);
  world.api.projection.unmount([BOARD]);
  world.model.player = { items: boardItems(ENTITIES) };
  world.api.projection.onBuild(() => true);
  world.api.projection.onBuild(() => sink.ms < Number.POSITIVE_INFINITY);
  if (building) world.api.projection.build([BOARD], MOUNT_OWNER, LAYERS, 4);

  const { projection } = stableModules(world);
  const entity = projection.entitiesOf(BOARD)[0] ?? 0;
  const now = world.clock.now();

  // The building calls must measure the building path, not the idle one.
  if (projection.isBuilding(entity) !== building || projection.built() !== building) {
    throw new Error("buildCallsFixture: the build did not start as asked");
  }

  return {
    left: (): void => {
      sink.ms = projection.left();
    },
    isBuilding: (): void => {
      sink.flag = projection.isBuilding(entity);
    },
    built: (): void => {
      sink.flag = projection.built();
    },
    startFrame: (): void => {
      projection.startFrame(now);
    }
  };
}

/** Name of the warm sheet of the warm fixtures. */
const SHEET = "perf.sheet";

/** One item of the warm sheet. */
type Sheet = { id: string; page: string };

/** The session the warm sheet reads: open on a page, or closed. */
type SheetSession = { sheet?: string };

/** The state with the sheet closed: one kept object, as a frame at rest reads it. */
const CLOSED: Snapshot = Object.freeze({
  player: {},
  session: {},
  rng: { seed: 1, streams: {} }
});

/** The state with the sheet open on its main page: one kept object. */
const OPEN: Snapshot = Object.freeze({
  player: {},
  session: { sheet: "main" },
  rng: { seed: 1, streams: {} }
});

/**
 * The warm sheet: shown while `session.sheet` is set, kept warm on its main page. Its view is a screen of 20 rows,
 * as a settings sheet draws.
 *
 * @returns The spec.
 */
function sheetSpec(): AnyProjectionSpec {
  return projection({
    name: SHEET,
    layer: "items",
    from: (_player: unknown, session: SheetSession): Sheet[] =>
      session.sheet === undefined ? [] : [{ id: "sheet", page: session.sheet }],
    key: (sheet: Sheet) => sheet.id,
    view: (sheet: Sheet): DescriptionNode => ({
      type: "sheet",
      props: { page: sheet.page },
      children: Array.from({ length: 20 }, (_, row) => ({
        type: "row",
        props: { row },
        children: []
      }))
    }),
    warm: () => ({ id: "sheet", page: "main" })
  }) as AnyProjectionSpec;
}

/** The calls of a frame with a warm window that world makes, and what ui and the renderer ask. */
export type WarmCalls = {
  step(): void;
  input(): void;
  left(): void;
  isBuilding(): void;
};

/**
 * World's warm calls with the sheet held: at rest (the held view ready and nothing to do) or while it builds (its two
 * `onBuild` checks answer false, so every step polls them). The state and the flow answer one kept object.
 *
 * @param building - Whether the held view is still being built.
 * @returns One call of each.
 */
export function warmCallsFixture(building: boolean): WarmCalls {
  const world = createMockWorld();
  const done = { ui: !building, renderer: !building };

  world.api.projection.setLayers(LAYERS);
  world.api.projection.register(sheetSpec());
  world.start();
  world.api.projection.onBuild(() => done.ui);
  world.api.projection.onBuild(() => done.renderer);
  world.api.projection.mount([SHEET], MOUNT_OWNER);

  const deps = withDeps(world.ctx).deps;
  const model = { store: { snapshot: () => CLOSED } } as unknown as ModelApi;
  const flow = { state: () => LIVE } as unknown as FlowApi;
  const { projection } = createModules({ ...world.ctx, deps: { ...deps, model, flow } });

  // The spawn, the poll, and a walk that finds no more work.
  projection.stepWarm();
  projection.stepWarm();
  projection.stepWarm();

  const state = world.ctx.state.projection;
  const held = state.warm.get(SHEET)?.view?.entity ?? 0;
  const now = world.clock.now();
  const rests = state.warmActive === undefined && !state.warmStale;

  // The calls must measure the path they name: a sheet held, at rest or in work.
  if (!projection.isBuilding(held) || rests === building) {
    throw new Error("warmCallsFixture: the sheet is not held as asked");
  }

  return {
    step: (): void => {
      projection.stepWarm();
    },
    input: (): void => {
      projection.startFrame(now);
      projection.reconcileIfDirty();
      projection.stepWarm();
    },
    left: (): void => {
      sink.ms = projection.left();
    },
    isBuilding: (): void => {
      sink.flag = projection.isBuilding(held);
    }
  };
}

/** The elements `adopt` marks for the held sheet of the prune fixture: a shop's worth. */
const HELD_ELEMENTS = 600;

/**
 * The sweep of a frame that despawned an entity while the warm sheet is held ready with 600 elements `adopt` marked
 * for it: the prune walks every held entity and finds none gone. The state and the flow answer one kept object.
 *
 * @returns One sweep after a despawn.
 */
export function warmPruneFixture(): () => void {
  const world = createMockWorld();
  const done = { parts: false };

  world.api.projection.setLayers(LAYERS);
  world.api.projection.register(sheetSpec());
  world.start();
  world.api.projection.onBuild(() => done.parts);
  world.api.projection.mount([SHEET], MOUNT_OWNER);

  const deps = withDeps(world.ctx).deps;
  const model = { store: { snapshot: () => CLOSED } } as unknown as ModelApi;
  const flow = { state: () => LIVE } as unknown as FlowApi;
  const { projection } = createModules({ ...world.ctx, deps: { ...deps, model, flow } });

  // The spawn, the elements of the held root, then the poll that finds it ready.
  projection.stepWarm();
  for (let index = 0; index < HELD_ELEMENTS; index += 1) {
    projection.adopt(world.api.ecs.spawn({ kind: "plugin", name: "ui" }, []));
  }
  done.parts = true;
  projection.stepWarm();

  const state = world.ctx.state;

  // The call must measure the path it names: a ready sheet that holds its view and every element.
  if (
    state.projection.warmHeld.size !== HELD_ELEMENTS + 1 ||
    state.projection.warmActive !== undefined
  ) {
    throw new Error("warmPruneFixture: the sheet does not hold its elements");
  }

  return (): void => {
    state.ecs.despawns += 1;
    projection.sweep();
  };
}

/**
 * One open and one close of the warm sheet, with its rebuild: the commit that opens it shows the held view, the commit
 * that closes it takes it apart, and the next steps build it again and find it ready. No renderer and no ui: the
 * world's part of a tap on the settings button and of the close.
 *
 * @returns One open, close and rebuild.
 */
export function warmOpenFixture(): () => void {
  const world = createMockWorld();
  const current = { snapshot: CLOSED };

  world.api.projection.setLayers(LAYERS);
  world.api.projection.register(sheetSpec());
  world.start();
  world.api.projection.onBuild(() => true);
  world.api.projection.mount([SHEET], MOUNT_OWNER);

  const deps = withDeps(world.ctx).deps;
  const model = { store: { snapshot: () => current.snapshot } } as unknown as ModelApi;
  const flow = { state: () => LIVE } as unknown as FlowApi;
  const { projection } = createModules({ ...world.ctx, deps: { ...deps, model, flow } });

  projection.stepWarm();
  projection.stepWarm();

  const record = world.ctx.state.projection.warm.get(SHEET);
  const cycle = (): void => {
    current.snapshot = OPEN;
    projection.markDirty(["session"], "edge");
    projection.reconcileIfDirty();
    projection.stepWarm();
    current.snapshot = CLOSED;
    projection.markDirty(["session"], "edge");
    projection.reconcileIfDirty();
    projection.stepWarm();
    projection.stepWarm();
    projection.stepWarm();
    // The sweep of the frame forgets the cause of the view that left.
    projection.sweep();
  };
  const before = record?.view?.entity;

  cycle();

  // The bench must measure an open that shows the held view and a rebuild that holds a new one.
  if (record?.phase !== "ready" || record.view?.entity === before) {
    throw new Error("warmOpenFixture: the sheet was not shown and held again");
  }

  return cycle;
}
