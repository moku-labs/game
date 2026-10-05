import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GameLintContext, GameLintNode, GameLintRuleName } from "@moku-labs/game/lint";
import plugin, { globToRegExp } from "@moku-labs/game/lint";
import { afterAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Unit test: the `@moku-labs/game/lint` oxlint plugin. The end-to-end cases run
// the real oxlint 1.86.0 on fixture projects in a temp folder; the in-process
// cases call each rule's `create` with hand-built nodes, for coverage.
// ---------------------------------------------------------------------------

/** The repository root. */
const ROOT = new URL("../../", import.meta.url).pathname;

/** The plugin source: oxlint loads the erasable TypeScript directly. */
const SOURCE = path.join(ROOT, "src/lint.ts");

/** The oxlint entry of the devDependency, run with the real node binary. */
const OXLINT = path.join(ROOT, "node_modules/oxlint/bin/oxlint");

/** Every rule of the plugin, on. */
const ALL_RULES = Object.fromEntries(
  Object.keys(plugin.rules).map(name => [`moku-game/${name}`, "error"])
);

/** Temp folders to remove after the file. */
const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A finding of the plugin: rule name and file relative to the fixture root. */
type Finding = { rule: string; file: string };

/**
 * Write a fixture project and run oxlint on it.
 *
 * @param files - Relative path to source text.
 * @param rules - The `rules` block of `.oxlintrc.json`.
 * @param jsPlugin - The `jsPlugins` entry: the source path or the package name.
 * @param setup - Extra work in the fixture folder before the run.
 * @returns The plugin's findings, sorted.
 */
function runOxlint(
  files: Record<string, string>,
  rules: Record<string, unknown> = ALL_RULES,
  jsPlugin = SOURCE,
  setup?: (folder: string) => void
): Finding[] {
  const folder = mkdtempSync(path.join(tmpdir(), "moku-game-lint-"));

  folders.push(folder);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  }
  writeFileSync(
    path.join(folder, ".oxlintrc.json"),
    JSON.stringify({ categories: { correctness: "off" }, jsPlugins: [jsPlugin], rules })
  );
  setup?.(folder);

  // eslint-disable-next-line sonarjs/no-os-command-from-path -- the node on PATH is the one a game runs oxlint with.
  const run = spawnSync("node", [OXLINT, "--format", "json", "."], {
    cwd: folder,
    encoding: "utf8"
  });
  if (run.stdout === "") throw new Error(`oxlint did not run: ${run.stderr}`);

  const report = JSON.parse(run.stdout) as {
    diagnostics: { code: string; filename: string; message: string }[];
  };

  expect(report.diagnostics.filter(item => !item.code.startsWith("moku-game("))).toEqual([]);

  return report.diagnostics
    .map(item => ({ rule: item.code.slice("moku-game(".length, -1), file: item.filename }))
    .toSorted((a, b) => `${a.file}${a.rule}`.localeCompare(`${b.file}${b.rule}`));
}

/**
 * Count the findings per file and rule.
 *
 * @param findings - The findings.
 * @returns `file rule` to count.
 */
