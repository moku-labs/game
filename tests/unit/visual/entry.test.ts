import { readFile } from "node:fs/promises";
import * as engine from "@moku-labs/game";
import * as testing from "@moku-labs/game/testing";
import * as visual from "@moku-labs/game/visual";
import { describe, expect, it } from "vitest";
import { defineVisualTest } from "../../../src/visual/define";
import { parseVisualArgv, runVisualTests } from "../../../src/visual/run";

// ---------------------------------------------------------------------------
// Unit: the visual tests are reached through ./visual only; ./testing and the
// root keep none of them; the fixture's script runs them from the source
// ---------------------------------------------------------------------------

/** The functions of the visual entry. */
const visualFunctions = ["defineVisualTest", "parseVisualArgv", "runVisualTests"];

/** The types of the visual entry. */
const visualTypes = [
  "CheckpointResult",
  "VisualApp",
  "VisualOptions",
  "VisualPage",
  "VisualRenderer",
  "VisualReport",
  "VisualSetup",
  "VisualStart",
  "VisualStep",
  "VisualTest",
  "VisualTestResult",
  "VisualTolerance"
];

/**
 * Reads the names a re-export entry under `src/` exports, types included: every name in its
 * `export { … } from` and `export type { … } from` lists.
 *
 * @param entry - The entry file, such as `visual.ts`.
 * @returns The exported names, sorted.
 */
async function exportedNames(entry: string): Promise<string[]> {
  const source = await readFile(new URL(`../../../src/${entry}`, import.meta.url), "utf8");

  return [...source.matchAll(/export (?:type )?\{([^}]*)\}/gu)]
    .flatMap(match => (match[1] ?? "").split(","))
    .map(name => name.trim())
    .filter(name => name !== "")
    .toSorted();
}

describe("the ./visual entry", () => {
  it("exports the three visual functions and nothing else at runtime", () => {
    expect(Object.keys(visual).toSorted()).toEqual(visualFunctions);
    expect(visual.defineVisualTest).toBe(defineVisualTest);
    expect(visual.runVisualTests).toBe(runVisualTests);
    expect(visual.parseVisualArgv).toBe(parseVisualArgv);
  });

  it("exports exactly the visual functions and types", async () => {
    expect(await exportedNames("visual.ts")).toEqual(
      [...visualFunctions, ...visualTypes].toSorted()
    );
  });
});

describe("the ./testing entry", () => {
  it("exports the headless helpers only", () => {
    expect(Object.keys(testing).toSorted()).toEqual([
      "createHeadless",
      "fakeClock",
      "memory",
      "runRepro",
      "saveOf",
      "stepFrames"
    ]);
  });

  it("exports none of the visual names, types included", async () => {
    const names = await exportedNames("testing.ts");

    expect(names.filter(name => [...visualFunctions, ...visualTypes].includes(name))).toEqual([]);
    expect(names).toContain("HeadlessGame");
  });

  it("keeps the root free of them", () => {
    const names = Object.keys(engine);

    for (const name of visualFunctions) {
      expect(names).not.toContain(name);
    }
  });
});

describe("the fixture's visual script", () => {
  it("runs the engine from src/, so a stale dist/ never writes baselines", async () => {
    const script = await readFile(new URL("../../visual/run.ts", import.meta.url), "utf8");
    const specifiers = [...script.matchAll(/from "([^"]+)"/gu)].map(match => match[1]);

    expect(specifiers).toContain("../../src/visual");
    expect(specifiers.filter(specifier => specifier?.startsWith("@moku-labs/game"))).toEqual([]);
  });
});
