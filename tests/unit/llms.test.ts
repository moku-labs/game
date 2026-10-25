import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// `llms.txt` is what an agent reads before it writes a game: every name a game can import from the
// root must be in it (F78). A name added to `src/index.ts` without a line there fails this test.
// ---------------------------------------------------------------------------

/** The root entry, whose exports are the public names. */
const INDEX = fileURLToPath(new URL("../../src/index.ts", import.meta.url));

/** The text agents read. */
const LLMS = readFileSync(new URL("../../llms.txt", import.meta.url), "utf8");

/**
 * Every name the root entry exports, values and types, through its `export *` re-exports.
 *
 * @returns The names, sorted.
 */
function publicNames(): string[] {
  const program = ts.createProgram([INDEX], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: "@moku-labs/game",
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(INDEX);
  const module = source === undefined ? undefined : checker.getSymbolAtLocation(source);

  if (module === undefined) throw new Error("src/index.ts did not resolve to a module");

  return checker
    .getExportsOfModule(module)
    .map(symbol => symbol.name)
    .toSorted();
}

/**
 * Tells whether `llms.txt` names `name` as a whole word.
 *
 * @param name - An exported name.
 * @returns True when it is there.
 */
function mentioned(name: string): boolean {
  const escaped = name.replaceAll("$", String.raw`\$`);

  return new RegExp(String.raw`(^|[^\w$])${escaped}($|[^\w$])`).test(LLMS);
}

describe("llms.txt", () => {
  // Bug: a public name ships without a word in llms.txt, so an agent writing a game never learns it.
  it("names every export of the root entry", () => {
    const names = publicNames();

    expect(names.length).toBeGreaterThan(100);
    expect(names.filter(name => !mentioned(name))).toEqual([]);
  });
});
