import { describe, expect, it } from "vitest";
import { component, system } from "../../ecs/define";
import type { Owner, WorldPhase } from "../../ecs/types";
import { createMockWorld } from "./mock-world";

const Marker = component("Marker", { at: 0 });
const test: Owner = { kind: "plugin", name: "test" };

/**
 * Builds a system that records its name in `order` when it runs.
 *
 * @param name - System name.
 * @param phase - Phase it belongs to.
 * @param order - The shared recorder.
 * @returns The system definition.
 */
function recorder(name: string, phase: WorldPhase, order: string[]) {
  return system({
    name,
    phase,
    query: [Marker],
    run: entities => {
      for (const [entity] of entities) if (Number.isSafeInteger(entity)) order.push(name);
    }
  });
}

describe("ecs systems", () => {
  it("runs the phases in frame order and each phase in registration order", () => {
    const world = createMockWorld();
    const order: string[] = [];

    world.api.ecs.spawn(test, [Marker()]);
    world.api.ecs.system(recorder("sync-a", "sync", order));
    world.api.ecs.system(recorder("input-b", "input", order));
    world.api.ecs.system(recorder("input-a", "input", order));
    world.api.ecs.system(recorder("animate-a", "animate", order));
    world.api.ecs.system(recorder("layout-a", "layout", order));
    world.start();
    world.frame();

    expect(order).toEqual(["input-b", "input-a", "animate-a", "layout-a", "sync-a"]);
  });

  it("refuses a duplicate system name and returns a remover", () => {
    const world = createMockWorld();
    const order: string[] = [];
    const off = world.api.ecs.system(recorder("only", "input", order));

    expect(() => world.api.ecs.system(recorder("only", "sync", order))).toThrow("[game]");

    world.api.ecs.spawn(test, [Marker()]);
    world.start();
    off();
    off();
    world.frame();

    expect(order).toEqual([]);
  });

  it("runs a system registered during a frame from the next frame on", () => {
    const world = createMockWorld();
    const order: string[] = [];

    world.api.ecs.spawn(test, [Marker()]);
    world.api.ecs.system(
      system({
        name: "registrar",
        phase: "input",
        query: [Marker],
        run: (entities, ctx) => {
          for (const [entity] of entities) {
            if (!Number.isSafeInteger(entity) || order.includes("late")) return;
            ctx.world.system(recorder("late", "sync", order));
            order.push("registrar");
          }
        }
      })
    );
    world.start();
    world.frame();

    expect(order).toEqual(["registrar"]);

    world.frame();

    expect(order).toEqual(["registrar", "late"]);
  });

  it("logs a throwing system with its name and keeps the frame going", () => {
    const world = createMockWorld();
    const order: string[] = [];

    world.api.ecs.spawn(test, [Marker()]);
    world.api.ecs.system(
      system({
        name: "bad",
        phase: "input",
        query: [Marker],
        run: () => {
          throw new Error("boom");
        }
      })
    );
    world.api.ecs.system(recorder("good", "input", order));
    world.start();
    world.frame();

    expect(order).toEqual(["good"]);
    expect(world.log.error).toHaveBeenCalledWith(
      "world:system-failed",
      { system: "bad", phase: "input" },
      expect.any(Error)
    );
  });

  it("skips input, animate and layout in paused and fast, and still runs sync", () => {
    const world = createMockWorld();
    const order: string[] = [];

    world.api.ecs.spawn(test, [Marker()]);
    world.api.ecs.system(recorder("input-a", "input", order));
    world.api.ecs.system(recorder("animate-a", "animate", order));
    world.api.ecs.system(recorder("layout-a", "layout", order));
    world.api.ecs.system(recorder("sync-a", "sync", order));
    world.start();

    world.api.ecs.setMode("paused");
    world.frame();
    expect(order).toEqual(["sync-a"]);

    world.api.ecs.setMode("fast");
    world.frame();
    expect(order).toEqual(["sync-a", "sync-a"]);

    world.api.ecs.setMode("live");
    world.frame();
    expect(order).toEqual(["sync-a", "sync-a", "input-a", "animate-a", "layout-a", "sync-a"]);
  });

  it("reports the flow mode as the effective mode", () => {
    const world = createMockWorld();

    expect(world.api.ecs.mode()).toBe("live");

    world.flow.mode = "fast";
    expect(world.api.ecs.mode()).toBe("fast");

    world.flow.mode = "live";
    world.api.ecs.setMode("paused");
    expect(world.api.ecs.mode()).toBe("paused");
  });

  it("hands a system the world, the resources, the snapshot and the frame time", () => {
    const world = createMockWorld();
    const seen: Array<{ delta: number; coins: unknown }> = [];

    world.model.player = { coins: 4 };
    world.api.ecs.spawn(test, [Marker()]);
    world.api.ecs.system(
      system({
        name: "reader",
        phase: "input",
        query: [Marker],
        run: (entities, ctx) => {
          for (const [entity] of entities) {
            if (!Number.isSafeInteger(entity)) return;
            seen.push({
              delta: ctx.time.delta,
              coins: (ctx.snapshot.player as { coins: number }).coins
            });
          }
        }
      })
    );
    world.start();
    world.frame(20);

    expect(seen).toEqual([{ delta: 20, coins: 4 }]);
  });
});
