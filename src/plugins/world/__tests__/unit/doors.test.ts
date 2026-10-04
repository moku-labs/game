import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createApp } from "../../../../index";
import { read } from "../../../flow/doors/read";
import { Held } from "../../../input/components";
import { Transform } from "../../../renderer/components";
import { component } from "../../ecs/define";
import type { EntitySnapshot, FrameDiff, Owner, WorldSnapshot } from "../../ecs/types";
import {
  diffSource,
  entitiesSource,
  explainSource,
  projectionsSource,
  schemaSource
} from "../../inspect";
import { projection } from "../../projection/define";
import type { AnyProjectionSpec } from "../../projection/types";
import type { Api, Explained } from "../../types";
import { LAYERS, MOUNT_OWNER } from "./board";
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

/** One item of the sliding board: where it sits on the x axis. */
type Slot = { id: string; x: number };

/**
 * A board of two items drawn with the engine's Transform; a change of x slides the item over
 * 100 ms, linear.
 *
 * @returns The mock world, the app that reads it and the entity of item i7.
 */
function slidingBoard(): {
  world: MockWorld;
  app: ReturnType<typeof createApp> & { world: MockWorld["api"] };
  i7: number;
} {
  const world = createMockWorld();
  const items: Slot[] = [
    { id: "i5", x: 0 },
    { id: "i7", x: 0 }
  ];

  world.model.player = { items } as unknown as Record<string, never>;
  world.api.projection.setLayers(LAYERS);
  world.api.projection.register(
    projection({
      name: "board.items",
      layer: "items",
      from: (player: { items: Slot[] }) => player.items,
      key: (item: Slot) => item.id,
      view: (item: Slot) => [Transform({ x: item.x })],
      motion: {
        change: { Transform: view => view.toRest(Transform, { ms: 100, ease: "linear" }) }
      }
    }) as AnyProjectionSpec
  );
  world.start();
  world.api.projection.mount(["board.items"], MOUNT_OWNER);

  return {
    world,
    app: { ...createApp(), world: world.api },
    i7: world.api.projection.entityOf("board.items", "i7") ?? 0
  };
}

describe("game.explain", () => {
  it("is a frame source that takes one entity", () => {
    expect(explainSource.id).toBe("game.explain");
    expect(explainSource.changes).toBe("frame");
    expect(explainSource.input).toEqual({ entity: "number" });
  });

  it("answers the scenario of its JSDoc: item i7 explained while it slides", () => {
    const { world, app, i7 } = slidingBoard();

    world.model.player = {
      items: [
        { id: "i5", x: 0 },
        { id: "i7", x: 128 }
      ]
    } as unknown as Record<string, never>;
    world.commit();
    world.frame(16);
    world.frame(34);

    expect(i7).toBe(1_048_577);
    expect(read(app, explainSource, { entity: 1_048_577 })).toEqual({
      id: 1_048_577,
      owner: { kind: "projection", name: "board.items" },
      key: { projection: "board.items", key: "i7" },
      components: {
        Transform: { x: 64, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
        Layer: { name: "items" }
      },
      skipped: [],
      motions: ["Transform"]
    });
    expect(read(app, explainSource, { entity: 42 })).toBeUndefined();
  });

  it("explains an entity with no key and no motion, and names what is not JSON", () => {
    const { app, first, coins } = board();

    expect(read(app, explainSource, { entity: coins })).toEqual({
      id: coins,
      owner: hud,
      key: { projection: "hud", key: "coins" },
      components: {},
      skipped: [],
      motions: []
    });
    expect(read(app, explainSource, { entity: first })).toMatchObject({
      components: { Position: { x: 1, y: 0 } },
      skipped: ["Display"]
    });
  });

  it("answers undefined for an entity that is gone, even when its index came back", () => {
    const { world, app, second } = board();

    world.api.ecs.despawn(second);
    world.api.ecs.spawn(items, [Position({ x: 9 })]);

    expect(read(app, explainSource, { entity: second })).toBeUndefined();
  });

  it("types its answer as Explained or undefined", () => {
    const { app } = board();

    expectTypeOf(read(app, explainSource, { entity: 1 })).toEqualTypeOf<Explained | undefined>();
  });
});

describe("game.diff", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a frame source that takes two frames", () => {
    expect(diffSource.id).toBe("game.diff");
    expect(diffSource.changes).toBe("frame");
    expect(diffSource.input).toEqual({ from: "number", to: "number" });
  });

  it("reads ecs.diff of the world it is given", () => {
    const answer: FrameDiff = { from: 120, to: 180, entities: [] };
    const diff = vi.fn((): FrameDiff => answer);
    const world = { ecs: { diff } } as unknown as Api;

    expect(read({ ...createApp(), world }, diffSource, { from: 120, to: 180 })).toBe(answer);
    expect(diff).toHaveBeenCalledWith(120, 180);
  });

  it("answers what changed over the real history of a dev build", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const { world, app, i7 } = slidingBoard();

    world.frame();
    world.model.player = {
      items: [
        { id: "i5", x: 0 },
        { id: "i7", x: 128 }
      ]
    } as unknown as Record<string, never>;
    world.commit();
    for (let frame = 0; frame < 10; frame += 1) world.frame(16);

    expect(read(app, diffSource, { from: 1, to: 11 }).entities).toEqual([
      {
        id: i7,
        owner: { kind: "projection", name: "board.items" },
        key: { projection: "board.items", key: "i7" },
        change: "changed",
        components: {
          Transform: {
            from: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
            to: { x: 128, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }
          }
        }
      }
    ]);
  });

  it("passes the throw of a production build on", () => {
    const { app } = slidingBoard();

    expect(() => read(app, diffSource, { from: 1, to: 2 })).toThrow("needs a dev build");
  });
});

describe("game.schema", () => {
  it("is a frame source with no input", () => {
    expect(schemaSource.id).toBe("game.schema");
    expect(schemaSource.changes).toBe("frame");
    expect(schemaSource.input).toEqual({});
  });

  it("answers the scenario of its JSDoc: a world that met Transform and the tag Held", () => {
    const world = createMockWorld();

    world.api.ecs.spawn(hud, [Transform({ x: 40 }), Held()]);

    expect(read({ ...createApp(), world: world.api }, schemaSource)).toEqual([
      { name: "Held", kind: "tag", json: true, fields: {}, defaults: true, owned: [] },
      {
        name: "Transform",
        kind: "component",
        json: true,
        fields: { x: "number", y: "number", rotation: "number", scale: "number", pivot: "object" },
        defaults: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
        owned: []
      }
    ]);
  });

  it("lists a component whose defaults are not JSON with json: false", () => {
    const world = createMockWorld();
    const Picture = component("Picture", { draw: (): number => 1 });

    world.api.ecs.spawn(hud, [Position(), Picture()]);

    expect(read({ ...createApp(), world: world.api }, schemaSource)).toEqual([
      // eslint-disable-next-line unicorn/no-null -- the schema says null for defaults it cannot carry
      { name: "Picture", kind: "component", json: false, fields: {}, defaults: null, owned: [] },
      {
        name: "Position",
        kind: "component",
        json: true,
        fields: { x: "number", y: "number" },
        defaults: { x: 0, y: 0 },
        owned: []
      }
    ]);
  });
});

describe("the new world sources", () => {
  it("never change the world", () => {
    const { app, first } = board();
    const before = app.world.ecs.snapshot();

    read(app, explainSource, { entity: first });
    read(app, schemaSource);

    expect(app.world.ecs.snapshot()).toEqual(before);
  });
});
