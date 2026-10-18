import { afterEach, describe, expect, it, vi } from "vitest";
import { timePlugin } from "../../../time";
import { component, system } from "../../ecs/define";
import type { WorldPhase } from "../../ecs/types";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit: the time per world system of an agent build (spec 11 H2b). The clock is
// the one `time.agentClock()` hands out; here a stub that moves 0.5 ms a read.
// ---------------------------------------------------------------------------

const Marker = component("Marker", { at: 0 });

/** A component no entity of these tests carries. */
const Ghost = component("Ghost", { at: 0 });

function quiet(name: string, phase: WorldPhase = "layout", run: () => void = () => undefined) {
  return system({ name, phase, query: [Marker], run });
}

/**
 * A world whose fake `time` hands out a clock of 0.5 ms a read; the clock spy is returned. One
 * entity carries `Marker`, so the systems over it run.
 */
function timedWorld(): { world: MockWorld; clock: ReturnType<typeof vi.fn> } {
  const world = createMockWorld();
  let now = 0;

  world.api.ecs.spawn({ kind: "plugin", name: "test" }, [Marker()]);
  const clock = vi.fn(() => {
    now += 0.5;

    return now;
  });

  Object.assign(world.ctx.require(timePlugin), { agentClock: () => clock });

  return { world, clock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("world.systemTimes in an agent build", () => {
  it("holds each system's time of the frame by registration index and starts each frame from 0", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { world } = timedWorld();

    world.api.ecs.system(quiet("ward.pan", "input"));
    world.api.ecs.system(quiet("ward.fog", "sync"));
    world.start();
    world.frame();
    world.frame();

    const times = world.api.systemTimes();

    expect(times?.names).toEqual(["ward.pan", "ward.fog"]);
    expect([...(times?.ms.subarray(0, 2) ?? [])]).toEqual([0.5, 0.5]);
  });

  it("answers the same live table every frame, so the monitor's read allocates nothing", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { world } = timedWorld();

    world.api.ecs.system(quiet("ward.pan"));
    world.start();
    world.frame();

    const first = world.api.systemTimes();

    world.frame();

    expect(world.api.systemTimes()).toBe(first);
  });

  it("grows the table for a system registered after start and keeps the rows it had", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { world } = timedWorld();
    const offPan = world.api.ecs.system(quiet("ward.pan"));

    world.start();
    world.frame();

    for (let index = 0; index < 20; index += 1) world.api.ecs.system(quiet(`extra.${index}`));

    expect(world.api.systemTimes()?.ms[0]).toBe(0.5);

    offPan();
    world.api.ecs.system(quiet("ward.pan"));
    world.frame();
    world.frame();

    const times = world.api.systemTimes();

    expect(times?.names.length).toBe(21);
    expect(times?.names[0]).toBe("ward.pan");
    expect(times?.ms[0]).toBe(0.5);
    expect(times?.ms[20]).toBe(0.5);
  });

  it("times a system that throws and still runs the next one", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { world } = timedWorld();
    const after = vi.fn();

    world.api.ecs.system(
      quiet("broken", "layout", () => {
        throw new Error("boom");
      })
    );
    world.api.ecs.system(quiet("after", "layout", after));
    world.start();
    world.frame();

    expect(after).toHaveBeenCalledTimes(1);
    expect(world.api.systemTimes()?.ms[0]).toBe(0.5);
    expect(world.log.error).toHaveBeenCalledWith(
      "world:system-failed",
      { system: "broken", phase: "layout" },
      new Error("boom")
    );
  });

  it("skips a system registered during the frame, as an untimed world does", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { world } = timedWorld();
    const late = vi.fn();

    world.api.ecs.system(
      quiet("spawner", "input", () => {
        world.api.ecs.system(quiet("late", "layout", late));
      })
    );
    world.start();
    world.frame();

    expect(late).not.toHaveBeenCalled();
  });
});

describe("world.systemTimes of a skipped system", () => {
  // Bug caught: the skip sits after the first clock read, so a system that did not run is still
  // timed and shows up in the monitor's slowest five.
  it("a system whose query has no entity takes no clock read in an agent build", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { world, clock } = timedWorld();

    world.api.ecs.system(
      system({ name: "board.looks", phase: "layout", query: [Ghost], run: () => undefined })
    );
    world.api.ecs.system(quiet("hud.pulse"));
    world.start();
    world.frame();
    clock.mockClear();
    world.frame();

    const times = world.api.systemTimes();

    expect(clock).toHaveBeenCalledTimes(2);
    expect(times?.names).toEqual(["board.looks", "hud.pulse"]);
    expect([...(times?.ms.subarray(0, 2) ?? [])]).toEqual([0, 0.5]);
  });
});

describe("world.systemTimes names identity", () => {
  // Bug caught: the names grow in place, so a reader that kept the array (the monitor's ring)
  // cannot tell a new system registered: the old reference would show the new name too.
  it("hands out a new names array when a system registers and leaves the old one as it was", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { world } = timedWorld();

    world.api.ecs.system(quiet("ward.pan"));
    world.start();
    world.frame();

    const before = world.api.systemTimes()?.names;

    world.api.ecs.system(quiet("ward.fog"));

    const after = world.api.systemTimes()?.names;

    expect(after).not.toBe(before);
    expect(before).toEqual(["ward.pan"]);
    expect(after).toEqual(["ward.pan", "ward.fog"]);
  });

  // Bug caught: a new array per frame or per re-registration makes the reader see growth that is
  // not there, and allocates on the frame path.
  it("keeps the same names array across frames and for a system that comes back under its name", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { world } = timedWorld();
    const off = world.api.ecs.system(quiet("ward.pan"));

    world.start();
    world.frame();

    const names = world.api.systemTimes()?.names;

    world.frame();
    off();
    world.api.ecs.system(quiet("ward.pan"));
    world.frame();

    expect(world.api.systemTimes()?.names).toBe(names);
  });
});

describe("world.systemTimes without the agent flag", () => {
  it("is undefined and the clock is never read", () => {
    const { world, clock } = timedWorld();

    world.api.ecs.system(quiet("ward.pan"));
    world.start();
    world.frame();

    expect(world.api.systemTimes()).toBeUndefined();
    expect(clock).not.toHaveBeenCalled();
  });
});
