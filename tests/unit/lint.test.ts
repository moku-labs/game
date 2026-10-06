import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Unit test: probes of eslint.config.ts. A later block that sets a rule again
// replaces it as a whole, so each probe lints a snippet at a real path and
// checks the rule still reports there.
// ---------------------------------------------------------------------------

/** The repository root, where eslint.config.ts lives. */
const ROOT = new URL("../../", import.meta.url).pathname;

/** The folders of block 6d2 (L1), which sets the L2 rule again, and one folder only block 6c covers. */
const L2_FOLDERS = ["model", "flow", "world", "renderer", "anim", "ui", "effects", "i18n"];

/** One folder where block 6e2 (L3) sets the L5 rule again, and one where only block 6c sets it. */
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

/**
 * Lint a snippet and keep the messages of the core `no-restricted-imports` rule (L9, L10, L12 and
 * the project index boundary).
 *
 * @param code - The source text.
 * @param path - The path the snippet pretends to live at, relative to the root.
 * @returns The messages of that rule.
 */
async function lintBoundary(code: string, path: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: `${ROOT}${path}` });

  return (result?.messages ?? [])
    .filter(message => message.ruleId === "no-restricted-imports")
    .map(message => message.message);
}

describe("L2: typescript is an optional peer", () => {
  it.each([
    "src/plugins/model/x/probe.ts",
    "src/project/probe.ts"
  ])("reports a static value import of typescript in %s", async path => {
    const messages = await lint(
      'import ts from "typescript";\n\nexport const version = ts.version;\n',
      path
    );

    expect(messages).toEqual([
      "'typescript' import is restricted from being used. typescript is an optional peer. Load it with await import() in src/project/typescript.ts only."
    ]);
  });

  it("allows a type import of typescript under src/project/", async () => {
    const messages = await lint(
      'import type ts from "typescript";\n\nexport type Node = ts.Node;\n',
      "src/project/probe.ts"
    );

    expect(messages).toEqual([]);
  });
});

describe("the project index is node-only", () => {
  const message = "The project index is node-only. Only src/project.ts imports it.";

  it.each([
    "src/plugins/flow/probe.ts",
    "src/plugins/ui/probe.ts"
  ])("reports an import of src/project/ from %s", async path => {
    const messages = await lintBoundary(
      'import { openProject } from "../../project/open";\n\nexport const open = openProject;\n',
      path
    );

    expect(messages.some(text => text.includes(message))).toBe(true);
  });

  it("allows the door src/project.ts and the files of src/project/", async () => {
    const door = await lintBoundary(
      'import { openProject } from "./project/open";\n\nexport const open = openProject;\n',
      "src/project.ts"
    );
    const inside = await lintBoundary(
      'import { findKey } from "../project/find";\n\nexport const find = findKey;\n',
      "src/project/extract/probe.ts"
    );

    expect(door).toEqual([]);
    expect(inside).toEqual([]);
  });
});

/**
 * Lint a snippet and keep the messages of the engine's own L13 rule.
 *
 * @param code - The source text.
 * @param path - The path the snippet pretends to live at, relative to the root.
 * @returns The messages of that rule.
 */
async function lintNative(code: string, path: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: `${ROOT}${path}` });

  return (result?.messages ?? [])
    .filter(message => message.ruleId === "l13/native-imports")
    .map(message => message.message);
}

describe("L13: a native package only in its home, and there only lazily", () => {
  it.each([
    ["src/app/system.ts", "@moku-labs/system"],
    ["src/app/native.ts", "@moku-labs/native"]
  ])("%s reaches %s by import() and import type only", async (path, name) => {
    const valueImport = await lintNative(
      `import { createApp } from "${name}";\n\nexport const make = createApp;\n`,
      path
    );
    const valueExport = await lintNative(`export { createApp } from "${name}";\n`, path);
    const typeImport = await lintNative(
      `import type { Config } from "${name}";\n\nexport type Probe = Config;\n`,
      path
    );
    const typeExport = await lintNative(`export type { Config } from "${name}";\n`, path);
    const lazy = await lintNative(`export const load = () => import("${name}");\n`, path);

    expect(valueImport).toHaveLength(1);
    expect(valueExport).toHaveLength(1);
    expect([...typeImport, ...typeExport, ...lazy]).toEqual([]);
  });

  it("refuses a type import of a native package outside its home", async () => {
    const messages = await lintNative(
      'import type { Config } from "@moku-labs/native";\n\nexport type Probe = Config;\n',
      "src/app/page.ts"
    );

    expect(messages).toHaveLength(1);
  });
});
