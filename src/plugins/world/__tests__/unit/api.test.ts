import { describe, expect, it } from "vitest";
import { commitItems, mountBoard, Transform, viewOf } from "./board";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: createWorldApi (module composition and the public surface)
// ---------------------------------------------------------------------------

const ECS_MEMBERS = [
  "add",
  "changed",
  "despawn",
  "despawnOwnedBy",
  "get",
  "has",
  "mode",
  "onAdded",
  "onRemoved",
  "query",
  "remove",
  "resource",
  "set",
  "setMode",
  "snapshot",
  "spawn",
  "system",
  "tag",
  "typeOf",
  "untag"
];

const ECS_INTERNALS = ["onOwnerLeft", "ownerOf", "runPhase", "flush", "clearChanges", "clear"];

const PROJECTION_MEMBERS = [
  "entitiesOf",
  "entityOf",
  "keyOf",
  "layers",
  "lift",
  "mount",
  "mute",
  "register",
  "registerKey",
  "rerunAll",
  "restOf",
  "setDriver",
  "setLayers",
  "setRest",
  "settle",
  "unmount",
  "viewOf"
];

const PROJECTION_INTERNALS = [
  "markDirty",
  "reconcileIfDirty",
  "dropHints",
  "pushHint",
  "sweep",
  "flushAll",
  "ownerLeft",
  "clear"
];

describe("createWorldApi", () => {
  it("groups the API by module", () => {
    const world = createMockWorld();

    expect(Object.keys(world.api).toSorted()).toEqual(["ecs", "projection"]);
  });

  it("exposes exactly the public members of ecs", () => {
    const world = createMockWorld();

    expect(Object.keys(world.api.ecs).toSorted()).toEqual(ECS_MEMBERS);
  });

  it("keeps the internal half of ecs off the public API", () => {
    const world = createMockWorld();
    const exposed = new Set(Object.keys(world.api.ecs));

    for (const internal of ECS_INTERNALS) expect(exposed.has(internal)).toBe(false);
  });

  it("exposes exactly the public members of projection", () => {
    const world = createMockWorld();

    expect(Object.keys(world.api.projection).toSorted()).toEqual(PROJECTION_MEMBERS);
  });

  it("keeps the internal half of projection off the public API", () => {
    const world = createMockWorld();
    const exposed = new Set(Object.keys(world.api.projection));

    for (const internal of PROJECTION_INTERNALS) expect(exposed.has(internal)).toBe(false);
  });

  it("builds both modules over the one plugin state, so the views agree", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn({ kind: "plugin", name: "test" }, [Transform()]);

    expect(world.ctx.state.ecs.owners.has(entity)).toBe(true);
    expect(world.api.ecs.has(entity, Transform)).toBe(true);
  });

  it("finishes every motion and flushes the despawn queue when setMode turns fast", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      exit: view => view.tween(Transform, { x: 900 }, { ms: 1000, ease: "linear" })
    });
    commitItems(world, []);
    world.frame(16);

    expect(viewOf(world, "a")).toBeDefined();
    expect(world.ctx.state.projection.tracks).toHaveLength(1);

    world.api.ecs.setMode("fast");

    expect(viewOf(world, "a")).toBeUndefined();
    expect(world.ctx.state.projection.tracks).toEqual([]);
    expect(world.api.ecs.mode()).toBe("fast");
  });

  it("leaves the queue alone for a mode that is not fast", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      exit: view => view.tween(Transform, { x: 900 }, { ms: 1000, ease: "linear" })
    });
    commitItems(world, []);
    world.frame(16);

    world.api.ecs.setMode("paused");

    expect(viewOf(world, "a")).toBeDefined();
    expect(world.api.ecs.mode()).toBe("paused");
  });
});
