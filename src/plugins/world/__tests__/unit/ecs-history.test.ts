import { afterEach, describe, expect, it, vi } from "vitest";
import { createModules } from "../../api";
import { component, mut, system, tag } from "../../ecs/define";
import { HISTORY_FRAMES } from "../../ecs/history";
import type { Entity, HistoryChange, Owner } from "../../ecs/types";
import { clearWorld, withDeps } from "../../lifecycle";
import { BOARD, commitItems, Level, mountBoard } from "./board";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the dev-only frame history of the ecs module and `ecs.diff`, over
// the real modules of the mock world
// ---------------------------------------------------------------------------

const Position = component("Position", { x: 0, y: 0 });
const Display = component("Display", { object: (): number => 1 });
const Held = tag("Held");
const Route = component("Route", { stops: [1, 2], via: { gate: "north" } });
const Payload = component("Payload", { data: {} as object });
const owner: Owner = { kind: "plugin", name: "test" };
// eslint-disable-next-line unicorn/no-null -- a history record says "absent" with JSON null
const absent = null;

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A mock world whose frames record: the dev flag is on and the frame callbacks are registered.
 *
 * @returns The started mock world.
 */
function recording(): MockWorld {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);

  const world = createMockWorld();

  world.start();

  return world;
}

/**
 * Runs frames.
 *
 * @param world - The mock world.
 * @param count - How many frames.
 */
function frames(world: MockWorld, count: number): void {
  for (let index = 0; index < count; index += 1) world.frame();
}

/**
 * The change records of one frame, read from the ring.
 *
 * @param world - The mock world.
 * @param frame - The frame number.
 * @returns The records, or `undefined` when the ring holds no slot for that frame.
 */
function changesAt(world: MockWorld, frame: number): HistoryChange[] | undefined {
  const slot = world.ctx.state.ecs.history?.slots[frame % HISTORY_FRAMES];

  return slot?.frame === frame ? slot.changes : undefined;
}

/**
 * How often the recorder logged its start.
 *
 * @param world - The mock world.
 * @returns The number of `world:history-on` entries.
 */
function historyOnLogs(world: MockWorld): number {
  return vi.mocked(world.log.debug).mock.calls.filter(([event]) => event === "world:history-on")
    .length;
}

/**
 * Spawns one positioned entity of the test owner.
 *
 * @param world - The mock world.
 * @param x - Its x.
 * @returns The entity.
 */
function spawnAt(world: MockWorld, x: number): Entity {
  return world.api.ecs.spawn(owner, [Position({ x })]);
}

