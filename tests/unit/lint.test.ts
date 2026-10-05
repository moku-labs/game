import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Unit test: probes of eslint.config.ts. A later block that sets a rule again
// replaces it as a whole, so each probe lints a snippet at a real path and
// checks the rule still reports there.
// ---------------------------------------------------------------------------

/** The repository root, where eslint.config.ts lives. */
const ROOT = new URL("../../", import.meta.url).pathname;

/** The folders of block 6d (L1), which sets the L2 rule again, and one folder only block 6c covers. */
const L2_FOLDERS = ["model", "flow", "world", "renderer", "anim", "ui", "effects", "i18n"];

/** One folder where block 6e (L3) sets the L5 rule again, and one where only block 6c sets it. */
const L5_FOLDERS = ["model", "i18n"];

/**
 * Lint a snippet as if it were a file of the repository.
 *
 * @param code - The source text.
 * @param path - The path the snippet pretends to live at, relative to the root.
 * @returns The messages of the two rules L2 and L5 use.
 */
async function lint(code: string, path: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: `${ROOT}${path}` });

  return (result?.messages ?? [])
    .filter(
      message =>
        message.ruleId === "@typescript-eslint/no-restricted-imports" ||
        message.ruleId === "no-restricted-syntax"
    )
    .map(message => message.message);
}

describe("L2: no static Pixi import", () => {
  it.each(L2_FOLDERS)("reports a static pixi.js import under src/plugins/%s/x/", async folder => {
    const messages = await lint(
      'import { Application } from "pixi.js";\n\nexport const app = Application;\n',
      `src/plugins/${folder}/x/probe.ts`
    );

    expect(messages).toEqual([
      "'pixi.js' import is restricted from being used. Load Pixi lazily with import() in renderer onStart. Types may be imported."
    ]);
  });

  it("allows a type import of pixi.js under src/plugins/model/x/", async () => {
    const messages = await lint(
      'import type { Application } from "pixi.js";\n\nexport type App = Application;\n',
      "src/plugins/model/x/probe.ts"
    );

    expect(messages).toEqual([]);
  });
});

describe("L5: no module-scope collections", () => {
  it.each(
    L5_FOLDERS
  )("reports each collection at module scope under src/plugins/%s/", async folder => {
    const messages = await lint(
      "const a = new Map();\nexport const b = new Set();\nconst c = new WeakMap();\nexport const d = new WeakSet();\nexport { a, c };\n",
      `src/plugins/${folder}/probe.ts`
    );

    expect(messages).toEqual(Array.from({ length: 4 }, () => "No module-scope collections."));
  });

  it.each(
    L5_FOLDERS
  )("allows a Map inside an exported function under src/plugins/%s/", async folder => {
    const messages = await lint(
      "export function f(): number {\n  const m = new Map();\n  return m.size;\n}\n",
      `src/plugins/${folder}/probe.ts`
    );

    expect(messages).toEqual([]);
  });
});
