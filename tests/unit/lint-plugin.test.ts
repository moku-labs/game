import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  GameLintContext,
  GameLintDefinition,
  GameLintNode,
  GameLintRuleName,
  GameLintScope
} from "@moku-labs/game/lint";
import plugin, { globToRegExp } from "@moku-labs/game/lint";
import { afterAll, describe, expect, it } from "vitest";
import { buildIndex, createCatalog, putFile } from "../../src/project/catalog";
import { loadTypeScript } from "../../src/project/typescript";

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

/** The fixture game the JSX key rule runs on. */
const MINI_GAME = path.join(ROOT, "tests/fixtures/mini-game");

/** Every rule of the plugin, on. */
const ALL_RULES = Object.fromEntries(
  Object.keys(plugin.rules).map(name => [`moku-game/${name}`, "error"])
);

/** Temp folders to remove after the file. */
const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A finding of the plugin: rule name, file relative to the fixture root and line. */
type Finding = { rule: string; file: string; line: number };

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
    diagnostics: {
      code: string;
      filename: string;
      message: string;
      labels: { span: { line: number } }[];
    }[];
  };

  expect(report.diagnostics.filter(item => !item.code.startsWith("moku-game("))).toEqual([]);

  return report.diagnostics
    .map(item => ({
      rule: item.code.slice("moku-game(".length, -1),
      file: item.filename,
      line: item.labels[0]?.span.line ?? 0
    }))
    .toSorted(
      (a, b) => `${a.file}${a.rule}`.localeCompare(`${b.file}${b.rule}`) || a.line - b.line
    );
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
    "let count = 0;\nvar legacy = 0;\nexport let total = count + legacy;\nexport const cache = new Map<string, number>();\nconst seen = new WeakSet<object>();\nexport const size = seen;\n",
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
      "state.ts no-module-state": 5,
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

    expect(findings).toEqual([{ rule: "determinism", file: "web/random.ts", line: 1 }]);
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

    expect(findings).toEqual([{ rule: "lazy-imports", file: "nodes/bad-pixi.ts", line: 1 }]);
  });
});

/** Every JSX key shape, one per line: the rule reports the lines the index cannot follow. */
const KEYS = `import { slotKey } from "./slots";

const tabKeys: Record<string, string> = { audio: "tabSound" };
const fixed = "fixedRow";
const tabKey = tabKeys["audio"];
const chained = fixed;
let moving = "moving";

export function Keys(props: {
  id: string;
  amountKey: string;
  tab: string;
  open: boolean;
  items: { name: string }[];
}) {
  moving += "!";

  return (
    <row key="row">
      <text key={\`\${props.id}Label\`} />
      <text key={props.id} />
      <text key={props.amountKey} />
      <text key={slotKey(2)} />
      <text key={slotKey} />
      <text key={chained} />
      <text key={props.id as string} />
      <text key={tabKeys[props.tab]} />
      <text key={props.tab ?? "tab"} />
      <text key={props.tab || "tab"} />
      <text key={props.open ? "on" : "off"} />
      <text key={props.tab} />
      <text key={tabKey} />
      <text key={moving} />
      <text key={\`\${tabKey}Label\`} />
      {props.items.map(item => (
        <text key={item.name} />
      ))}
      {props.items.map(({ name }) => (
        <text key={name} />
      ))}
    </row>
  );
}
`;

/** Three key shapes a game wrote before it passed its keys in as props. */
const OLD_KEYS: Record<string, string> = {
  "features/settings/settings.tsx": `type Tab = "audio" | "language" | "profile";

const tabKeys: Record<Tab, string> = { audio: "tabSound", language: "tabLanguage", profile: "tabProfile" };

export function TabButton(props: { tab: Tab }) {
  const key = tabKeys[props.tab];

  return (
    <button key={key}>
      <text key={\`\${key}Label\`} />
    </button>
  );
}
`,
  "features/ui/popup.tsx": `export function Amount(props: { id: string; unitKey?: string }) {
  return <text key={props.unitKey ?? \`\${props.id}Unit\`} />;
}
`
};

/** The files of the fixture game whose JSX keys the rule reads. */
const GAME_KEY_FILES = ["features/home/view.tsx", "features/info/popup.tsx"];

