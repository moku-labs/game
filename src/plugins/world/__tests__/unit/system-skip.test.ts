import { afterEach, describe, expect, it, vi } from "vitest";
import { component, Exiting, system } from "../../ecs/define";
import type { Owner, SystemContext, WorldPhase } from "../../ecs/types";
import { clearWorld } from "../../lifecycle";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit: when a system runs. A system with a query is skipped while a term of
// it has no entity (D1); a system with `scenes` runs only while one of them is
// mounted or leaving (D2). `resumed` is true on the first run after a skip.
// ---------------------------------------------------------------------------

const Cell = component("Cell", { x: 0 });
const Look = component("Look", { name: "" });
const test: Owner = { kind: "plugin", name: "test" };

/** What one counted system saw: how often it ran, and `resumed` of every run. */
type Seen = { runs: number; resumed: boolean[] };

/**
 * A system that counts its runs and keeps `resumed` of each.
 *
 * @param name - System name.
 * @param query - Its query.
 * @param extra - `scenes`, when the case limits it.
 * @param extra.scenes - The scenes it runs on.
 * @param phase - Its phase.
 * @returns The system and what it saw.
 */
function counted(
  name: string,
  query: ReadonlyArray<typeof Cell | typeof Look>,
  extra: { scenes?: readonly string[] } = {},
  phase: WorldPhase = "animate"
) {
  const seen: Seen = { runs: 0, resumed: [] };
  const definition = system({
    name,
    phase,
    query: [...query],
    ...extra,
    run: (_rows, context: SystemContext) => {
      seen.runs += 1;
      seen.resumed.push(context.resumed);
    }
  });

  return { definition, seen };
}

/**
 * Starts a mock world with the scenes `ward` and `board` declared by a feature.
 *
 * @returns The started world.
 */
function withScenes(): MockWorld {
  const world = createMockWorld();

  world.features.push({
    name: "screens",
    description: { scenes: [{ id: "ward" }, { id: "board" }] }
  });

  return world;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a system whose query has no entity (D1)", () => {
  // Bug caught: the check is missing, so a system runs over a world that has nothing for it.
  it("is not run while no entity carries a term, and runs from the frame one does", () => {
    const world = createMockWorld();
    const { definition, seen } = counted("board.looks", [Look]);

    world.api.ecs.system(definition);
    world.start();
    world.frame();
    world.frame();

    expect(seen.runs).toBe(0);

    world.api.ecs.spawn(test, [Look()]);
    world.frame();

    expect(seen.runs).toBe(1);
  });

  // Bug caught: only the first term is checked, so a query whose second term has no entity still
  // walks the first store.
  it("is skipped when any term is empty, not only the first", () => {
    const world = createMockWorld();
    const { definition, seen } = counted("board.looks", [Cell, Look]);

    world.api.ecs.spawn(test, [Cell()]);
    world.api.ecs.system(definition);
    world.start();
    world.frame();

    expect(seen.runs).toBe(0);
  });

  // Bug caught: the kept store is never read again, so a store that emptied keeps its system
  // running, or one that filled again keeps it asleep.
  it("sleeps again when its last entity leaves and wakes when one comes back", () => {
    const world = createMockWorld();
    const { definition, seen } = counted("board.looks", [Look]);
    const first = world.api.ecs.spawn(test, [Look()]);

    world.api.ecs.system(definition);
    world.start();
    world.frame();
    world.api.ecs.despawn(first);
    world.frame();
    world.frame();

    expect(seen.runs).toBe(1);

    world.api.ecs.spawn(test, [Look()]);
    world.frame();

    expect(seen.runs).toBe(2);
  });

  // Bug caught: `resumed` is never set, stays true, or leaks to the next system of the phase.
  it("is told resumed on its first run after a skip, and only then", () => {
    const world = createMockWorld();
    const looks = counted("board.looks", [Look]);
    const always = counted("hud.pulse", []);

    world.api.ecs.system(looks.definition);
    world.api.ecs.system(always.definition);
    world.start();
    world.frame();
    world.api.ecs.spawn(test, [Look()]);
    world.frame();
    world.frame();

    expect(looks.seen.resumed).toEqual([true, false]);
    expect(always.seen.resumed).toEqual([false, false, false]);
  });

  // Bug caught: a system without a query is skipped as if its query were empty.
  it("never skips a system without a query", () => {
    const world = createMockWorld();
    const { definition, seen } = counted("location.lightFade", []);

    world.api.ecs.system(definition);
    world.start();
    world.frame();
    world.frame();

    expect(seen.runs).toBe(2);
  });
});

