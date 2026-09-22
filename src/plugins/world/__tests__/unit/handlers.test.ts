import { describe, expect, it } from "vitest";
import { createHandlers } from "../../handlers";
import type { ModelCommitted } from "../../types";
import { BOARD, commitItems, Level, mountBoard, Transform } from "./board";
import type { MockWorld } from "./mock-world";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: createHandlers (the `model:committed` hook)
// ---------------------------------------------------------------------------

/**
 * Fires the hook the way the kernel does, on a freshly built handler table.
 *
 * @param world - The mock world.
 * @param payload - Roots and cause of the commit.
 */
function fire(world: MockWorld, payload: ModelCommitted): void {
  createHandlers(world.ctx)["model:committed"](payload);
}

describe("createHandlers", () => {
  it("declares exactly the one hook world listens to", () => {
    const world = createMockWorld();

    expect(Object.keys(createHandlers(world.ctx))).toEqual(["model:committed"]);
  });

  it("records the cause and the roots instead of reconciling", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.model.player = { items: [{ id: "a", level: 2, x: 0, y: 0 }] };

    fire(world, { roots: ["player"], cause: "edge" });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(world.ctx.state.projection.dirty?.causes).toEqual(["edge"]);
    expect([...(world.ctx.state.projection.dirty?.roots ?? [])]).toEqual(["player"]);
    expect(world.ctx.state.projection.dirty?.force).toBe(false);
    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 1 });
  });

  it("merges two commits of one frame into one dirty record", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    fire(world, { roots: ["player"], cause: "edge" });
    fire(world, { roots: ["session", "rng"], cause: "rollback" });

    expect(world.ctx.state.projection.dirty?.causes).toEqual(["edge", "rollback"]);
    expect([...(world.ctx.state.projection.dirty?.roots ?? [])].toSorted()).toEqual([
      "player",
      "rng",
      "session"
    ]);
  });

  it("reconciles at once, direct, in fast mode", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: { Transform: view => view.toRest(Transform, { ms: 300 }) }
    });

    world.flow.mode = "fast";
    world.model.player = { items: [{ id: "a", level: 2, x: 250, y: 0 }] };

    fire(world, { roots: ["player"], cause: "edge" });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 2 });
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 250, y: 0, scale: 1 });
    expect(world.ctx.state.projection.dirty).toBeUndefined();
    expect(world.ctx.state.projection.tracks).toEqual([]);
  });

  it("hands the recorded commit to the reconcile of the next frame", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    commitItems(world, [{ id: "a", level: 4, x: 0, y: 0 }]);
    world.frame();

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 4 });
    expect(world.ctx.state.projection.dirty).toBeUndefined();
  });

  it("resolves no dependency before the hook fires", () => {
    const world = createMockWorld();

    expect(() => createHandlers(world.ctx)).not.toThrow();
    expect(world.ctx.state.projection.dirty).toBeUndefined();
  });
});
