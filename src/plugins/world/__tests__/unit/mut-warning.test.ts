import { afterEach, describe, expect, it, vi } from "vitest";
import { component, mut, system } from "../../ecs/define";
import type { AnySystem, Owner } from "../../ecs/types";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the dev warning `world:mut-unchanged` (spec 26 W3). The history of
// a dev build counts per component how many rows were marked and how many of
// them changed, over windows of 120 recorded frames.
// ---------------------------------------------------------------------------

const Frost = component("Frost", { amount: 0 });
const owner: Owner = { kind: "plugin", name: "test" };

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A dev-build mock world with `count` frost entities and the given systems, started.
 *
 * @param count - How many entities carry `Frost`.
 * @param systems - The systems to register before the start.
 * @returns The started mock world.
 */
function frosted(count: number, systems: readonly AnySystem[]): MockWorld {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);

  const world = createMockWorld();

  for (let index = 0; index < count; index += 1) world.api.ecs.spawn(owner, [Frost()]);
  for (const definition of systems) world.api.ecs.system(definition);

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
 * The `world:mut-unchanged` warnings logged so far.
 *
 * @param world - The mock world.
 * @returns Their payloads.
 */
function warnings(world: MockWorld): unknown[] {
  return vi
    .mocked(world.log.warn)
    .mock.calls.filter(([event]) => event === "world:mut-unchanged")
    .map(([, payload]) => payload);
}

/**
 * A mut system over `Frost` that writes the first `moved` rows it is handed and leaves the rest.
 *
 * @param moved - How many rows it changes a frame.
 * @returns The system.
 */
function frostApply(moved: number): AnySystem {
  return system({
    name: "shared.frostApply",
    phase: "animate",
    query: [mut(Frost)],
    run: rows => {
      let left = moved;

      for (const [, frost] of rows) {
        // Every row is consumed: a walk left early marks only what it yielded.
        if (left === 0) continue;

        frost.amount += 1;
        left -= 1;
      }
    }
  });
}

describe("world:mut-unchanged", () => {
  it("a mut term that marks 60 rows a frame and changes none warns once, naming the system", () => {
    const world = frosted(60, [frostApply(0)]);

    // The first frame starts the recording; the next 120 are the first window.
    frames(world, 120);
    expect(warnings(world)).toEqual([]);

    frames(world, 1);
    expect(warnings(world)).toEqual([
      { component: "Frost", rowsPerFrame: 60, changedShare: 0, systems: ["shared.frostApply"] }
    ]);

    frames(world, 240);
    expect(warnings(world)).toHaveLength(1);
  });

  it("a mut term whose rows change is never reported", () => {
    const world = frosted(60, [frostApply(60)]);

    frames(world, 241);

    expect(warnings(world)).toEqual([]);
  });

  it("31 rows a frame is not reported, 32 is", () => {
    const below = frosted(31, [frostApply(0)]);
    const at = frosted(32, [frostApply(0)]);

    frames(below, 121);
    frames(at, 121);

    expect(warnings(below)).toEqual([]);
    expect(warnings(at)).toHaveLength(1);
  });

  it("5 % of the marked rows changed is reported, more is not", () => {
    // 40 rows a frame: 2 changed is 5 %, 3 changed is 7.5 %.
    const five = frosted(40, [frostApply(2)]);
    const more = frosted(40, [frostApply(3)]);

    frames(five, 121);
    frames(more, 121);

    expect(warnings(five)).toEqual([
      { component: "Frost", rowsPerFrame: 40, changedShare: 0.05, systems: ["shared.frostApply"] }
    ]);
    expect(warnings(more)).toEqual([]);
  });

  it("a component marked by set alone is not reported", () => {
    const world = frosted(60, [
      system({
        name: "frostBySet",
        phase: "animate",
        query: [Frost],
        run: (rows, { world: ecs }) => {
          for (const [entity, frost] of rows) ecs.set(entity, Frost, { amount: frost.amount });
        }
      })
    ]);

    frames(world, 121);

    expect(warnings(world)).toEqual([]);
  });
});