function tally(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const { rule, file } of findings) {
    const key = `${file} ${rule}`;

    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

/** One fixture game in the template layout: a bad and an allowed case per rule. */
const FIXTURE: Record<string, string> = {
  // L2
  "nodes/bad-pixi.ts": 'import { Application } from "pixi.js";\nexport const app = Application;\n',
  // `import { type A }` keeps a side-effect import under verbatimModuleSyntax: a value import.
  "nodes/bad-inline-type.ts":
    'import { type Application } from "pixi.js";\nexport type App = Application;\n',
  "web/bad-yoga.ts": 'export { default } from "yoga-layout";\n',
  "nodes/ok-pixi.ts":
    'import type { Application } from "pixi.js";\nexport type App = Application;\nexport const load = (): Promise<unknown> => import("pixi.js");\n',
  // L13
  "game.ts": 'import { haptics } from "@moku-labs/system";\nexport const buzz = haptics;\n',
  "nodes/native.ts":
    'import { invoke } from "@tauri-apps/api/core";\nexport const call = invoke;\n',
  "nodes/native.dev.ts":
    'import { invoke } from "@tauri-apps/api/core";\nexport const call = invoke;\n',
  "platform-bridge.ts":
    'import { haptics } from "@moku-labs/system";\nexport const buzz = haptics;\n',
  // Dev only
  "flows/bad-dev.ts":
    'import { commands } from "@moku-labs/game/control";\nexport const all = commands;\n',
  "web/view.ts":
    'export const editor = (): Promise<unknown> => import("@moku-labs/editor/agent");\n',
  "web/main.ts":
    'import { commands } from "@moku-labs/game/control";\nexport const all = commands;\n',
  "web/dev.ts":
    'export const editor = (): Promise<unknown> => import("@moku-labs/editor/agent");\n',
  "web/editor-panel.ts": 'export { panel } from "@moku-labs/editor";\n',
  "tests/play.test.ts": 'import { run } from "@moku-labs/game/control";\nexport const go = run;\n',
  // L5
  "state.ts":
    "let count = 0;\nexport let total = count;\nexport const cache = new Map<string, number>();\nconst seen = new WeakSet<object>();\nexport const size = seen;\n",
  "features/ok-state.ts":
    'export function build(): Map<string, number> {\n  const map = new Map<string, number>();\n  let n = 0;\n  n += 1;\n  map.set("n", n);\n  return map;\n}\n',
  // L3
  "rules/bad-random.ts":
    "export const roll = (): number => Math.random();\nexport const time = (): number => Date.now() + performance.now();\nexport const day = (): Date => new Date();\nexport function later(): void {\n  setTimeout(() => {}, 1);\n  globalThis.setInterval(() => {}, 1);\n}\n",
  "rules/ok-time.ts":
    'import { size } from "./size";\nexport const format = (now: number): string => new Date(now).toISOString() + String(size);\n',
  "rules/size.ts": "export const size = 3;\n",
  "web/random.ts": "export const roll = (): number => Math.random();\n",
  "nodes/cheats.dev.ts":
    'import { panel } from "@moku-labs/editor";\nexport const roll = (): number => Math.random() + Number(panel);\n',
  // L4
  "tables.ts": "export const coins = 1;\n",
  "rules/bad-import.ts":
    'import { coins } from "../tables";\nimport type { GameDefinition } from "@moku-labs/game";\nexport const reward = coins;\nexport type Game = GameDefinition;\n'
};

describe("@moku-labs/game/lint under oxlint", () => {
  it("fires on each bad case and stays quiet on the allowed cases", () => {
    expect(tally(runOxlint(FIXTURE))).toEqual({
      "flows/bad-dev.ts dev-imports": 1,
      "game.ts native-imports": 1,
      "nodes/bad-inline-type.ts lazy-imports": 1,
      "nodes/bad-pixi.ts lazy-imports": 1,
      "nodes/native.ts native-imports": 1,
      "rules/bad-import.ts rules-siblings": 2,
      "rules/bad-random.ts determinism": 6,
      "state.ts no-module-state": 4,
      "web/bad-yoga.ts lazy-imports": 1,
      "web/view.ts dev-imports": 1
    });
  });

  it("takes files and ignores from the options", () => {
    const findings = runOxlint(
      {
        "web/random.ts": "export const roll = (): number => Math.random();\n",
        "web/random.skip.ts": "export const roll = (): number => Math.random();\n",
        "rules/random.ts": "export const roll = (): number => Math.random();\n"
      },
      { "moku-game/determinism": ["error", { files: ["web/**"], ignores: ["**/*.skip.ts"] }] }
    );

    expect(findings).toEqual([{ rule: "determinism", file: "web/random.ts" }]);
  });

  it("loads by package name from node_modules", () => {
    const findings = runOxlint(
      {
        "nodes/bad-pixi.ts":
          'import { Application } from "pixi.js";\nexport const app = Application;\n'
      },
      { "moku-game/lazy-imports": "error" },
      "@moku-labs/game/lint",
      folder => {
        const home = path.join(folder, "node_modules/@moku-labs/game");

        mkdirSync(home, { recursive: true });
        writeFileSync(
          path.join(home, "package.json"),
          JSON.stringify({
            name: "@moku-labs/game",
            type: "module",
            exports: { "./lint": "./lint.ts" }
          })
        );
        symlinkSync(SOURCE, path.join(home, "lint.ts"));
      }
    );

    expect(findings).toEqual([{ rule: "lazy-imports", file: "nodes/bad-pixi.ts" }]);
  });
});

// ---------------------------------------------------------------------------
// In-process: the same rules with hand-built ESTree nodes.
// ---------------------------------------------------------------------------

/**
 * Run one rule on one file with hand-built nodes.
 *
 * @param name - The rule.
 * @param file - The file path relative to the fake root.
 * @param visits - Node type and node, in visit order.
 * @param options - The rule options.
 * @returns The messages reported.
 */
function check(
  name: GameLintRuleName,
  file: string,
  visits: [string, GameLintNode][],
  options: unknown[] = []
): string[] {
  const messages: string[] = [];
  const context: GameLintContext = {
    cwd: "/game",
    filename: `/game/${file}`,
    options,
    report: ({ message }) => messages.push(message)
  };
  const listeners = plugin.rules[name].create(context);

  for (const [type, node] of visits) listeners[type]?.(node);

  return messages;
}

/**
 * A literal node.
 *
 * @param value - The value.
 * @returns The node.
 */
const literal = (value: unknown): GameLintNode => ({ type: "Literal", value });

/**
 * An identifier node.
 *
 * @param name - The name.
 * @returns The node.
 */
const id = (name: string): GameLintNode => ({ type: "Identifier", name });

/**
 * An import declaration node.
 *
 * @param from - The specifier.
 * @param importKind - `value` or `type`.
 * @returns The node.
 */
const imports = (from: string, importKind = "value"): GameLintNode => ({
  type: "ImportDeclaration",
  source: literal(from),
  importKind
});

/**
 * A member read node.
 *
 * @param object - The object name.
 * @param property - The property name.
 * @param computed - True for `object["property"]`.
 * @returns The node.
 */
const member = (object: string, property: string, computed = false): GameLintNode => ({
  type: "MemberExpression",
  object: id(object),
  property: computed ? literal(property) : id(property),
  computed
});

describe("@moku-labs/game/lint rules in process", () => {
  it("matches globs: **, *, ?, braces, root-only names", () => {
    expect(globToRegExp("**/rules/**").test("src/rules/merge.ts")).toBe(true);
    expect(globToRegExp("**/rules/**").test("rules/merge.ts")).toBe(true);
    expect(globToRegExp("state.ts").test("src/state.ts")).toBe(false);
    expect(globToRegExp("web/dev*.ts").test("web/dev.ts")).toBe(true);
    expect(globToRegExp("**/*.{test,spec}.ts").test("a/b.spec.ts")).toBe(true);
    expect(globToRegExp("v?.ts").test("v1.ts")).toBe(true);
    expect(globToRegExp("a.ts").test("abts")).toBe(false);
  });

  it("lazy-imports: static value import fires, type import and import() pass", () => {
    expect(
      check("lazy-imports", "nodes/a.ts", [
        ["ImportDeclaration", imports("pixi.js")],
        ["ImportDeclaration", imports("yoga-layout")]
      ])
    ).toEqual([expect.stringMatching(/^L2: .*Pixi/), expect.stringMatching(/^L2: .*Yoga/)]);
    expect(
      check("lazy-imports", "nodes/a.ts", [
        [
          "ExportNamedDeclaration",
          { type: "ExportNamedDeclaration", source: literal("pixi.js"), exportKind: "type" }
        ]
      ])
    ).toEqual([]);
    expect(
      check("lazy-imports", "nodes/a.ts", [
        ["ImportDeclaration", imports("yoga-layout/load", "type")]
      ])
    ).toEqual([]);
    expect(
      check("lazy-imports", "nodes/a.ts", [
        ["ImportExpression", { type: "ImportExpression", source: literal("pixi.js") }]
      ])
    ).toEqual([]);
    expect(
      check("lazy-imports", "tests/a.ts", [["ImportDeclaration", imports("pixi.js")]])
    ).toEqual([]);
  });

  it("native-imports: logic fires, dynamic and computed specifiers", () => {
    const dynamic: GameLintNode = { type: "ImportExpression", source: literal("@tauri-apps/api") };
    const computed: GameLintNode = { type: "ImportExpression", source: id("name") };

    expect(check("native-imports", "game.ts", [["ImportExpression", dynamic]])).toEqual([
      expect.stringMatching(/^L13: /)
    ]);
    expect(check("native-imports", "nodes/a.dev.ts", [["ImportExpression", dynamic]])).toEqual([]);
    expect(check("native-imports", "game.ts", [["ImportExpression", computed]])).toEqual([]);
    expect(check("native-imports", "web/main.ts", [["ImportExpression", dynamic]])).toEqual([]);
  });

  it("dev-imports: editor outside dev files fires, options widen the dev set", () => {
    const editor: GameLintNode = {
      type: "ExportAllDeclaration",
      source: literal("@moku-labs/editor")
    };

    expect(check("dev-imports", "flows/a.ts", [["ExportAllDeclaration", editor]])).toEqual([
      expect.stringMatching(/^Dev only: /)
    ]);
    expect(check("dev-imports", "web/dev.ts", [["ExportAllDeclaration", editor]])).toEqual([]);
    expect(
      check(
        "dev-imports",
        "flows/a.ts",
        [["ExportAllDeclaration", editor]],
        [{ ignores: ["flows/**"] }]
      )
    ).toEqual([]);
  });

  it("rules-siblings: only ./ specifiers pass", () => {
    expect(
      check("rules-siblings", "rules/a.ts", [["ImportDeclaration", imports("../tables")]])
    ).toEqual([expect.stringMatching(/^L4: /)]);
    // A type import from a package is an import too: a rule reads only its siblings.
    expect(
      check("rules-siblings", "rules/a.ts", [
        ["ImportDeclaration", imports("@moku-labs/game", "type")]
      ])
    ).toEqual([expect.stringMatching(/^L4: /)]);
    expect(check("rules-siblings", "rules/a.ts", [["ImportDeclaration", imports("./b")]])).toEqual(
      []
    );
    expect(
      check("rules-siblings", "nodes/a.ts", [["ImportDeclaration", imports("../tables")]])
    ).toEqual([]);
  });

  it("no-module-state: let and collections at module scope, nothing else", () => {
    const program: GameLintNode = {
      type: "Program",
      body: [
        { type: "VariableDeclaration", kind: "let", declarations: [] },
        {
          type: "ExportNamedDeclaration",
          declaration: {
            type: "VariableDeclaration",
            kind: "const",
            declarations: [
              { type: "VariableDeclarator", init: { type: "NewExpression", callee: id("Set") } },
              { type: "VariableDeclarator", init: { type: "NewExpression", callee: id("Error") } },
              { type: "VariableDeclarator" }
            ]
          }
        },
        { type: "ExportNamedDeclaration" },
        { type: "FunctionDeclaration" }
      ]
    };

    expect(check("no-module-state", "state.ts", [["Program", program]])).toEqual([
      "L5: no module-scope state. State lives in player and session.",
      "L5: no module-scope collections. Create them inside a function."
    ]);
    expect(check("no-module-state", "state.ts", [["Program", { type: "Program" }]])).toEqual([]);
  });

  it("determinism: clock reads, new Date(), timers; new Date(now) and locals pass", () => {
    const visits: [string, GameLintNode][] = [
      ["MemberExpression", member("Math", "random")],
      ["MemberExpression", member("Date", "now", true)],
      ["MemberExpression", member("performance", "now")],
      ["MemberExpression", member("Math", "floor")],
      [
        "MemberExpression",
        { type: "MemberExpression", object: id("Math"), property: id("x"), computed: true }
      ],
      ["MemberExpression", { type: "MemberExpression", object: id("Math") }],
      ["NewExpression", { type: "NewExpression", callee: id("Date"), arguments: [] }],
      ["NewExpression", { type: "NewExpression", callee: id("Date"), arguments: [id("now")] }],
      ["CallExpression", { type: "CallExpression", callee: id("setTimeout") }],
      ["CallExpression", { type: "CallExpression", callee: member("window", "setInterval") }],
      ["CallExpression", { type: "CallExpression", callee: member("timers", "setInterval") }],
      ["CallExpression", { type: "CallExpression", callee: id("schedule") }],
      ["CallExpression", { type: "CallExpression", callee: { type: "CallExpression" } }]
    ];

    const now = "L3: use `now` from the node context.";
    const timer = "L3: store the moment in player, await fx(schedule(moment)).";

    expect(check("determinism", "rules/a.ts", visits)).toEqual([
      "L3: use an rng stream: rng.stream(id).",
      now,
      now,
      now,
      timer,
      timer
    ]);
    expect(check("determinism", "web/a.ts", visits)).toEqual([]);
  });
});
