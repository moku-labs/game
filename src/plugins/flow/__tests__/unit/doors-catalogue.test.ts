import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "../../doors/commands";
import { controlRefused } from "../../doors/dev";
import { sources } from "../../doors/sources";
import type { Effect } from "../../doors/types";

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
      "locate",
      "render",
      "sounds",
      "audioMuted",
      "effects",
      "filters",
      "assets",
      "log",
      "explain",
      "diff",
      "schema",
      "at"
    ]);
    expect(Object.keys(commands)).toEqual([
      "answer",
      "tap",
      "drag",
      "key",
      "walk",
      "bookmark",
      "restore",
      "saveExport",
      "saveImport",
      "step",
      "pause",
      "resume",
      "capture",
      "debug",
      "reducedMotion",
      "fill",
      "scroll",
      "timeScale",
      "frameRate",
      "mute",
      "trace",
      "filter"
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

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Runs a command body directly, on an app that has nothing, and tells whether its first
 * statement, the inline guard, refused it. A body past its guard fails on the empty app instead.
 *
 * @param command - The command.
 * @returns True when the body threw the refusal of a production build.
 */
async function refusedByGuard(command: (typeof commands)[keyof typeof commands]): Promise<boolean> {
  try {
    await command.run(Object.freeze({}) as never, {} as never);
  } catch (error) {
    return error instanceof Error && error.message === controlRefused().message;
  }

  return false;
}

/** The effects a `--debug` page runs. */
const READ_PROFILE: ReadonlySet<Effect> = new Set(["read", "cosmetic"]);

describe("the guard of every command body", () => {
  it("with only AGENT true, a read or cosmetic body passes its guard and every other body refuses", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    for (const command of Object.values(commands)) {
      expect(await refusedByGuard(command), command.id).toBe(!READ_PROFILE.has(command.effect));
    }
  });
});
