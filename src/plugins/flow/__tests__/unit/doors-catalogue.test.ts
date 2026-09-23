import { describe, expect, it } from "vitest";
import { commands } from "../../doors/commands";
import { sources } from "../../doors/sources";

// ---------------------------------------------------------------------------
// Unit test: the base catalogue of the doors — every descriptor is listed
// once, under its short name, with a title and a valid schema
// ---------------------------------------------------------------------------

const KINDS = new Set(["string", "number", "boolean", "json"]);
const CHANGES = new Set(["frame", "commit", "edge"]);
const EFFECTS = new Set(["read", "route", "cosmetic", "cheat", "raw"]);

/** Every descriptor of both lists. */
const all = [...Object.values(sources), ...Object.values(commands)];

describe("the base catalogue", () => {
  it("lists the sources and the commands of page 7", () => {
    expect(Object.keys(sources)).toEqual([
      "graph",
      "position",
      "history",
      "tainted",
      "cheats",
      "model",
      "entities",
      "projections",
      "ui",
      "rect",
      "render",
      "sounds",
      "assets",
      "log"
    ]);
    expect(Object.keys(commands)).toEqual([
      "answer",
      "tap",
      "drag",
      "key",
      "walk",
      "bookmark",
      "restore",
      "step",
      "pause",
      "resume",
      "capture",
      "debug",
      "reducedMotion"
    ]);
  });

  it("gives every descriptor a unique id, named game.<short name>", () => {
    const ids = all.map(descriptor => descriptor.id);

    expect(new Set(ids).size).toBe(ids.length);

    for (const [name, source] of Object.entries(sources)) expect(source.id).toBe(`game.${name}`);
    for (const [name, command] of Object.entries(commands)) expect(command.id).toBe(`game.${name}`);
  });

  it("gives every descriptor a title and a schema of known kinds", () => {
    for (const descriptor of all) {
      expect(descriptor.title.trim()).not.toBe("");
      expect(Object.isFrozen(descriptor.input)).toBe(true);

      for (const kind of Object.values(descriptor.input)) {
        expect(KINDS.has(kind.replace(/\?$/u, ""))).toBe(true);
      }
    }
  });

  it("gives every source a change key and every command an effect", () => {
    for (const source of Object.values(sources)) expect(CHANGES.has(source.changes)).toBe(true);
    for (const command of Object.values(commands)) expect(EFFECTS.has(command.effect)).toBe(true);
  });

  it("is frozen, and so is every descriptor", () => {
    expect(Object.isFrozen(sources)).toBe(true);
    expect(Object.isFrozen(commands)).toBe(true);
    expect(all.every(descriptor => Object.isFrozen(descriptor))).toBe(true);
  });
});
