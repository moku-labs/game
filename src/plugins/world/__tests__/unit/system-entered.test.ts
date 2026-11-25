import { describe, expect, it } from "vitest";
import { component, Exiting, system } from "../../ecs/define";
import type { Owner, SystemContext } from "../../ecs/types";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit: `ctx.entered` (F243). True on a system's first run after the mounted
// scene became one of its `scenes` (any scene for a system without them), and
// on its very first run; false while its scene only leaves.
// ---------------------------------------------------------------------------

const Look = component("Look", { name: "" });
const test: Owner = { kind: "plugin", name: "test" };

/** What one system saw: `entered` and `resumed` of every run. */
type Seen = { entered: boolean[]; resumed: boolean[] };

/**
 * A system that keeps `entered` and `resumed` of each run.
 *
 * @param name - System name.
 * @param extra - Its `scenes` and query, when the case sets them.
 * @param extra.scenes - The scenes it runs on.
 * @param extra.query - Its query; none by default.
 * @returns The system and what it saw.
 */
function watched(
  name: string,
  extra: { scenes?: readonly string[]; query?: ReadonlyArray<typeof Look> } = {}
) {
  const seen: Seen = { entered: [], resumed: [] };
  const definition = system({
    name,
    phase: "input",
    query: [...(extra.query ?? [])],
    ...(extra.scenes === undefined ? {} : { scenes: extra.scenes }),
    run: (_rows, context: SystemContext) => {
      seen.entered.push(context.entered);
      seen.resumed.push(context.resumed);
    }
  });

  return { definition, seen };
}

/**
 * Starts a mock world with the scenes `ward`, `memory` and `board` declared, and one system.
 *
 * @param definition - The system to register.
 * @returns The started world.
 */
function started(definition: ReturnType<typeof watched>["definition"]): MockWorld {
  const world = createMockWorld();

  world.features.push({
    name: "screens",
    description: { scenes: [{ id: "ward" }, { id: "memory" }, { id: "board" }] }
  });
  world.api.ecs.system(definition);
  world.start();

  return world;
}

