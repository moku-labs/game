import { describe, expect, it } from "vitest";
import {
  NineSlice,
  Shape,
  Sprite,
  Transform,
  type TransformValue
} from "../../../renderer/components";
import { Exiting } from "../../../world/ecs/define";
import type { AnchorTarget } from "../../../world/projection/types";
import type { AnyComponentType, Entity } from "../../../world/types";
import { type DrawnReader, drawnInto, targetsInto } from "../../drawn";
import type { Element, Root } from "../../jsx/types";

/** The components of the fake world, by entity and component name; a tag is `true`. */
type Stores = Map<Entity, Record<string, object | true>>;

/** What the fake world holds. */
type World = {
  stores: Stores;
  elements: Map<Entity, Element>;
  roots: Map<Entity, Root>;
  keys: Map<string, Entity>;
  building: Set<Entity>;
  exiting: Set<Entity>;
};

/**
 * A pose at a place, scaled around a pivot.
 *
 * @param patch - What differs from the identity.
 * @returns The pose.
 */
function pose(patch: Partial<TransformValue>): TransformValue {
  return { ...Transform.defaults, pivot: { x: 0, y: 0 }, ...patch };
}

/**
 * An element the resolver reads: its rect, its rest pose, its parent and its root.
 *
 * @param entity - Its entity.
 * @param patch - Its rect, rest, parent and root.
 * @returns The element.
 */
function element(entity: Entity, patch: Partial<Element>): Element {
  return {
    entity,
    rect: { x: 0, y: 0, w: 0, h: 0 },
    rest: pose({}),
    parent: undefined,
    root: 0,
    ...patch
  } as unknown as Element;
}

/**
 * An empty fake world.
 *
 * @returns The world.
 */
function emptyWorld(): World {
  return {
    stores: new Map(),
    elements: new Map(),
    roots: new Map(),
    keys: new Map(),
    building: new Set(),
    exiting: new Set()
  };
}

/**
 * Puts components on an entity of the fake world.
 *
 * @param world - The world.
 * @param entity - The entity.
 * @param components - The values by component name.
 */
function put(world: World, entity: Entity, components: Record<string, object | true>): void {
  world.stores.set(entity, { ...world.stores.get(entity), ...components });
}

/**
 * The reader of a fake world.
 *
 * @param world - The world.
 * @returns The reader the resolver takes.
 */
function readerOf(world: World): DrawnReader {
  const read = (entity: Entity, component: AnyComponentType): object | true | undefined =>
    world.stores.get(entity)?.[component.componentName];

  return {
    ecs: {
      get: (entity: Entity, component: AnyComponentType) => {
        const value = read(entity, component);

        return value === true ? undefined : value;
      },
      has: (entity: Entity, component: AnyComponentType) => read(entity, component) !== undefined
    } as unknown as DrawnReader["ecs"],
    projection: {
      entityOf: (projection: string, key: string) => world.keys.get(`${projection}/${key}`),
      isBuilding: (entity: Entity) => world.building.has(entity)
    },
    elements: world.elements,
    roots: world.roots,
    exiting: world.exiting
  };
}

/**
 * Where the resolver says an entity is drawn.
 *
 * @param world - The world.
 * @param entity - The entity.
 * @returns The rect, or `undefined` when it is not shown.
 */
function drawn(
  world: World,
  entity: Entity
): { x: number; y: number; w: number; h: number } | undefined {
  const out = { x: 0, y: 0, w: 0, h: 0 };

  return drawnInto(readerOf(world), entity, out, pose({})) ? out : undefined;
}

/**
 * Where the resolver says one target or a list is drawn.
 *
 * @param world - The world.
 * @param to - The targets.
 * @returns The rect, or `undefined` when none is shown.
 */
function spans(
  world: World,
  to: AnchorTarget | readonly AnchorTarget[]
): { x: number; y: number; w: number; h: number } | undefined {
  const out = { x: 0, y: 0, w: 0, h: 0 };
  const scratch = { part: { x: 0, y: 0, w: 0, h: 0 }, pose: pose({}) };

  return targetsInto(readerOf(world), to, out, scratch) ? out : undefined;
}

/**
 * A world with one root element at (100, 200) of 400 x 300, its pivot at its centre, and a child
 * button of 100 x 40 at (20, 30) inside it, pivot at its centre.
 *
 * @returns The world: the root is entity 1, the button 2.
 */
function panelWorld(): World {
  const world = emptyWorld();

  world.elements.set(1, element(1, { rect: { x: 100, y: 200, w: 400, h: 300 } }));
  world.elements.set(2, element(2, { rect: { x: 120, y: 230, w: 100, h: 40 }, parent: 1 }));
  put(world, 1, { Transform: pose({ x: 300, y: 350, pivot: { x: 200, y: 150 } }) });
  put(world, 2, { Transform: pose({ x: 70, y: 50, pivot: { x: 50, y: 20 } }) });

  return world;
}

