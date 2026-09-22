import { describe, expect, it } from "vitest";
import { createWorldState } from "../../state";
import type { Config } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: createWorldState (the two module states composed into one)
// ---------------------------------------------------------------------------

const config: Config = { settleMs: 350, reconciledEvent: false };

const build = (): ReturnType<typeof createWorldState> => createWorldState({ global: {}, config });

describe("createWorldState", () => {
  it("composes one branch per module", () => {
    expect(Object.keys(build()).toSorted()).toEqual(["ecs", "projection"]);
  });

  it("starts the ecs branch with no entity, type, store, resource or system", () => {
    const state = build();

    expect(state.ecs.generations).toEqual([]);
    expect(state.ecs.free).toEqual([]);
    expect(state.ecs.owners.size).toBe(0);
    expect(state.ecs.byOwner.size).toBe(0);
    expect(state.ecs.types.size).toBe(0);
    expect(state.ecs.stores.size).toBe(0);
    expect(state.ecs.resources.size).toBe(0);
    expect(state.ecs.systems).toEqual({ input: [], animate: [], layout: [], sync: [] });
  });

  it("starts the ecs branch live, outside a phase, with nothing queued or changed", () => {
    const state = build();

    expect(state.ecs.mode).toBe("live");
    expect(state.ecs.running).toBeUndefined();
    expect(state.ecs.commands).toEqual([]);
    expect(state.ecs.changed.size).toBe(0);
    expect(state.ecs.added.size).toBe(0);
    expect(state.ecs.removed.size).toBe(0);
    expect(state.ecs.ownerLeft).toEqual([]);
    expect(state.ecs.offFrame).toEqual([]);
    expect(state.ecs.frameSnapshot).toBeUndefined();
  });

  it("starts the projection branch with nothing registered, mounted or running", () => {
    const state = build();

    expect(state.projection.specs.size).toBe(0);
    expect(state.projection.mounted.size).toBe(0);
    expect(state.projection.byEntity.size).toBe(0);
    expect(state.projection.mutes.size).toBe(0);
    expect(state.projection.tracks).toEqual([]);
    expect(state.projection.driver).toBeUndefined();
    expect(state.projection.rests.size).toBe(0);
    expect(state.projection.keys.size).toBe(0);
    expect(state.projection.keysByEntity.size).toBe(0);
    expect(state.projection.hints).toEqual([]);
    expect(state.projection.dirty).toBeUndefined();
    expect(state.projection.offHints).toEqual([]);
  });

  it("starts with a frozen, empty layer list", () => {
    const state = build();

    expect(state.projection.layers).toEqual([]);
    expect(Object.isFrozen(state.projection.layers)).toBe(true);
  });

  it("gives every call its own collections, so two apps never share a world", () => {
    const first = build();
    const second = build();

    first.ecs.owners.set(1, { kind: "plugin", name: "test" });
    first.ecs.systems.input.push({
      definition: { name: "noop", phase: "input", query: [], run: () => {} },
      frame: 0
    });
    first.projection.hints.push({ kind: "merged", hint: true });

    expect(second.ecs.owners.size).toBe(0);
    expect(second.ecs.systems.input).toEqual([]);
    expect(second.projection.hints).toEqual([]);
    expect(first.ecs.systems).not.toBe(second.ecs.systems);
    expect(first.ecs.stores).not.toBe(second.ecs.stores);
    expect(first.projection.specs).not.toBe(second.projection.specs);
  });
});
