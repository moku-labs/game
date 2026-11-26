/**
 * @file world plugin — SPIKE (item 6, 2026-11-26): heap per mount/remove churn of the ECS store, and what a store of
 * another shape would save. Measures only; asserts only that a measurement came out. Not a budget yet.
 */
import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { createModules } from "../../api";
import { component, tag } from "../../ecs/define";
import type { Entity, Owner } from "../../ecs/types";
import { withDeps } from "../../lifecycle";
import { createMockWorld } from "../unit/mock-world";

const OWNER: Owner = { kind: "plugin", name: "spike" };

/** Five data components and a tag: about what a ui element carries (Transform, Box, Order, Parent, a visual). */
const Pos = component("SpikePos", { x: 0, y: 0, rotation: 0, scale: 1 });
const Rect = component("SpikeRect", { x: 0, y: 0, w: 0, h: 0 });
const Rank = component("SpikeRank", { value: 0 });
const Up = component("SpikeUp", { entity: 0 });
const Look = component("SpikeLook", { alpha: 1, tint: 0 });
const Mark = tag("SpikeMark");
const Anim = component("SpikeAnim", { playing: 0 });

/** Entities that stay, as the rest of the album does. */
const RESTING = 600;

/** Entities one commit mounts and the next one removes: a set page. */
const PAGE = 130;

/** Entities a turn starts a track on and ends it. */
const MOVED = 8;

const sink = { entity: 0 as Entity };

/**
 * A world with `RESTING` entities of six components.
 *
 * @returns The mock world.
 */
function restingWorld(): ReturnType<typeof createMockWorld> & { clear: () => void } {
  const world = createMockWorld();
  const internal = createModules(withDeps(world.ctx)).ecs;

  for (let index = 0; index < RESTING; index += 1) {
    world.api.ecs.spawn(OWNER, [Pos(), Rect(), Rank(), Up(), Look(), Mark()]);
  }

  return Object.assign(world, { clear: (): void => internal.clearChanges() });
}

/**
 * The six component values of one page entity, as a mount hands them over.
 *
 * @returns A fresh value list.
 */
function pageEntity(): ReturnType<typeof Pos>[] {
  return [Pos({ x: 1.5 }), Rect({ w: 90.5 }), Rank({ value: 3 }), Up(), Look(), Mark()] as never;
}

/**
 * One page mounted and removed through the world: spawn `PAGE` entities of six components, the frame's clear,
 * despawn them all, the clear again.
 *
 * @returns One churn.
 */
function pageChurn(): () => void {
  const world = restingWorld();
  const ecs = world.api.ecs;
  const page: Entity[] = Array.from({ length: PAGE }, () => 0);

  return (): void => {
    for (let index = 0; index < PAGE; index += 1) page[index] = ecs.spawn(OWNER, pageEntity());
    world.clear();
    for (let index = 0; index < PAGE; index += 1) ecs.despawn(page[index] ?? 0);
    world.clear();
  };
}

/** The value lists alone, as `pageChurn` builds them: what the caller allocates, not the store. */
function pageValues(): void {
  for (let index = 0; index < PAGE; index += 1) sink.entity = pageEntity().length;
}

/**
 * A turn's tracks through the world: `MOVED` resting entities get the counting component and lose it again.
 *
 * @returns One turn.
 */
function animChurn(): () => void {
  const world = restingWorld();
  const ecs = world.api.ecs;
  const moved = Array.from({ length: MOVED }, (_, index) =>
    ecs.spawn(OWNER, [Pos(), Rect(), Rank({ value: index })])
  );
  const value = Anim({ playing: 1 });

  return (): void => {
    for (const entity of moved) ecs.add(entity, value);
    world.clear();
    for (const entity of moved) ecs.remove(entity, Anim);
    world.clear();
  };
}

/** A store as the world keeps one today: a Map by entity id, ids taking a new generation on reuse. */
function mapStoreChurn(keys: number, step: number): () => void {
  const store = new Map<number, object>();
  let generation = 1;

  for (let index = 0; index < RESTING; index += 1) store.set(index, { value: index });

  return (): void => {
    // Below 1024 generations an id stays a small integer, as in a short session.
    generation = (generation % 1000) + 1;
    for (let index = 0; index < keys; index += 1) {
      store.set(generation * 1_048_576 + RESTING + index * step, { value: index });
    }
    for (let index = 0; index < keys; index += 1) {
      store.delete(generation * 1_048_576 + RESTING + index * step);
    }
    sink.entity = store.size;
  };
}

/** A dense store by entity index: the value array grown once, a slot written and cleared. */
function denseStoreChurn(keys: number, step: number): () => void {
  const values: Array<object | undefined> = [];
  const generations: number[] = [];
  let generation = 1;

  for (let index = 0; index < RESTING + keys * step; index += 1) {
    values.push(index < RESTING ? { value: index } : undefined);
    generations.push(0);
  }

  return (): void => {
    generation = (generation % 1000) + 1;
    for (let index = 0; index < keys; index += 1) {
      const slot = RESTING + index * step;

      values[slot] = { value: index };
      generations[slot] = generation;
    }
    for (let index = 0; index < keys; index += 1) values[RESTING + index * step] = undefined;
    sink.entity = values.length + (generations[RESTING] ?? 0);
  };
}

describe("SPIKE item 6: ECS store churn, heap per churn", () => {
  it("page mount + remove through the world (130 entities × 6 components)", async ({
    annotate
  }) => {
    const churn = alloc(pageChurn(), 200);
    const callerValues = alloc(pageValues, 200);

    await annotate(
      `page churn ${churn} B (${(churn / PAGE).toFixed(0)} B an entity); of it the caller's value arrays ${callerValues} B`
    );
    expect(churn).toBeGreaterThan(0);
  });

  it("8 tracks: the counting component added and removed", async ({ annotate }) => {
    const bytes = alloc(animChurn(), 2000);

    await annotate(`anim churn ${bytes} B (${(bytes / MOVED).toFixed(0)} B a track)`);
    expect(bytes).toBeGreaterThanOrEqual(0);
  });

  it("one store alone: Map by id against dense by index, page-sized and turn-sized churn", async ({
    annotate
  }) => {
    const mapPage = alloc(mapStoreChurn(PAGE, 1), 500);
    const densePage = alloc(denseStoreChurn(PAGE, 1), 500);
    const mapTurn = alloc(mapStoreChurn(MOVED, 37), 5000);
    const denseTurn = alloc(denseStoreChurn(MOVED, 37), 5000);

    await annotate(
      `page: map ${mapPage} B, dense ${densePage} B; turn: map ${mapTurn} B, dense ${denseTurn} B (values ${PAGE * 16}/${MOVED * 16} B of it)`
    );
    expect(mapPage).toBeGreaterThan(0);
  });
});