describe("moku-game/static-keys under oxlint", () => {
  const rules = { "moku-game/static-keys": "error" };

  it("reports the keys the index cannot follow and passes the ones it reads", () => {
    const findings = runOxlint({ "features/keys.tsx": KEYS, "features/slots.ts": "" }, rules);

    expect(findings.map(item => `${item.file}:${item.line}`)).toEqual(
      [27, 28, 29, 30, 31, 32, 33, 34, 36].map(line => `features/keys.tsx:${line}`)
    );
    expect(findings.every(item => item.rule === "static-keys")).toBe(true);
  });

  it("reports the old key shapes and none of the keys of the fixture game", () => {
    const old = runOxlint(OLD_KEYS, rules);
    const now = runOxlint({}, rules, SOURCE, folder => {
      for (const file of GAME_KEY_FILES) {
        mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
        copyFileSync(path.join(MINI_GAME, file), path.join(folder, file));
      }
    });

    expect(old.map(item => `${item.file}:${item.line}`)).toEqual([
      "features/settings/settings.tsx:9",
      "features/settings/settings.tsx:10",
      "features/ui/popup.tsx:2"
    ]);
    expect(now).toEqual([]);
  });

  it("checks .tsx outside tests by default, and takes files and ignores from the options", () => {
    const bad = "export const Row = (props: { tab: string }) => <row key={props.tab} />;\n";
    const files = { "web/row.tsx": bad, "web/row.skip.tsx": bad, "tests/row.tsx": bad };

    expect(runOxlint(files, rules)).toEqual([
      { rule: "static-keys", file: "web/row.skip.tsx", line: 1 },
      { rule: "static-keys", file: "web/row.tsx", line: 1 }
    ]);
    expect(
      runOxlint(files, {
        "moku-game/static-keys": ["error", { files: ["**/*.tsx"], ignores: ["**/*.skip.tsx"] }]
      })
    ).toEqual([
      { rule: "static-keys", file: "tests/row.tsx", line: 1 },
      { rule: "static-keys", file: "web/row.tsx", line: 1 }
    ]);
  });
});

// ---------------------------------------------------------------------------
// In-process: the same rules with hand-built ESTree nodes.
// ---------------------------------------------------------------------------

/** The scope of a file that declares nothing: every name is out of reach. */
const NO_NAMES: GameLintScope = { set: new Map() };

/**
 * Run one rule on one file with hand-built nodes.
 *
 * @param name - The rule.
 * @param file - The file path relative to the fake root.
 * @param visits - Node type and node, in visit order.
 * @param options - The rule options.
 * @param scope - The scope every node sits in.
 * @returns The messages reported.
 */