describe("the frame history", () => {
  it("is off before the first frame, then starts with a shadow of every live entity", () => {
    const world = recording();
    const entity = spawnAt(world, 1);

    expect(world.ctx.state.ecs.history).toBeUndefined();

    frames(world, 2);

    const history = world.ctx.state.ecs.history;

    expect(history?.started).toBe(1);
    expect(history?.newest).toBe(2);
    expect(history?.slots).toHaveLength(HISTORY_FRAMES);
    expect(history?.shadow.get(entity)).toEqual({
      owner,
      components: new Map([["Position", { x: 1, y: 0 }]])
    });
    expect(changesAt(world, 1)).toEqual([]);
    expect(changesAt(world, 2)).toEqual([]);
  });

  it("logs world:history-on once, on the first recorded frame", () => {
    const world = recording();

    frames(world, 3);

    expect(world.log.debug).toHaveBeenCalledWith("world:history-on", { frames: 120 });
    expect(historyOnLogs(world)).toBe(1);
  });

  it("makes one record with from and to for one set", () => {
    const world = recording();
    const entity = spawnAt(world, 1);

    world.frame();
    world.api.ecs.set(entity, Position, { x: 5 });
    world.frame();

    expect(changesAt(world, 2)).toEqual([
      { id: entity, owner, component: "Position", from: { x: 1, y: 0 }, to: { x: 5, y: 0 } }
    ]);
  });

  it("records nothing for a mut query that writes the same value", () => {
    const world = recording();
    const entity = spawnAt(world, 1);

    world.api.ecs.system(
      system({
        name: "still",
        phase: "animate",
        query: [mut(Position)],
        run: entities => {
          for (const [, position] of entities) position.x += 0;
        }
      })
    );
    frames(world, 3);

    expect(world.api.ecs.get(entity, Position)).toEqual({ x: 1, y: 0 });
    expect(changesAt(world, 2)).toEqual([]);
    expect(changesAt(world, 3)).toEqual([]);
  });

  it("records a spawn with from: absent for every JSON component and leaves the others out", () => {
    const world = recording();

    world.frame();

    const entity = world.api.ecs.spawn(owner, [
      Position({ x: 3 }),
      Held(),
      Display({ object: () => 2 })
    ]);

    world.frame();

    expect(changesAt(world, 2)).toEqual([
      { id: entity, owner, component: "Position", from: absent, to: { x: 3, y: 0 } },
      { id: entity, owner, component: "Held", from: absent, to: true }
    ]);
    expect(world.ctx.state.ecs.history?.slots[2]?.spawned).toEqual([entity]);
  });

  it("records a despawn with to: absent and drops the entity from the shadow", () => {
    const world = recording();
    const entity = spawnAt(world, 1);

    world.frame();
    world.api.ecs.despawn(entity);

    expect(world.ctx.state.ecs.history?.shadow.has(entity)).toBe(false);

    world.frame();

    expect(changesAt(world, 2)).toEqual([
      { id: entity, owner, component: "Position", from: { x: 1, y: 0 }, to: absent }
    ]);
    expect(world.ctx.state.ecs.history?.slots[2]?.despawned).toEqual([entity]);
  });

  it("files a despawn inside a frame under that frame", () => {
    const world = recording();
    const entity = spawnAt(world, 1);

    world.api.ecs.system(
      system({
        name: "sweep",
        phase: "layout",
        query: [Position],
        run: (entities, ctx) => {
          if (ctx.time.frame === 3) for (const [gone] of entities) ctx.world.despawn(gone);
        }
      })
    );
    frames(world, 3);

    expect(changesAt(world, 2)).toEqual([]);
    expect(changesAt(world, 3)).toEqual([
      { id: entity, owner, component: "Position", from: { x: 1, y: 0 }, to: absent }
    ]);
  });

  it("records a removed component when it leaves, although the removal clears its change set", () => {
    const world = recording();
    const entity = world.api.ecs.spawn(owner, [Position({ x: 1 }), Held()]);

    world.frame();
    world.api.ecs.untag(entity, Held);
    world.frame();

    expect(changesAt(world, 2)).toEqual([
      { id: entity, owner, component: "Held", from: true, to: absent }
    ]);
    expect(world.ctx.state.ecs.history?.shadow.get(entity)?.components.has("Held")).toBe(false);
  });

  it("keeps a removal and a re-add in one frame as one change", () => {
    const world = recording();
    const entity = spawnAt(world, 1);

    world.frame();
    world.api.ecs.remove(entity, Position);
    world.api.ecs.add(entity, Position({ x: 9 }));
    world.frame();

    expect(world.api.ecs.diff(1, 2).entities).toEqual([
      {
        id: entity,
        owner,
        key: undefined,
        change: "changed",
        components: { Position: { from: { x: 1, y: 0 }, to: { x: 9, y: 0 } } }
      }
    ]);
  });

  it("compares arrays and nested objects by value, not by identity", () => {
    const world = recording();
    const entity = world.api.ecs.spawn(owner, [Route()]);

    world.frame();
    world.api.ecs.set(entity, Route, { stops: [1, 2], via: { gate: "north" } });
    world.frame();
    world.api.ecs.set(entity, Route, { stops: [1, 2, 3] });
    world.frame();
    world.api.ecs.set(entity, Route, { stops: [1, 4, 3], via: { gate: "south" } });
    world.frame();

    expect(changesAt(world, 2)).toEqual([]);
    expect(changesAt(world, 3)?.map(change => change.to)).toEqual([
      { stops: [1, 2, 3], via: { gate: "north" } }
    ]);
    expect(changesAt(world, 4)?.map(change => change.to)).toEqual([
      { stops: [1, 4, 3], via: { gate: "south" } }
    ]);
  });

  it("records a value that stops being JSON as gone, as snapshot() leaves it out", () => {
    const world = recording();
    const entity = world.api.ecs.spawn(owner, [Payload({ data: { coins: 3 } })]);

    world.frame();
    world.api.ecs.set(entity, Payload, { data: new Date(0) });
    world.frame();

    expect(changesAt(world, 2)).toEqual([
      { id: entity, owner, component: "Payload", from: { data: { coins: 3 } }, to: absent }
    ]);
  });

  it("copies what it records, so a later write never changes the past", () => {
    const world = recording();
    const entity = spawnAt(world, 1);

    world.frame();
    world.api.ecs.set(entity, Position, { x: 2 });
    world.frame();
    world.api.ecs.set(entity, Position, { x: 3 });
    world.frame();

    expect(changesAt(world, 2)?.[0]?.to).toEqual({ x: 2, y: 0 });
    expect(changesAt(world, 3)?.[0]).toMatchObject({ from: { x: 2, y: 0 }, to: { x: 3, y: 0 } });
  });

  it("gives every frame a slot and clears the old slot at that index first", () => {
    const world = recording();
    const entity = spawnAt(world, 1);

    world.frame();
    world.api.ecs.set(entity, Position, { x: 2 });
    frames(world, HISTORY_FRAMES + 1);

    const history = world.ctx.state.ecs.history;

    expect(history?.slots.every(slot => slot !== undefined)).toBe(true);
    expect(history?.slots[2]?.frame).toBe(HISTORY_FRAMES + 2);
    expect(changesAt(world, HISTORY_FRAMES + 2)).toEqual([]);
  });

  it("records nothing in a production build, and diff says it needs a dev build", () => {
    const world = createMockWorld();
    const entity = spawnAt(world, 1);

    world.start();
    frames(world, 2);
    world.api.ecs.set(entity, Position, { x: 2 });
    world.frame();
    world.api.ecs.despawn(entity);

    expect(world.ctx.state.ecs.history).toBeUndefined();
    expect(historyOnLogs(world)).toBe(0);
    expect(() => world.api.ecs.diff(1, 2)).toThrow(
      "[game] game.diff needs a dev build.\n  Define __MOKU_GAME_DEV__ as true in the dev build."
    );
  });
});

