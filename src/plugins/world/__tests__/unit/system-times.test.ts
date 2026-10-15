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

function quiet(name: string, phase: WorldPhase = "layout", run: () => void = () => undefined) {
  return system({ name, phase, query: [Marker], run });
}

/** A world whose fake `time` hands out a clock of 0.5 ms a read; the clock spy is returned. */
function timedWorld(): { world: MockWorld; clock: ReturnType<typeof vi.fn> } {
  const world = createMockWorld();
  let now = 0;
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
