import { describe, expect, expectTypeOf, it } from "vitest";
import { createApp } from "../../../../index";
import { read } from "../../../flow/doors/read";
import { component } from "../../ecs/define";
import type { EntitySnapshot, Owner, WorldSnapshot } from "../../ecs/types";
import { entitiesSource, projectionsSource } from "../../inspect";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the world sources of the /inspect door over the real ecs and
// projection modules of the mock world
// ---------------------------------------------------------------------------

const Position = component("Position", { x: 0, y: 0 });
const Display = component("Display", { object: {} as unknown });
const items: Owner = { kind: "projection", name: "board.items" };
const hud: Owner = { kind: "plugin", name: "ui" };

/**
 * The world of a small board: two items with a position, one of them drawn, and a HUD element
 * published under a key.
 *
 * @returns The mock world, the app that reads it and the three entities.
 */
function board(): {
  world: MockWorld;
  app: ReturnType<typeof createApp> & { world: MockWorld["api"] };
  first: number;
  second: number;
  coins: number;
} {
  const world = createMockWorld();
  const first = world.api.ecs.spawn(items, [Position({ x: 1 }), Display({ object: () => 1 })]);
  const second = world.api.ecs.spawn(items, [Position({ x: 2 })]);
  const coins = world.api.ecs.spawn(hud, []);

  world.api.projection.registerKey("board.items", "i5", first);
  world.api.projection.registerKey("board.items", "i7", second);
  world.api.projection.registerKey("hud", "coins", coins);

  return { world, app: { ...createApp(), world: world.api }, first, second, coins };
}

describe("ecs.snapshot", () => {
  it("types its entities as EntitySnapshot", () => {
    const { app } = board();

    expectTypeOf(app.world.ecs.snapshot()).toEqualTypeOf<WorldSnapshot>();
    expectTypeOf(app.world.ecs.snapshot().entities).toEqualTypeOf<EntitySnapshot[]>();
    expectTypeOf<EntitySnapshot["owner"]>().toEqualTypeOf<Owner>();
  });
});

describe("game.entities", () => {
  it("is a frame source that reads every entity with no filter", () => {
    const { app, first, second, coins } = board();

    expect(entitiesSource.id).toBe("game.entities");
    expect(entitiesSource.changes).toBe("frame");
    expect(read(app, entitiesSource).map(entity => entity.id)).toEqual([first, second, coins]);
  });

  it("keeps the entities of one owner", () => {
    const { app, coins } = board();

    expect(read(app, entitiesSource, { owner: "ui" })).toEqual([
      {
        id: coins,
        index: 2,
        generation: 1,
        owner: hud,
        components: {},
        skipped: []
      }
    ]);
  });

  it("keeps the entities that carry a component, JSON or skipped", () => {
    const { app, first, second } = board();

    expect(read(app, entitiesSource, { component: "Position" }).map(entity => entity.id)).toEqual([
      first,
      second
    ]);
    expect(read(app, entitiesSource, { component: "Display" })).toMatchObject([
      { id: first, skipped: ["Display"] }
    ]);
  });

  it("applies both filters together", () => {
    const { app } = board();

    expect(read(app, entitiesSource, { owner: "ui", component: "Position" })).toEqual([]);
    expect(read(app, entitiesSource, { owner: "nobody" })).toEqual([]);
  });
});

describe("game.projections", () => {
  it("is a commit source that maps every projection key to its live entity", () => {
    const { app, first, second, coins } = board();

    expect(projectionsSource.id).toBe("game.projections");
    expect(projectionsSource.changes).toBe("commit");
    expect(read(app, projectionsSource)).toEqual({
      "board.items": { i5: first, i7: second },
      hud: { coins }
    });
  });

  it("leaves out an entity with no key and a key whose entity left", () => {
    const { world, app, second } = board();

    world.api.ecs.spawn(items, [Position({ x: 3 })]);
    world.api.ecs.despawn(second);

    expect(read(app, projectionsSource)["board.items"]).not.toHaveProperty("i7");
    expect(Object.keys(read(app, projectionsSource)["board.items"] ?? {})).toEqual(["i5"]);
  });

  it("is empty for an empty world", () => {
    const world = createMockWorld();

    expect(read({ ...createApp(), world: world.api }, projectionsSource)).toEqual({});
  });
});

describe("the world sources", () => {
  it("never change the world", () => {
    const { app } = board();
    const before = app.world.ecs.snapshot();

    read(app, entitiesSource, { component: "Position" });
    read(app, projectionsSource);

    expect(app.world.ecs.snapshot()).toEqual(before);
  });
});