describe("ecs.diff", () => {
  it("folds the window: the first from, the last to, spawned, despawned and changed", () => {
    const world = recording();
    const stays = spawnAt(world, 1);
    const leaves = spawnAt(world, 5);

    world.frame();
    world.api.ecs.set(stays, Position, { x: 2 });

    const comes = spawnAt(world, 7);

    world.frame();
    world.api.ecs.set(stays, Position, { x: 3 });
    world.api.ecs.despawn(leaves);

    const flashes = spawnAt(world, 8);

    world.frame();
    world.api.ecs.despawn(flashes);
    world.frame();

    expect(world.api.ecs.diff(1, 4)).toEqual({
      from: 1,
      to: 4,
      entities: [
        {
          id: stays,
          owner,
          key: undefined,
          change: "changed",
          components: { Position: { from: { x: 1, y: 0 }, to: { x: 3, y: 0 } } }
        },
        {
          id: leaves,
          owner,
          key: undefined,
          change: "despawned",
          components: { Position: { from: { x: 5, y: 0 }, to: absent } }
        },
        {
          id: comes,
          owner,
          key: undefined,
          change: "spawned",
          components: { Position: { from: absent, to: { x: 7, y: 0 } } }
        }
      ]
    });
  });

  it("sorts the entities by id, not by the order of the records", () => {
    const world = recording();
    const first = spawnAt(world, 1);
    const second = spawnAt(world, 2);

    world.frame();
    world.api.ecs.despawn(first);

    const reused = spawnAt(world, 3);

    world.api.ecs.set(second, Position, { x: 4 });
    world.frame();

    expect(changesAt(world, 2)?.map(change => change.id)).toEqual([first, reused, second]);
    expect(world.api.ecs.diff(1, 2).entities.map(entity => entity.id)).toEqual([
      first,
      second,
      reused
    ]);
  });

  it("calls a tag added to a live entity a change, not a spawn", () => {
    const world = recording();
    const entity = spawnAt(world, 1);

    world.frame();
    world.api.ecs.tag(entity, Held);
    world.frame();

    expect(world.api.ecs.diff(1, 2).entities).toEqual([
      {
        id: entity,
        owner,
        key: undefined,
        change: "changed",
        components: { Held: { from: absent, to: true } }
      }
    ]);
  });

  it("drops a round trip inside the window, and the entity with it", () => {
    const world = recording();
    const entity = spawnAt(world, 1);

    world.frame();
    world.api.ecs.set(entity, Position, { x: 5 });
    world.frame();
    world.api.ecs.set(entity, Position, { x: 1 });
    world.frame();

    expect(world.api.ecs.diff(1, 3).entities).toEqual([]);
    expect(world.api.ecs.diff(1, 2).entities).toHaveLength(1);
    expect(world.api.ecs.diff(2, 3).entities).toHaveLength(1);
  });

  it("answers an empty diff when from equals to", () => {
    const world = recording();
    const entity = spawnAt(world, 1);

    world.frame();
    world.api.ecs.set(entity, Position, { x: 5 });
    world.frame();

    expect(world.api.ecs.diff(2, 2)).toEqual({ from: 2, to: 2, entities: [] });
  });

  it("names the live projection key and none for an entity that is gone", () => {
    const world = recording();
    const coins = spawnAt(world, 1);
    const popup = spawnAt(world, 2);

    world.api.projection.registerKey("hud", "coins", coins);
    world.api.projection.registerKey("hud", "popup", popup);
    world.frame();
    world.api.ecs.set(coins, Position, { x: 4 });
    world.api.ecs.despawn(popup);
    world.frame();

    expect(world.api.ecs.diff(1, 2).entities.map(entity => entity.key)).toEqual([
      { projection: "hud", key: "coins" },
      undefined
    ]);
  });

  it("keeps the last 120 frames: 121 frames later the first frame throws", () => {
    const world = recording();

    frames(world, HISTORY_FRAMES + 1);

    expect(world.api.ecs.diff(2, HISTORY_FRAMES + 1).entities).toEqual([]);
    expect(() => world.api.ecs.diff(1, HISTORY_FRAMES + 1)).toThrow(
      "[game] game.diff: frame 1 is not in the history.\n  The history keeps the last 120 frames, 2 to 121."
    );
  });

  it("counts a frame before the first recorded one, and one after the newest, as outside", () => {
    const world = recording();

    frames(world, 5);

    expect(() => world.api.ecs.diff(0, 5)).toThrow(
      "[game] game.diff: frame 0 is not in the history.\n  The history keeps the last 120 frames, 1 to 5."
    );
    expect(() => world.api.ecs.diff(1, 6)).toThrow("frame 6 is not in the history");
    expect(() => world.api.ecs.diff(1.5, 3)).toThrow("frame 1.5 is not in the history");
  });

  it("throws when from is after to", () => {
    const world = recording();

    frames(world, 5);

    expect(() => world.api.ecs.diff(4, 2)).toThrow(
      "[game] game.diff: frame 2 is not in the history.\n  The history keeps the last 120 frames, 1 to 5."
    );
  });

  it("answers the scenario of its JSDoc: item i7 merged up to level 3", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const world = createMockWorld();

    mountBoard(world, [
      { id: "i5", level: 1, x: 0, y: 0 },
      { id: "i7", level: 2, x: 100, y: 0 }
    ]);
    frames(world, 120);
    commitItems(world, [
      { id: "i5", level: 1, x: 0, y: 0 },
      { id: "i7", level: 3, x: 100, y: 0 }
    ]);
    frames(world, 60);

    expect(world.api.projection.entityOf(BOARD, "i7")).toBe(1_048_577);
    expect(world.api.ecs.get(1_048_577, Level)).toEqual({ level: 3 });
    expect(world.api.ecs.diff(120, 180)).toEqual({
      from: 120,
      to: 180,
      entities: [
        {
          id: 1_048_577,
          owner: { kind: "projection", name: "board.items" },
          key: { projection: "board.items", key: "i7" },
          change: "changed",
          components: { Level: { from: { level: 2 }, to: { level: 3 } } }
        }
      ]
    });
  });
});

