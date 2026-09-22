/**
 * @file world plugin — the board fixture the projection unit tests share: one projection over a
 * list of keyed items, three layers and the convergence assertion of the spike cases.
 */
import { expect } from "vitest";
import { component } from "../../ecs/define";
import type { Entity, Owner } from "../../ecs/types";
import { projection } from "../../projection/define";
import type {
  AnyProjectionSpec,
  LayerSpec,
  Motion,
  ProjectionMotion,
  View,
  ViewHandle
} from "../../projection/types";
import type { MockWorld } from "./mock-world";

/** One model item of the board. */
export type Item = { id: string; level: number; x: number; y: number };

/** The player root the fixture projects. */
export type Player = { items: Item[] };

/** Level of an item, the component a level-up motion animates. */
export const Level = component("Level", { level: 1 });

/** Where the item sits and how big it is. */
export const Transform = component("Transform", { x: 0, y: 0, scale: 1 });

/** The three layers the fixture scene declares. */
export const LAYERS: readonly LayerSpec[] = [
  { name: "board", sort: "none" },
  { name: "items", sort: "y" },
  { name: "lifted", sort: "none" }
];

/** Owner of the mounted fixture. */
export const MOUNT_OWNER: Owner = { kind: "plugin", name: "test" };

/** Name of the fixture projection. */
export const BOARD = "board.items";

/**
 * Builds the fixture projection, with the motion hooks a test wants.
 *
 * @param motion - Motion hooks of this test, or none.
 * @param lift - `"lifted"` declares the lift layer, `"none"` leaves the projection without one.
 * @returns The projection spec.
 */
export function boardItems(
  motion?: ProjectionMotion<Item>,
  lift: "lifted" | "none" = "lifted"
): AnyProjectionSpec {
  return projection({
    name: BOARD,
    layer: "items",
    ...(lift === "none" ? {} : { lift }),
    from: (player: Player) => player.items,
    key: (item: Item) => item.id,
    view: (item: Item) => [
      Level({ level: item.level }),
      Transform({ x: item.x, y: item.y, scale: 1 })
    ],
    ...(motion === undefined ? {} : { motion })
  }) as AnyProjectionSpec;
}

/**
 * Sets the layers, registers the fixture projection, mounts it and starts the frame callbacks.
 *
 * @param world - The mock world.
 * @param items - The items the player starts with.
 * @param motion - Motion hooks of this test, or none.
 * @param lift - `"lifted"` declares the lift layer, `"none"` leaves the projection without one.
 */
export function mountBoard(
  world: MockWorld,
  items: Item[],
  motion?: ProjectionMotion<Item>,
  lift: "lifted" | "none" = "lifted"
): void {
  world.model.player = { items } as unknown as Player & Record<string, never>;
  world.api.projection.setLayers(LAYERS);
  world.api.projection.register(boardItems(motion, lift));
  world.start();
  world.api.projection.mount([BOARD], MOUNT_OWNER);
}

/**
 * Replaces the board items and commits, without stepping a frame.
 *
 * @param world - The mock world.
 * @param items - The new item list.
 */
export function commitItems(world: MockWorld, items: Item[]): void {
  world.model.player = { items } as unknown as Player & Record<string, never>;
  world.commit();
}

/**
 * Reads the view record of one key, live or queued.
 *
 * @param world - The mock world.
 * @param key - The model key.
 * @returns The view, or `undefined`.
 */
export function viewOf(world: MockWorld, key: string): View | undefined {
  for (const view of world.ctx.state.projection.byEntity.values()) {
    if (view.key === key) return view;
  }

  return undefined;
}

/**
 * Reads the stored value of one component of one entity, straight from the store.
 *
 * @param world - The mock world.
 * @param entity - The entity to read.
 * @param name - The component name.
 * @returns The stored object, or `undefined`.
 */
export function storedOf(world: MockWorld, entity: Entity, name: string): unknown {
  return world.ctx.state.ecs.stores.get(name)?.get(entity);
}

/**
 * The convergence assertion every spike case ends with: no active handle on the view, and every
 * rest component equal to the stored value.
 *
 * @param world - The mock world.
 * @param key - The model key of the view.
 */
export function expectConverged(world: MockWorld, key: string): void {
  const view = viewOf(world, key);

  expect(view).toBeDefined();
  expect(view?.handles.some(handle => handle.active())).toBe(false);
  expect(world.ctx.state.projection.tracks.some(track => !track.ended)).toBe(false);

  for (const [name, rest] of view?.rest ?? []) {
    expect(storedOf(world, view?.entity ?? 0, name)).toEqual(rest.value);
  }
}

/**
 * Sends one named component of the fixture back to its rest pose. The settle hooks of the tests
 * use it, so a custom settle converges like the built-in one.
 *
 * @param view - The handle the settle hook was given.
 * @param name - Component name the settle asked about.
 * @returns The motion that brings it home.
 */
export function restOfName(view: ViewHandle<Item>, name: string): Motion {
  return name === "Level" ? view.toRest(Level) : view.toRest(Transform);
}

/**
 * Runs frames until no track is active, with an upper bound so a bug cannot hang the suite.
 *
 * @param world - The mock world.
 * @param deltaMs - Delta of each frame.
 * @param max - Largest number of frames to run.
 */
export function settleFrames(world: MockWorld, deltaMs = 16, max = 200): void {
  for (let index = 0; index < max; index += 1) {
    world.frame(deltaMs);

    if (!world.ctx.state.projection.tracks.some(track => !track.ended)) return;
  }
}
