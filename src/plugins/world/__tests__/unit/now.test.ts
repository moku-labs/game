import { describe, expect, it } from "vitest";
import { createApp } from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import { createModules } from "../../api";
import { Now, resource, system } from "../../ecs/define";
import { worldPlugin } from "../../index";
import { withDeps } from "../../lifecycle";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the resource `Now` (E9), the frame's moment on the game's clock, written by `world`
// from `clock.now()` once at start and first thing in every frame. The real time, clock and
// world plugins, headless: no renderer.
// ---------------------------------------------------------------------------

/** The moment the fake clock of every case starts on. */
const START = 1_790_000_000_000;

/**
 * Starts a headless app whose game clock is a fake one.
 *
 * @returns The started app and its clock.
 */
async function startWorld() {
  const clock = fakeClock(START);
  const app = createApp({ plugins: [worldPlugin], pluginConfigs: { clock: { source: clock } } });

  await app.start();

  return { app, clock };
}

describe("world — the resource Now", () => {
  it("holds the clock's moment from the start, before any frame, in a headless app", async () => {
    const { app } = await startWorld();

    expect(app.world.ecs.resource(Now).now).toBe(START);
    expect(app.world.ecs.snapshot().resources).toMatchObject({ Now: { now: START } });

    await app.stop();
  });

  it("hands every system of a frame the moment the clock stood at when the frame began", async () => {
    const { app, clock } = await startWorld();
    const seen: Array<[string, number]> = [];

    app.world.ecs.system(
      system({
        name: "test.typed",
        phase: "input",
        query: [],
        run: (_rows, { res }) => {
          seen.push(["input", res(Now).now]);
          // The clock goes on while the frame runs: the frame keeps its moment.
          clock.advance(5);
        }
      })
    );
    app.world.ecs.system(
      system({
        name: "test.toast",
        phase: "animate",
        query: [],
        run: (_rows, { res }) => {
          seen.push(["animate", res(Now).now]);
        }
      })
    );

    clock.advance(16);
    app.time.step(16);

    expect(seen).toEqual([
      ["input", START + 16],
      ["animate", START + 16]
    ]);

    app.time.step(16);

    // The 5 ms the clock moved during the first frame are seen from the next one on.
    expect(seen.slice(2)).toEqual([
      ["input", START + 21],
      ["animate", START + 21]
    ]);

    await app.stop();
  });

  it("overwrites a system's write into Now at the next frame", async () => {
    const { app } = await startWorld();

    app.world.ecs.system(
      system({
        name: "test.meddler",
        phase: "layout",
        query: [],
        run: (_rows, { res }) => {
          res(Now).now = 0;
        }
      })
    );
    app.time.step(16);

    expect(app.world.ecs.resource(Now).now).toBe(0);

    // Read in the next frame before the layout system runs again: the frame's moment is back.
    const seen: number[] = [];

    app.world.ecs.system(
      system({
        name: "test.reader",
        phase: "input",
        query: [],
        run: (_rows, { res }) => {
          seen.push(res(Now).now);
        }
      })
    );
    app.time.step(16);

    expect(seen).toEqual([START]);

    await app.stop();
  });

  it("is 0 after ecs.clear() and holds the clock's moment again from the next frame", () => {
    const world = createMockWorld();

    world.start();
    // The internal clear a restore and a hot swap use: the resources go with everything else.
    createModules(withDeps(world.ctx)).ecs.clear();

    expect(world.api.ecs.resource(Now).now).toBe(0);

    world.clock.advance(16);
    world.frame();

    expect(world.api.ecs.resource(Now).now).toBe(START + 16);
  });

  it("refuses a game resource named Now, naming it, and leaves a game resource of its own name alone", async () => {
    const { app } = await startWorld();
    const GameNow = resource("Now", { now: 0 });
    const Clock = resource("Clock", { now: 0 });

    expect(() => app.world.ecs.resource(GameNow)).toThrow(
      `[game] world: the resource name "Now" is the engine's (the frame's moment).\n  Rename the game's resource.`
    );

    app.world.ecs.resource(Clock).now = 7;
    app.time.step(16);

    expect(app.world.ecs.resource(Clock).now).toBe(7);
    expect(app.world.ecs.resource(Now).now).toBe(START);

    await app.stop();
  });

  it("refuses a second type under another engine resource name, Pointer", () => {
    const world = createMockWorld();
    const InputPointer = resource("Pointer", { x: 0 });
    const GamePointer = resource("Pointer", { x: 0 });

    world.api.ecs.resource(InputPointer).x = 3;

    expect(() => world.api.ecs.resource(GamePointer)).toThrow(
      `the resource name "Pointer" is the engine's (the pointer of input)`
    );
    expect(world.api.ecs.resource(InputPointer).x).toBe(3);
  });
});