describe("the history reset", () => {
  it("clearWorld empties the shadow and the ring, and diff waits for the next frame", () => {
    const world = recording();

    spawnAt(world, 1);
    frames(world, 3);
    clearWorld(world.ctx.state);

    const history = world.ctx.state.ecs.history;

    expect(history?.shadow.size).toBe(0);
    expect(history?.slots).toHaveLength(HISTORY_FRAMES);
    expect(history?.slots.every(slot => slot === undefined)).toBe(true);
    expect(history?.newest).toBeUndefined();
    expect(history?.started).toBeUndefined();
    expect(() => world.api.ecs.diff(1, 3)).toThrow(
      "[game] game.diff: frame 1 is not in the history.\n  The history keeps the last 120 frames and starts with the next frame."
    );
  });

  it("ecs.clear resets it too, and the next frame starts a new recording", () => {
    const world = recording();
    const entity = spawnAt(world, 1);

    frames(world, 3);
    createModules(withDeps(world.ctx)).ecs.clear();

    expect(world.ctx.state.ecs.history?.newest).toBeUndefined();
    expect(world.ctx.state.ecs.history?.shadow.has(entity)).toBe(false);

    const fresh = spawnAt(world, 4);

    frames(world, 2);

    expect(world.ctx.state.ecs.history?.started).toBe(4);
    expect(world.ctx.state.ecs.history?.shadow.get(fresh)?.components.get("Position")).toEqual({
      x: 4,
      y: 0
    });
    expect(world.api.ecs.diff(4, 5).entities).toEqual([]);
  });
});
