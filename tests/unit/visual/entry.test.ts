import * as engine from "@moku-labs/game";
import * as testing from "@moku-labs/game/testing";
import { describe, expect, it } from "vitest";
import { defineVisualTest } from "../../../src/visual/define";
import { parseVisualArgv, runVisualTests } from "../../../src/visual/run";

// ---------------------------------------------------------------------------
// Unit: the visual tests are reached through ./testing only; the root keeps
// none of them
// ---------------------------------------------------------------------------

describe("the ./testing entry", () => {
  it("exports the visual test helpers next to the headless ones", () => {
    expect(Object.keys(testing).toSorted()).toEqual([
      "createHeadless",
      "defineVisualTest",
      "fakeClock",
      "memory",
      "parseVisualArgv",
      "runRepro",
      "runVisualTests",
      "saveOf",
      "stepFrames"
    ]);
    expect(testing.defineVisualTest).toBe(defineVisualTest);
    expect(testing.runVisualTests).toBe(runVisualTests);
    expect(testing.parseVisualArgv).toBe(parseVisualArgv);
  });

  it("keeps the root free of them", () => {
    const names = Object.keys(engine);

    for (const name of ["defineVisualTest", "runVisualTests", "parseVisualArgv"]) {
      expect(names).not.toContain(name);
    }
  });
});
