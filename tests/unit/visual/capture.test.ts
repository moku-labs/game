import { describe, expect, it } from "vitest";
import type { UiNode } from "../../../src/plugins/ui/types";
import type { EntitySnapshot } from "../../../src/plugins/world/ecs/types";
import { describeOf, stateOf } from "../../../src/visual/capture";
import type { ReaderApp } from "../../../src/visual/types";

// ---------------------------------------------------------------------------
// Unit (fake app behind the real /inspect sources): stateOf and describeOf
// read through the sources only, drop ids and skipped components, sort views
// ---------------------------------------------------------------------------

/** A ui tree with one keyed button. */
const tree = {
  key: undefined,
  type: "screen",
  rect: { x: 0, y: 0, w: 1080, h: 1920 },
  style: {},
  state: {},
  children: [
    {
      key: "play",
      type: "button",
      rect: { x: 10, y: 20, w: 200, h: 80 },
      style: {},
      state: {},
      children: []
    }
  ]
} as unknown as UiNode;

/**
 * Builds one entity snapshot.
 *
 * @param id - The entity id.
 * @param owner - The owner's name.
 * @param components - The JSON components.
 * @returns The snapshot, with `Display` skipped.
 */
function entity(id: number, owner: string, components: EntitySnapshot["components"]) {
  return {
    id,
    index: id - 100,
    generation: 1,
    owner: { kind: "projection", name: owner },
    components,
    skipped: ["Display"]
  } satisfies EntitySnapshot;
}

/** Projection keys of the fake world: entity id to its projection and key. */
const keys = new Map([
  [104, { projection: "board.items", key: "i7" }],
  [102, { projection: "board.items", key: "i5" }],
  [101, { projection: "hud", key: "hud" }]
]);

/** The world: three keyed views out of order, an unkeyed ui part and a ring. */
const entities = [
  entity(104, "board.items", { Item: { level: 2 } }),
  entity(103, "ui", { Box: { x: 0, y: 0, w: 10, h: 10 } }),
  entity(102, "board.items", { Item: { level: 1 } }),
  entity(101, "hud", { Layer: { name: "ui" } }),
  entity(105, "ui", { Ring: { radius: 4 } })
];

/** A fake app with exactly what the five sources read. */
const app = {
  flow: {
    state: () => ({
      running: true,
      path: "board/awaitIntent",
      stack: [{ flow: "board", node: "awaitIntent" }],
      pending: { gate: ["merge"] },
      mode: "live"
    })
  },
  model: {
    store: {
      snapshot: () => ({
        player: { coins: 3 },
        session: { visits: 1 },
        rng: { seed: 42, streams: { drops: 2 } }
      })
    }
  },
  world: {
    ecs: { snapshot: () => ({ mode: "live", entities, resources: {} }) },
    projection: { keyOf: (id: number) => keys.get(id) }
  },
  ui: { tree: () => tree }
} as unknown as ReaderApp;

describe("stateOf", () => {
  it("reads the path and the committed trees", () => {
    expect(stateOf(app)).toEqual({
      path: "board/awaitIntent",
      player: { coins: 3 },
      session: { visits: 1 },
      rng: { seed: 42, streams: { drops: 2 } }
    });
  });
});

describe("describeOf", () => {
  it("reads the ui tree as the ui source answers it", () => {
    expect(describeOf(app).ui).toBe(tree);
  });

  it("keeps the keyed views only, sorted by projection then key, without ids", () => {
    expect(describeOf(app).views).toEqual([
      { projection: "board.items", key: "i5", components: { Item: { level: 1 } } },
      { projection: "board.items", key: "i7", components: { Item: { level: 2 } } },
      { projection: "hud", key: "hud", components: { Layer: { name: "ui" } } }
    ]);
  });

  it("drops the skipped components and the entity numbering", () => {
    const text = JSON.stringify(describeOf(app).views);

    expect(text).not.toContain("Display");
    expect(text).not.toContain("skipped");
    expect(text).not.toContain("10");
  });
});

describe("describeOf, parents", () => {
  /** Projection keys of a world with a panel, its keyed button and a child of an unkeyed part. */
  const parentKeys = new Map([
    [1_048_614, { projection: "DailyGift", key: "giftBoard" }],
    [2_097_164, { projection: "DailyGift", key: "giftClaim" }],
    [2_097_170, { projection: "DailyGift", key: "giftNote" }]
  ]);

  /** The world: the board, the claim button inside it, a note inside an unkeyed part. */
  const parentEntities = [
    entity(1_048_614, "ui", { Box: { x: 0, y: 0, w: 600, h: 400 } }),
    entity(2_097_164, "ui", { Parent: { entity: 1_048_614 }, Box: { x: 0, y: 0, w: 200, h: 80 } }),
    entity(2_097_165, "ui", { Box: { x: 0, y: 0, w: 10, h: 10 } }),
    entity(2_097_170, "ui", { Parent: { entity: 2_097_165 } })
  ];

  /** The fake app over that world. */
  const parentApp = {
    ...app,
    world: {
      ecs: { snapshot: () => ({ mode: "live", entities: parentEntities, resources: {} }) },
      projection: { keyOf: (id: number) => parentKeys.get(id) }
    }
  } as unknown as ReaderApp;

  it("names a keyed parent by its projection and key, and an unkeyed one by nothing", () => {
    const views = describeOf(parentApp).views;

    expect(views.find(view => view.key === "giftClaim")?.components.Parent).toEqual({
      projection: "DailyGift",
      key: "giftBoard"
    });
    expect(views.find(view => view.key === "giftNote")?.components.Parent).toEqual({});
    expect(JSON.stringify(views)).not.toMatch(/entity|1048614|2097165/u);
  });
});