function check(
  name: GameLintRuleName,
  file: string,
  visits: [string, GameLintNode][],
  options: unknown[] = [],
  scope: GameLintScope = NO_NAMES
): string[] {
  const messages: string[] = [];
  const context: GameLintContext = {
    cwd: "/game",
    filename: `/game/${file}`,
    options,
    sourceCode: { getScope: () => scope },
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

  it("no-module-state: let, var and collections at module scope, nothing else", () => {
    const program: GameLintNode = {
      type: "Program",
      body: [
        { type: "VariableDeclaration", kind: "let", declarations: [] },
        { type: "VariableDeclaration", kind: "var", declarations: [] },
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

  it("static-keys: literals, templates, key props, calls and out-of-reach names pass", () => {
    const keyOf = (expression: GameLintNode): [string, GameLintNode] => [
      "JSXAttribute",
      {
        type: "JSXAttribute",
        name: { type: "JSXIdentifier", name: "key" },
        value: { type: "JSXExpressionContainer", expression }
      }
    ];
    const constOf = (init: GameLintNode | null, kind = "const"): GameLintDefinition => ({
      type: "Variable",
      node: { type: "VariableDeclarator", init },
      parent: { type: "VariableDeclaration", kind }
    });
    const declared = new Map(
      Object.entries({
        fixed: constOf(literal("row")),
        chain: constOf(id("fixed")),
        lookup: constOf(member("tabKeys", "tab", true)),
        moving: constOf(literal("row"), "let"),
        far: constOf(id("chain")),
        farther: constOf(id("far")),
        props: { type: "Parameter", node: { type: "ArrowFunctionExpression" } },
        slotKey: { type: "ImportBinding", node: { type: "ImportSpecifier" } },
        someFunction: { type: "FunctionName", node: { type: "FunctionDeclaration" } }
      }).map(([name, definition]) => [name, { defs: [definition] }])
    );
    // The names are declared one scope out, as a module scope is from a function body.
    const scope: GameLintScope = { set: new Map(), upper: { set: declared } };
    const template = (...expressions: GameLintNode[]): GameLintNode => ({
      type: "TemplateLiteral",
      expressions
    });

    const passes: [string, GameLintNode][] = [
      ["JSXAttribute", { type: "JSXAttribute", name: { type: "JSXIdentifier", name: "key" } }],
      [
        "JSXAttribute",
        { type: "JSXAttribute", name: { type: "JSXIdentifier", name: "key" }, value: literal("a") }
      ],
      [
        "JSXAttribute",
        { type: "JSXAttribute", name: { type: "JSXIdentifier", name: "style" }, value: id("x") }
      ],
      keyOf(literal("row")),
      keyOf(literal(3)),
      keyOf(template(member("props", "id"), id("fixed"))),
      keyOf(member("props", "amountKey")),
      keyOf({ type: "CallExpression", callee: id("slotKey") }),
      keyOf(id("slotKey")),
      keyOf(id("props")),
      keyOf(id("unknown")),
      keyOf(id("chain")),
      keyOf(id("farther")),
      keyOf({
        type: "TSAsExpression",
        expression: { type: "TSNonNullExpression", expression: member("props", "id") }
      }),
      keyOf({ type: "ChainExpression", expression: member("props", "unitKey") })
    ];
    // The rule reads only the type of these; the other fields make them real nodes.
    const nullish = { type: "LogicalExpression", operator: "??", left: id("a"), right: id("b") };
    const either = { type: "LogicalExpression", operator: "||", left: id("a"), right: id("b") };
    const choice = { type: "ConditionalExpression", test: id("a") };
    const fails: [string, GameLintNode][] = [
      keyOf(member("tabKeys", "tab", true)),
      keyOf(nullish),
      keyOf(either),
      keyOf(choice),
      keyOf(member("props", "tab")),
      keyOf({ type: "MemberExpression", object: member("props", "item"), property: id("id") }),
      keyOf(literal(true)),
      keyOf(id("lookup")),
      keyOf(id("moving")),
      keyOf(template(id("lookup"))),
      keyOf(id("someFunction")),
      keyOf({ type: "JSXEmptyExpression" })
    ];
    const message =
      'Keys: a JSX key must be a literal, a template, or props.id / props.<name>Key. Pass the key in as a prop: <X id="…">.';

    expect(check("static-keys", "features/a.tsx", passes, [], scope)).toEqual([]);
    expect(check("static-keys", "features/a.tsx", fails, [], scope)).toEqual(
      fails.map(() => message)
    );
    expect(check("static-keys", "features/a.ts", fails, [], scope)).toEqual([]);
    expect(check("static-keys", "tests/a.tsx", fails, [], scope)).toEqual([]);
  });
});

describe("static-keys and the project index", () => {
  it("accept props.<name> exactly when the index turns it into a {<name>} hole", async () => {
    const names = ["id", "amountKey", "unitKey", "Key", "idx", "keyName", "monkey", "tab"];
    const catalog = createCatalog(await loadTypeScript());

    for (const name of names) {
      const text = `export const Row = (props: { ${name}: string }) => <row key={props.${name}} />;\n`;

      putFile(catalog, `features/ui/${name}.tsx`, Buffer.from(text));
    }

    const index = buildIndex(catalog);
    const holes = names.filter(name => index.symbols[`jsx:{${name}}`] !== undefined);
    const accepted = names.filter(
      name =>
        check("static-keys", "features/a.tsx", [
          [
            "JSXAttribute",
            {
              type: "JSXAttribute",
              name: { type: "JSXIdentifier", name: "key" },
              value: { type: "JSXExpressionContainer", expression: member("props", name) }
            }
          ]
        ]).length === 0
    );

    expect(accepted).toEqual(["id", "amountKey", "unitKey"]);
    expect(holes).toEqual(accepted);
  });
});
