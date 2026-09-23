import * as engine from "@moku-labs/game";
import * as control from "@moku-labs/game/control";
import * as inspect from "@moku-labs/game/inspect";
import { describe, expect, it } from "vitest";
import { commands, sources } from "../../src/plugins/flow/doors/catalogue";

// ---------------------------------------------------------------------------
// Unit test: the two editor doors resolve by their package subpaths and
// re-export only; the root keeps none of them
// ---------------------------------------------------------------------------

describe("the editor doors", () => {
  it("./inspect exports the read side", () => {
    expect(Object.keys(inspect).toSorted()).toEqual(["defineSource", "read", "sources", "watch"]);
    expect(inspect.sources).toBe(sources);
  });

  it("./control exports the write side", () => {
    expect(Object.keys(control).toSorted()).toEqual([
      "commands",
      "controlRefused",
      "defineCommand",
      "run"
    ]);
    expect(control.commands).toBe(commands);
  });

  it("the root exports neither door, nor any descriptor", () => {
    const names = Object.keys(engine);

    for (const name of ["sources", "commands", "read", "watch", "run", "defineSource"]) {
      expect(names).not.toContain(name);
    }
    expect(names.filter(name => /(Source|Command)$/u.test(name))).toEqual([]);
  });
});