describe("a system with scenes (D2)", () => {
  // Bug caught: `scenes` is ignored, so the board's system runs on the ward, or before any scene.
  it("runs only while one of its scenes is mounted", () => {
    const world = withScenes();
    const { definition, seen } = counted("board.glow", [], { scenes: ["board"] });

    world.api.ecs.system(definition);
    world.start();
    world.frame();
    world.api.ecs.setScene("ward");
    world.frame();

    expect(seen.runs).toBe(0);

    world.api.ecs.setScene("board");
    world.frame();

    expect(seen.runs).toBe(1);
    expect(seen.resumed).toEqual([true]);
  });

  // Bug caught: the scene before stops at the switch, so its leaving views freeze; or it never
  // stops leaving.
  it("runs while its scene leaves, until nothing carries Exiting", () => {
    const world = withScenes();
    const { definition, seen } = counted("board.glow", [], { scenes: ["board"] });
    const leaving = world.api.ecs.spawn(test, [Exiting()]);

    world.api.ecs.system(definition);
    world.start();
    world.api.ecs.setScene("board");
    world.frame();
    world.api.ecs.setScene("ward");
    world.frame();
    world.frame();

    expect(seen.runs).toBe(3);

    world.api.ecs.despawn(leaving);
    world.frame();
    world.frame();

    expect(seen.runs).toBe(3);
  });

  // Bug caught: a scene that is passed through while another still leaves is dropped from the
  // leaving list, or the scenes are checked against the first name only.
  it("keeps every replaced scene leaving and matches any of its names", () => {
    const world = withScenes();
    const ward = counted("ward.pan", [], { scenes: ["ward"] });
    const either = counted("shared.veil", [], { scenes: ["shop", "home"] });

    world.api.ecs.spawn(test, [Exiting()]);
    world.api.ecs.system(ward.definition);
    world.api.ecs.system(either.definition);
    world.start();
    world.api.ecs.setScene("ward");
    world.api.ecs.setScene("board");
    world.api.ecs.setScene("home");
    world.frame();

    expect(ward.seen.runs).toBe(1);
    expect(either.seen.runs).toBe(1);
  });

  // Bug caught: a system with scenes and an empty query store runs because its scene is mounted.
  it("is still skipped on its scene while its query has no entity", () => {
    const world = withScenes();
    const { definition, seen } = counted("board.looks", [Look], { scenes: ["board"] });

    world.api.ecs.system(definition);
    world.start();
    world.api.ecs.setScene("board");
    world.frame();

    expect(seen.runs).toBe(0);
  });

  // Bug caught: a restarted world remembers the scene of the run before, so its systems run
  // before `scenes` mounted anything.
  it("forgets the mounted scene when the world stops", () => {
    const world = withScenes();

    world.start();
    world.api.ecs.setScene("board");
    clearWorld(world.ctx.state);

    const { definition, seen } = counted("board.glow", [], { scenes: ["board"] });

    world.api.ecs.system(definition);
    world.start();
    world.frame();

    expect(seen.runs).toBe(0);
  });
});

describe("the dev check of scenes", () => {
  // Bug caught: a typo in `scenes` is silent, and the system never runs.
  it("throws at start in a dev build for a scene no feature declares", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const world = withScenes();

    world.features.push({
      name: "board",
      description: { systems: [counted("board.glow", [], { scenes: ["bord"] }).definition] }
    });

    expect(() => world.start()).toThrow(
      '[game] System "board.glow" runs on the scene "bord", which no feature declares.\n' +
        "  Name a scene a feature lists in its scenes (declared: ward, board)."
    );
  });

  // Bug caught: a system registered by hand after start escapes the check.
  it("checks a system registered after start too, and passes a declared scene", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const world = withScenes();

    world.start();

    expect(() =>
      world.api.ecs.system(counted("hud.glow", [], { scenes: ["hud"] }).definition)
    ).toThrow("which no feature declares");
    expect(() =>
      world.api.ecs.system(counted("ward.glow", [], { scenes: ["ward"] }).definition)
    ).not.toThrow();
  });

  // Bug caught: the check runs in a production build, where it costs start time.
  it("does not check outside a dev build", () => {
    const world = withScenes();

    world.features.push({
      name: "board",
      description: { systems: [counted("board.glow", [], { scenes: ["bord"] }).definition] }
    });

    expect(() => world.start()).not.toThrow();
  });
});