describe("ctx.entered of a system with scenes", () => {
  // Bug caught: the first mount is not an entry, so a loop asked on entry never starts.
  it("is true on its first run on the mounted scene, then false", () => {
    const rain = watched("location.rainBed", { scenes: ["ward"] });
    const world = started(rain.definition);

    world.api.ecs.setScene("ward");
    world.frame();
    world.frame();

    expect(rain.seen.entered).toEqual([true, false]);
  });

  // Bug caught (F243): a return while the ward still leaves is not seen, so the rain the leave
  // ended never starts again; or the runs during the leave are taken for entries.
  it("is true on a return while its scene still leaves, false during the leave", () => {
    const rain = watched("location.rainBed", { scenes: ["ward"] });
    const world = started(rain.definition);

    world.api.ecs.spawn(test, [Exiting()]);
    world.api.ecs.setScene("ward");
    world.frame();
    world.api.ecs.setScene("memory");
    world.frame();
    world.frame();
    world.api.ecs.setScene("ward");
    world.frame();
    world.frame();

    expect(rain.seen.entered).toEqual([true, false, false, true, false]);
    expect(rain.seen.resumed).toEqual([false, false, false, false, false]);
  });

  // Bug caught: only the first entry counts, so the second return is silent.
  it("is true on every entry of the game, not only the first", () => {
    const rain = watched("location.rainBed", { scenes: ["ward"] });
    const world = started(rain.definition);

    world.api.ecs.spawn(test, [Exiting()]);

    for (let entry = 0; entry < 3; entry += 1) {
      world.api.ecs.setScene("ward");
      world.frame();
      world.frame();
      world.api.ecs.setScene("memory");
      world.frame();
    }

    expect(rain.seen.entered).toEqual([true, false, false, true, false, false, true, false, false]);
  });

  // Bug caught: an entry after the system slept is lost, or it is told resumed alone.
  it("is true together with resumed when the leave ended before the return", () => {
    const rain = watched("location.rainBed", { scenes: ["ward"] });
    const world = started(rain.definition);

    world.api.ecs.setScene("ward");
    world.frame();
    world.api.ecs.setScene("memory");
    world.frame();
    world.api.ecs.setScene("ward");
    world.frame();

    expect(rain.seen.entered).toEqual([true, true]);
    expect(rain.seen.resumed).toEqual([false, true]);
  });

  // Bug caught: a switch between two of its own scenes is not an entry, though the leave of the
  // first scene ended what it asked there.
  it("is true when the mounted scene moves from one of its scenes to another", () => {
    const shared = watched("shared.bed", { scenes: ["ward", "board"] });
    const world = started(shared.definition);

    world.api.ecs.setScene("ward");
    world.frame();
    world.api.ecs.setScene("board");
    world.frame();
    world.frame();

    expect(shared.seen.entered).toEqual([true, true, false]);
  });

  // Bug caught: the entry is marked seen while the system is skipped for its empty query, so its
  // first real run is not told.
  it("is kept for the first run after an empty-query skip across the entry", () => {
    const looks = watched("ward.looks", { scenes: ["ward"], query: [Look] });
    const world = started(looks.definition);

    world.api.ecs.setScene("ward");
    world.frame();
    world.api.ecs.spawn(test, [Look()]);
    world.frame();
    world.frame();

    expect(looks.seen.entered).toEqual([true, false]);
    expect(looks.seen.resumed).toEqual([true, false]);
  });

  // Bug caught: a switch while the world is paused is lost, as no phase ran to see it.
  it("is true on the first live run after a switch made while paused", () => {
    const rain = watched("location.rainBed", { scenes: ["ward"] });
    const world = started(rain.definition);

    world.api.ecs.spawn(test, [Exiting()]);
    world.api.ecs.setScene("ward");
    world.frame();
    world.api.ecs.setMode("paused");
    world.api.ecs.setScene("memory");
    world.frame();
    world.api.ecs.setScene("ward");
    world.frame();
    world.api.ecs.setMode("live");
    world.frame();

    expect(rain.seen.entered).toEqual([true, true]);
    expect(rain.seen.resumed).toEqual([false, false]);
  });

  // Bug caught: the same scene set again counts as an entry.
  it("is false when the mounted scene is set to itself", () => {
    const rain = watched("location.rainBed", { scenes: ["ward"] });
    const world = started(rain.definition);

    world.api.ecs.setScene("ward");
    world.frame();
    world.api.ecs.setScene("ward");
    world.frame();

    expect(rain.seen.entered).toEqual([true, false]);
  });
});

describe("ctx.entered of a system without scenes", () => {
  // Bug caught: a system without scenes is never told, or is told on every run.
  it("is true on its first run and after every switch", () => {
    const pulse = watched("hud.pulse");
    const world = started(pulse.definition);

    world.frame();
    world.frame();
    world.api.ecs.setScene("ward");
    world.frame();
    world.frame();
    world.api.ecs.setScene("board");
    world.frame();

    expect(pulse.seen.entered).toEqual([true, false, true, false, true]);
  });

  // Bug caught: `entered` leaks from one system to the next of the phase through the one context.
  it("is written for each system, not left from the one before", () => {
    const first = watched("a.first", { scenes: ["ward"] });
    const second = watched("b.second", { scenes: ["board"] });
    const world = started(first.definition);

    world.api.ecs.system(second.definition);
    world.api.ecs.spawn(test, [Exiting()]);
    world.api.ecs.setScene("board");
    world.frame();
    world.api.ecs.setScene("ward");
    world.frame();

    // On the ward the board only leaves: its system is told nothing, though the ward's was.
    expect(first.seen.entered).toEqual([true]);
    expect(second.seen.entered).toEqual([true, false]);
  });
});
