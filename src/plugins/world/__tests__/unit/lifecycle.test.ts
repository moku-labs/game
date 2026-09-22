import { describe, expect, it } from "vitest";
import { component, system } from "../../ecs/define";
import { clearWorld } from "../../lifecycle";
import { boardItems, Level } from "./board";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: connectWorld (features, frame callbacks, hint intake) and clearWorld
// ---------------------------------------------------------------------------

const Bobbing = component("Bobbing", { amplitude: 4 });

const drift = system({ name: "drift", phase: "animate", query: [Level], run: () => {} });

describe("connectWorld", () => {
  it("registers one callback per frame phase, in phase order", () => {
    const world = createMockWorld();

    world.start();

    expect(world.frames.map(entry => entry.phase)).toEqual([
      "input",
      "animate",
      "layout",
      "sync",
      "signals"
    ]);
  });

  it("registers the components, systems and projections a feature brought", () => {
    const world = createMockWorld();

    world.features.push({
      name: "board",
      description: { components: [Level, Bobbing], systems: [drift], projections: [boardItems()] }
    });
    world.start();

    expect([...world.ctx.state.ecs.types.keys()]).toEqual(["Level", "Bobbing"]);
    expect(world.ctx.state.ecs.systems.animate).toHaveLength(1);
    expect([...world.ctx.state.projection.specs.keys()]).toEqual(["board.items"]);
  });

  it("reports a feature entry of the wrong shape and skips only that entry", () => {
    const world = createMockWorld();

    world.features.push({
      name: "broken",
      description: {
        components: [Level, "Bobbing"],
        systems: [{ name: "half" }, drift],
        projections: [{ name: "board.items" }]
      }
    });
    world.start();

    for (const key of ["components", "systems", "projections"]) {
      expect(world.log.warn).toHaveBeenCalledWith("world:bad-feature-entry", {
        feature: "broken",
        key
      });
    }

    expect([...world.ctx.state.ecs.types.keys()]).toEqual(["Level"]);
    expect(world.ctx.state.ecs.systems.animate).toHaveLength(1);
    expect(world.ctx.state.projection.specs.size).toBe(0);
  });

  it("ignores a feature that brought none of the three keys", () => {
    const world = createMockWorld();

    world.features.push({ name: "logic", description: { flows: [] } });
    world.start();

    expect(world.log.warn).not.toHaveBeenCalled();
    expect(world.ctx.state.projection.specs.size).toBe(0);
  });

  it("buffers a released hint through flow.fx.onHint", () => {
    const world = createMockWorld();

    world.start();
    world.release({ kind: "merged", payload: { from: "a" }, hint: true });

    expect(world.ctx.state.projection.hints).toHaveLength(1);
  });
});

describe("clearWorld", () => {
  it("removes the frame callbacks and the hint listener", () => {
    const world = createMockWorld();

    world.start();
    world.api.projection.register(boardItems());
    expect(world.frames).toHaveLength(5);

    clearWorld(world.ctx.state);

    expect(world.frames).toHaveLength(0);
    expect(world.ctx.state.ecs.offFrame).toEqual([]);
    expect(world.ctx.state.projection.offHints).toEqual([]);
    expect(world.ctx.state.projection.specs.size).toBe(0);
  });

  it("drops every entity, resource, system and layer list", () => {
    const world = createMockWorld();

    world.start();
    world.api.projection.setLayers([{ name: "items", sort: "y" }]);
    world.api.ecs.spawn({ kind: "plugin", name: "test" }, [Level({ level: 1 })]);
    world.api.ecs.system(drift);
    world.api.ecs.setMode("paused");

    clearWorld(world.ctx.state);

    expect(world.ctx.state.ecs.owners.size).toBe(0);
    expect(world.ctx.state.ecs.stores.size).toBe(0);
    expect(world.ctx.state.ecs.resources.size).toBe(0);
    expect(world.ctx.state.ecs.systems.animate).toEqual([]);
    expect(world.api.projection.layers()).toEqual([]);
    expect(world.ctx.state.ecs.mode).toBe("live");
  });
});