describe("drawnInto", () => {
  it("draws a ui element's layout box through its pose and its parent's", () => {
    // Bug caught: the element is placed by its rect in root coordinates and not by the poses that
    // draw it, so a parent's motion leaves the anchor behind.
    const world = panelWorld();

    expect(drawn(world, 2)).toEqual({ x: 120, y: 230, w: 100, h: 40 });

    put(world, 1, { Transform: pose({ x: 310, y: 350, pivot: { x: 200, y: 150 } }) });

    expect(drawn(world, 2)).toEqual({ x: 130, y: 230, w: 100, h: 40 });
  });

  it("places an element spawned this frame by its rest pose, before its Transform lands", () => {
    // Bug caught: a target laid out in this frame has no `Transform` until the flush, so it is
    // drawn at the identity, or not found, and the anchor lags a frame.
    const world = panelWorld();

    world.stores.delete(2);
    world.elements.set(
      2,
      element(2, {
        rect: { x: 120, y: 230, w: 100, h: 40 },
        parent: 1,
        rest: pose({ x: 70, y: 50, pivot: { x: 50, y: 20 } })
      })
    );

    expect(drawn(world, 2)).toEqual({ x: 120, y: 230, w: 100, h: 40 });
  });

  it("scales by a fitted ancestor around its pivot", () => {
    // Bug caught: the fit of an ancestor is skipped: the hole is the natural size.
    const world = panelWorld();

    put(world, 1, { Transform: pose({ x: 300, y: 350, scale: 0.5, pivot: { x: 200, y: 150 } }) });

    expect(drawn(world, 2)).toEqual({ x: 210, y: 290, w: 50, h: 20 });
  });

  it("goes through the slot a root is laid out in", () => {
    // Bug caught: a root laid out in a slot is read in the slot's units as if they were the screen.
    const world = panelWorld();

    world.elements.set(9, element(9, { rect: { x: 0, y: 0, w: 50, h: 50 }, root: 5 }));
    world.roots.set(5, { slot: 2 } as Root);
    put(world, 9, { Transform: pose({ x: 10, y: 5 }) });

    expect(drawn(world, 9)).toEqual({ x: 130, y: 235, w: 50, h: 50 });
  });

  it("draws a nine-slice panel, a shape and a sprite by their own boxes", () => {
    // Bug caught: a world view with no ui element has no box, or a sprite is taken from its top
    // left instead of its anchor.
    const world = emptyWorld();

    put(world, 3, {
      Transform: pose({ x: 10, y: 20 }),
      NineSlice: { ...NineSlice.defaults, width: 30, height: 40 }
    });
    put(world, 4, { Transform: pose({ x: 10, y: 20 }), Shape: { ...Shape.defaults, w: 8, h: 6 } });
    put(world, 5, {
      Transform: pose({ x: 500, y: 700, scale: 2 }),
      Sprite: { ...Sprite.defaults, width: 64, height: 32, anchor: { x: 0.5, y: 0.5 } }
    });

    expect(drawn(world, 3)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(drawn(world, 4)).toEqual({ x: 10, y: 20, w: 8, h: 6 });
    expect(drawn(world, 5)).toEqual({ x: 436, y: 668, w: 128, h: 64 });
  });

  it("answers nothing for a target that is not shown", () => {
    // Bug caught: a leaving, aside, empty or transparent target still gets an anchor on it.
    const leaving = panelWorld();
    const aside = panelWorld();
    const empty = emptyWorld();
    const faded = panelWorld();
    const unposed = emptyWorld();

    const held = panelWorld();

    leaving.exiting.add(1);
    aside.building.add(2);
    // A late element of a held window: its root is held, the element itself was never adopted.
    held.elements.set(2, { ...(held.elements.get(2) as Element), root: 7 });
    held.building.add(7);
    put(empty, 3, { Transform: pose({}), Sprite: { ...Sprite.defaults } });
    put(faded, 1, { Shape: { ...Shape.defaults, alpha: 0 } });
    put(unposed, 4, { Sprite: { ...Sprite.defaults, width: 8, height: 8 } });

    expect(drawn(leaving, 2)).toBeUndefined();
    expect(drawn(aside, 2)).toBeUndefined();
    expect(drawn(held, 2)).toBeUndefined();
    expect(drawn(empty, 3)).toBeUndefined();
    expect(drawn(faded, 2)).toBeUndefined();
    expect(drawn(unposed, 4)).toBeUndefined();
  });

  it("answers nothing under an ancestor tagged Exiting", () => {
    // Bug caught: only the target itself is asked, so the child of a leaving view keeps its anchor.
    const world = panelWorld();

    put(world, 1, { [Exiting.componentName]: true });

    expect(drawn(world, 2)).toBeUndefined();
  });
});

describe("targetsInto", () => {
  it("spans the shown targets of a list and skips the ones not shown", () => {
    // Bug caught: a list answers its first target only, or a missing key empties the union.
    const world = panelWorld();

    world.keys.set("hud/panel", 1);
    world.keys.set("hud/play", 2);
    put(world, 3, {
      Transform: pose({ x: 600, y: 900 }),
      Shape: { ...Shape.defaults, w: 10, h: 10 }
    });
    world.keys.set("board/dot", 3);

    const play = { projection: "hud", key: "play" };
    const dot = { projection: "board", key: "dot" };
    const gone = { projection: "board", key: "gone" };

    expect(spans(world, play)).toEqual({ x: 120, y: 230, w: 100, h: 40 });
    expect(spans(world, [play, dot])).toEqual({ x: 120, y: 230, w: 490, h: 680 });
    expect(spans(world, [gone, dot])).toEqual({ x: 600, y: 900, w: 10, h: 10 });
    expect(spans(world, [gone])).toBeUndefined();
  });
});
