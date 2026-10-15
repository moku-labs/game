/**
 * @file Root integration — the fuzz of render on demand (spec 14 T2, K1): a seeded scene of
 * every kind of view the engine draws, and 400 frames of seeded random writes, five seeds. The
 * property is the tree oracle's: no frame is skipped while the screen differs from the last drawn
 * one. This is the net for the write paths a hand-written test forgot.
 */
import type { World } from "@moku-labs/game";
import {
  Alpha,
  Display,
  Glow,
  Layer,
  Order,
  Parent,
  Shape,
  Sprite,
  Text,
  Transform
} from "@moku-labs/game";
import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Emitter, open, running, type Still, square } from "./still-fixture";

/** Frames per seed. */
const FRAMES = 400;

/** The seeds: five scenes and five orders of writes. */
const SEEDS = [1, 7, 42, 1337, 90_210] as const;

/**
 * A small seeded random source (mulberry32): the same seed, the same writes.
 *
 * @param seed - The seed.
 * @returns A function answering numbers from 0 to 1.
 */
function randomOf(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;

    let mixed = state;

    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The scene of one seed: its entities by role. */
type Scene = {
  roots: World.Entity[];
  /** Every entity with a Shape. */
  shapes: World.Entity[];
  /** Every entity whose Transform the fuzz moves. */
  movers: World.Entity[];
  sprite: World.Entity;
  label: World.Entity;
  stove: World.Entity;
  flame: pixi.Graphics;
  /** The leaves spawned by the fuzz, despawned by it too. */
  spawned: World.Entity[];
  /** Where a re-parented entity can go. */
  parents: World.Entity[];
  middle: World.Entity;
  /** The host of the particle stream, switched on and off by the fuzz. */
  fountain: World.Entity;
};

/**
 * Builds the scene: three levels of parents, a hidden branch, two leaves off the screen, filters
 * with padding, a text label, a particle stream and a `Display` the game writes into.
 *
 * @param still - The running fixture.
 * @returns The scene.
 */
function sceneOf(still: Still): Scene {
  const top = still.spawn(Transform({ x: 60, y: 60 }), square(240), Glow({ distance: 12 }));
  const middle = still.child(
    top,
    Layer({ name: "main" }),
    Transform({ x: 20, y: 20 }),
    square(120)
  );
  const sprite = still.child(
    middle,
    Transform({ x: 30, y: 30 }),
    Sprite({ texture: "ui.fx-spark" })
  );
  const hidden = still.spawn(Transform({ x: 200, y: 400 }), square(100, { alpha: 0 }));
  const looping = still.child(hidden, Transform({ x: 10, y: 10 }), square(30));
  const left = still.spawn(Transform({ x: -400, y: 300 }), square(40), Glow({ distance: 4 }));
  const right = still.spawn(Transform({ x: 900, y: 500 }), square(40));
  const label = still.child(
    top,
    Transform({ x: 100, y: 200 }),
    Text({ style: "digits", content: "12" })
  );
  const flame = new pixi.Graphics().rect(0, 0, 30, 30).fill(0xff_80_00);
  const stove = still.spawn(Transform({ x: 300, y: 600 }), Display({ object: flame }));

  const fountain = still.spawn(
    Transform({ x: 200, y: 700 }),
    Emitter({ effect: "fx.stream", active: false })
  );

  return {
    roots: [top, hidden, left, right, stove, fountain],
    shapes: [top, middle, hidden, looping, left, right],
    movers: [top, middle, sprite, hidden, looping, left, right, label, stove, fountain],
    sprite,
    label,
    stove,
    flame,
    spawned: [],
    parents: [top, hidden],
    middle,
    fountain
  };
}

/**
 * Picks one item of a list.
 *
 * @param random - The random source.
 * @param items - The list, not empty.
 * @returns The item.
 */
function pick<Item>(random: () => number, items: readonly Item[]): Item {
  return items[Math.floor(random() * items.length)] as Item;
}

/** A component the fuzz writes: its type and how a value of it is made. */
type Writable<Value extends object> = World.ComponentType<Value> &
  ((fields?: Partial<Value>) => World.AnyComponentValue);

/**
 * Writes a component: into the one the entity carries, or as a new one.
 *
 * @param still - The running fixture.
 * @param entity - The entity.
 * @param component - The component.
 * @param fields - The fields to write.
 */
function put<Value extends object>(
  still: Still,
  entity: World.Entity,
  component: Writable<Value>,
  fields: Partial<Value>
): void {
  const ecs = still.app.world.ecs;

  if (ecs.has(entity, component)) ecs.set(entity, component, fields);
  else ecs.add(entity, component(fields));
}

/** One kind of write: what it does to the scene with the random source. */
type Write = (still: Still, scene: Scene, random: () => number) => void;

/** Every kind of write the fuzz makes, picked at random. */
const WRITES: readonly Write[] = [
  // A move, a turn and a new scale of any view.
  (still, scene, random) =>
    still.app.world.ecs.set(pick(random, scene.movers), Transform, {
      x: Math.round(random() * 1400) - 500,
      y: Math.round(random() * 1200) - 200
    }),
  (still, scene, random) =>
    still.app.world.ecs.set(pick(random, scene.movers), Transform, {
      rotation: random() * 3,
      scale: 0.5 + random()
    }),
  // A tint of the sprite; a fill, a size or an alpha of a shape.
  (still, scene, random) =>
    still.app.world.ecs.set(scene.sprite, Sprite, { tint: Math.floor(random() * 0xff_ff_ff) }),
  (still, scene, random) =>
    still.app.world.ecs.set(pick(random, scene.shapes), Shape, {
      fill: Math.floor(random() * 0xff_ff_ff),
      w: 20 + Math.round(random() * 200)
    }),
  (still, scene, random) =>
    still.app.world.ecs.set(pick(random, scene.shapes), Shape, { alpha: random() < 0.4 ? 0 : 1 }),
  // A depth, a layer, a parent set and removed.
  (still, scene, random) =>
    put(still, pick(random, scene.roots), Order, { value: Math.floor(random() * 5) }),
  (still, scene, random) =>
    still.app.world.ecs.set(pick(random, scene.roots), Layer, {
      name: random() < 0.5 ? "main" : "top"
    }),
  (still, scene, random) => {
    if (still.app.world.ecs.has(scene.middle, Parent) && random() < 0.5) {
      still.app.world.ecs.remove(scene.middle, Parent);
    } else {
      put(still, scene.middle, Parent, { entity: pick(random, scene.parents) });
    }
  },
  // A glow whose padding follows its distance, and the Alpha filter: values and lists.
  (still, scene, random) => {
    const target = pick(random, scene.shapes);

    if (still.app.world.ecs.has(target, Glow) && random() < 0.3) {
      still.app.world.ecs.remove(target, Glow);
    } else {
      put(still, target, Glow, { distance: Math.round(random() * 20) });
    }
  },
  (still, scene, random) => {
    const target = pick(random, scene.shapes);

    if (still.app.world.ecs.has(target, Alpha) && random() < 0.5) {
      still.app.world.ecs.remove(target, Alpha);
    } else {
      put(still, target, Alpha, { alpha: random() < 0.3 ? 0 : random() });
    }
  },
  // A spawn and a despawn.
  (still, scene, random) => {
    scene.spawned.push(
      still.spawn(
        Transform({ x: Math.round(random() * 390), y: Math.round(random() * 844) }),
        square(20 + Math.round(random() * 40))
      )
    );
  },
  (still, scene) => {
    const leaf = scene.spawned.shift();

    if (leaf !== undefined) still.app.world.ecs.despawn(leaf);
  },
  // The game's own Display: the call first, then the write.
  (still, scene, random) => {
    still.app.renderer.invalidate(scene.stove);
    scene.flame.x = Math.round(random() * 60) - 30;
    scene.flame.alpha = random() < 0.2 ? 0 : 1;
  },
  // A new text of the label.
  (still, scene, random) =>
    still.app.world.ecs.set(scene.label, Text, { content: String(Math.floor(random() * 100)) }),
  // The stream starts or stops: its particles live on for a while after it stops.
  (still, scene, random) =>
    still.app.world.ecs.set(scene.fountain, Emitter, { active: random() < 0.3 })
];

afterEach(async () => {
  for (const still of running.splice(0)) await still.app.stop();

  vi.unstubAllGlobals();
});

describe("render on demand under seeded random writes", () => {
  it.each(SEEDS)("skips no frame over a changed picture, seed %i", async seed => {
    const still = await open();
    const random = randomOf(seed);
    const scene = sceneOf(still);

    await still.frames(10);

    for (let frame = 0; frame < FRAMES; frame += 1) {
      // Most frames write nothing: a skipped frame is where a missed mark shows.
      const writes = random() < 0.6 ? 0 : 1 + Math.floor(random() * 3);

      for (let index = 0; index < writes; index += 1) pick(random, WRITES)(still, scene, random);

      await still.frames(1);
    }

    expect(still.oracle.counts.frames).toBeGreaterThan(FRAMES);
    // Some frames were skipped and some drawn: the fuzz walked both paths.
    expect(still.oracle.counts.drawn).toBeGreaterThan(0);
    expect(still.oracle.counts.drawn).toBeLessThan(still.oracle.counts.frames);
    still.oracle.expectNoMissedFrame();
    still.oracle.expectPicturesCurrent();
  }, 60_000);
});
