import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  GameLintContext,
  GameLintDefinition,
  GameLintNode,
  GameLintRuleName,
  GameLintScope
} from "@moku-labs/game/lint";
import plugin, { aliasTargetsOf, globToRegExp } from "@moku-labs/game/lint";
import { afterAll, describe, expect, it } from "vitest";
import { aliasTargets, readAliases } from "../../src/project/aliases";
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

/** The fixture game in the v15 layout the layout rules run on: clean, with its tsconfig `paths`. */
const LAYOUT_GAME = path.join(ROOT, "tests/fixtures/layout-game");

/** Every rule of the plugin, on. */
const ALL_RULES = Object.fromEntries(
  Object.keys(plugin.rules).map(name => [`moku-game/${name}`, "error"])
);

/** Temp folders to remove after the file. */
const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/**
 * A fresh temp folder, removed after the file, by its real path.
 *
 * @returns The folder.
 */
function tempFolder(): string {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), "moku-game-lint-")));

  folders.push(folder);

  return folder;
}

/**
 * Write files into a folder.
 *
 * @param folder - The folder.
 * @param files - Relative path to text.
 */
function writeFiles(folder: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  }
}

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
  const folder = tempFolder();

  writeFiles(folder, files);
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

/** One planted violation per case of the layout rules, written into a copy of the layout game. */
const LAYOUT_BAD: Record<string, string> = {
  // feature-door: a relative deep import, the barrel, the own door, a deep alias.
  "features/home/flow/bad-door.ts": `import { show } from "../../info/flow/show";
import { homeNode } from "@features";
import { homeFeature } from "@features/home";
import { show as deep } from "@features/info/flow/show";
export const all = [show, homeNode, homeFeature, deep];
`,
  // layer-imports: shared, core and plugins reach above their layer.
  "shared/views/bad-layer.ts":
    'import { homeFeature } from "@features/home";\nexport const feature = homeFeature;\n',
  "core/bad-layer.ts": 'import { Panel } from "@shared";\nexport const panel = Panel;\n',
  "plugins/loading/bad-layer.ts":
    'import { homeFeature } from "@features/home";\nexport const feature = homeFeature;\n',
  // rules-siblings: a rule reads the kit.
  "features/home/rules/bad-rule.ts":
    'import { defineNode } from "@core/kit";\nexport const node = defineNode;\n',
  // test-suffix: an e2e named as a unit test, a helper lying in tests/visual/, an isolated test.
  "tests/e2e/first.test.ts": "export const first = 1;\n",
  "tests/visual/run.ts": "export const run = 1;\n",
  "features/home/__tests__/isolated/home.test.ts": "export const home = 1;\n"
};

/** What the ten rules find in the layout game with `LAYOUT_BAD` planted: nothing else. */
const LAYOUT_TALLY = {
  "core/bad-layer.ts layer-imports": 1,
  "features/home/__tests__/isolated/home.test.ts test-suffix": 1,
  "features/home/flow/bad-door.ts feature-door": 4,
  "features/home/rules/bad-rule.ts rules-siblings": 1,
  "plugins/loading/bad-layer.ts layer-imports": 1,
  "shared/views/bad-layer.ts layer-imports": 1,
  "tests/e2e/first.test.ts test-suffix": 1,
  "tests/visual/run.ts test-suffix": 1
};

/**
 * Copy the layout game into a fixture folder.
 *
 * @param into - The sub-folder to copy it into, relative to the fixture folder.
 * @param withTsconfig - False to leave its tsconfig.json out.
 * @returns The setup step of `runOxlint`.
 */
function layoutGame(into = ".", withTsconfig = true): (folder: string) => void {
  return folder => {
    cpSync(LAYOUT_GAME, path.join(folder, into), { recursive: true });
    if (!withTsconfig) rmSync(path.join(folder, into, "tsconfig.json"));
  };
}

describe("the layout rules under oxlint", () => {
  it("find nothing in the clean layout game with all ten rules on", () => {
    expect(Object.keys(ALL_RULES)).toHaveLength(10);
    expect(runOxlint({}, ALL_RULES, SOURCE, layoutGame())).toEqual([]);
  });

  it("fire once on each planted violation and on nothing else", () => {
    expect(tally(runOxlint(LAYOUT_BAD, ALL_RULES, SOURCE, layoutGame()))).toEqual(LAYOUT_TALLY);
  });

  it("read the v15 aliases when the game has no tsconfig", () => {
    expect(tally(runOxlint(LAYOUT_BAD, ALL_RULES, SOURCE, layoutGame(".", false)))).toEqual(
      LAYOUT_TALLY
    );
  });

  it("take root, tsconfig and suffixes from the options", () => {
    const paths = (
      JSON.parse(readFileSync(path.join(LAYOUT_GAME, "tsconfig.json"), "utf8")) as {
        compilerOptions: { paths: Record<string, string[]> };
      }
    ).compilerOptions.paths;
    // `@home` exists only in this tsconfig: core importing it proves the option is read.
    const tsconfig = {
      compilerOptions: {
        baseUrl: "./src",
        paths: { ...paths, "@home": ["./features/home/index.ts"] }
      }
    };
    const files = Object.fromEntries(
      Object.entries({
        ...LAYOUT_BAD,
        "core/bad-alias.ts":
          'import { homeFeature } from "@home";\nexport const home = homeFeature;\n',
        "tests/e2e/first.spec.ts": "export const first = 1;\n"
      }).map(([file, text]) => [`src/${file}`, text])
    );
    const layout = { root: "src", tsconfig: "tsconfig.game.json" };
    const rules = {
      "moku-game/layer-imports": ["error", layout],
      "moku-game/feature-door": ["error", layout],
      "moku-game/rules-siblings": ["error", layout],
      "moku-game/test-suffix": ["error", { root: "src", suffixes: { "tests/e2e/": ".spec.ts" } }]
    };

    files["tsconfig.game.json"] = JSON.stringify(tsconfig);

    expect(tally(runOxlint(files, rules, SOURCE, layoutGame("src")))).toEqual({
      "src/core/bad-alias.ts layer-imports": 1,
      "src/core/bad-layer.ts layer-imports": 1,
      "src/features/home/flow/bad-door.ts feature-door": 4,
      "src/features/home/rules/bad-rule.ts rules-siblings": 1,
      "src/plugins/loading/bad-layer.ts layer-imports": 1,
      "src/shared/views/bad-layer.ts layer-imports": 1,
      "src/tests/e2e/first.test.ts test-suffix": 1
    });
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
 * @param cwd - The folder lint runs in; `/game` does not exist, so the v15 aliases apply.
 * @returns The messages reported.
 */
function check(
  name: GameLintRuleName,
  file: string,
  visits: [string, GameLintNode][],
  options: unknown[] = [],
  scope: GameLintScope = NO_NAMES,
  cwd = "/game"
): string[] {
  const messages: string[] = [];
  const context: GameLintContext = {
    cwd,
    filename: `${cwd}/${file}`,
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

/**
 * Run a rule on one file that holds one import.
 *
 * @param name - The rule.
 * @param file - The file path relative to the fake root.
 * @param from - The specifier of the import.
 * @param options - The rule options.
 * @param cwd - The folder lint runs in.
 * @returns The messages reported.
 */
function importsIn(
  name: GameLintRuleName,
  file: string,
  from: string,
  options: unknown[] = [],
  cwd = "/game"
): string[] {
  return check(
    name,
    file,
    [
      ["Program", { type: "Program" }],
      ["ImportDeclaration", imports(from)]
    ],
    options,
    NO_NAMES,
    cwd
  );
}

/** The second sentence of every layer-imports report. */
const ORDER = "Order: core ← shared ← features ← game.ts; plugins import core and shared.";

/** What feature-door says about a barrel below game.ts. */
const BARREL = "Door: only game.ts imports the @features and @plugins barrels.";

/** What feature-door says about a feature that imports its own door. */
const OWN_DOOR = "Door: a feature does not import its own index.ts. Import the file: ./flow/merge.";

/**
 * What feature-door says about an import that goes deep into another unit.
 *
 * @param kind - `feature` or `plugin`.
 * @param unit - The unit, as `features/info`.
 * @returns The message.
 */
const deep = (kind: string, unit: string): string =>
  `Door: another ${kind} is imported from its index.ts only: @${unit}.`;

/**
 * What feature-door says about a relative import that leaves its unit.
 *
 * @param unit - The unit, as `features/home`.
 * @returns The message.
 */
const leaves = (unit: string): string =>
  `Door: an import that leaves ${unit} is written as an alias: @features/<f>, @shared, @core/<file>.`;

/**
 * What test-suffix says about a misnamed file.
 *
 * @param folder - The kind folder.
 * @param suffix - Its suffix.
 * @param name - The file name.
 * @param renamed - The name it should have.
 * @returns The message.
 */
const misnamed = (folder: string, suffix: string, name: string, renamed: string): string =>
  `Tests: a file in ${folder} ends with ${suffix}. Rename ${name} to ${renamed}, or move a helper to ${folder.includes("__tests__") ? "__tests__/fixtures/" : "tests/helpers/"}.`;

/**
 * What test-suffix says about one file.
 *
 * @param file - The file path relative to the fake root.
 * @param options - The rule options.
 * @returns The messages reported.
 */
const named = (file: string, options: unknown[] = []): string[] =>
  check("test-suffix", file, [["Program", { type: "Program" }]], options);

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

  it("rules-siblings: ./ specifiers pass, ../ and packages fire", () => {
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

  it("determinism reads core, shared and game.ts and leaves the plugins; native-imports reads plugins", () => {
    const random: [string, GameLintNode][] = [["MemberExpression", member("Math", "random")]];
    const native: [string, GameLintNode][] = [["ImportDeclaration", imports("@tauri-apps/api")]];

    for (const file of ["core/state.ts", "shared/motion/x.ts", "game.ts", "src/core/rng.ts"]) {
      expect(check("determinism", file, random), file).toHaveLength(1);
    }
    for (const file of ["plugins/loading/handlers.ts", "features/energy/plugin/api.ts"]) {
      expect(check("determinism", file, random), file).toEqual([]);
    }
    for (const file of ["plugins/platform/index.ts", "core/kit.ts", "shared/x.ts", "kit.ts"]) {
      expect(check("native-imports", file, native), file).toEqual([
        "L13: a native package is imported only where the platform is wired: platform-bridge.ts, native.ts, web/ today; the engine CLI after B3. Pass a PlatformProvider."
      ]);
    }
    expect(check("native-imports", "platform-bridge.ts", native)).toEqual([]);
  });

  it("rules-siblings: siblings, @core/types and @shared/rules pass in any spelling", () => {
    const passes = [
      "./merge",
      "@core/types",
      "@shared/rules",
      "@core/types/cell",
      "../../../core/types",
      "../../../core/types.ts",
      "../../../core/types/cell",
      "../../../shared/rules",
      "../../../shared/rules/index.ts"
    ];
    const fails = [
      "@core/kit",
      "../tables",
      "@features/board",
      "@shared",
      "../../../shared/rules/clamp",
      "../../../core/typesafe",
      "pixi.js"
    ];
    const message =
      "L4: a rule imports only its siblings in rules/, @core/types and @shared/rules: (state, input, tables) => result.";

    for (const from of passes) {
      expect(importsIn("rules-siblings", "features/home/rules/a.ts", from), from).toEqual([]);
    }
    for (const from of fails) {
      expect(importsIn("rules-siblings", "features/home/rules/a.ts", from), from).toEqual([
        message
      ]);
    }
    expect(
      check("rules-siblings", "features/home/rules/a.ts", [
        ["ImportDeclaration", imports("@moku-labs/game", "type")]
      ])
    ).toEqual([message]);
  });

  it("layer-imports: each layer imports the layers below it", () => {
    // importer, specifier, what the rule says (empty when the import passes)
    const cases: [string, string, string][] = [
      ["core/kit.ts", "@core/types", ""],
      ["core/kit.ts", "./types", ""],
      ["core/kit.ts", "@generated/assets", ""],
      ["core/kit.ts", "@shared", "core does not import shared"],
      ["core/kit.ts", "../features/home", "core does not import features"],
      ["shared/views/panel.tsx", "@core/kit", ""],
      ["shared/views/panel.tsx", "@shared/rules", ""],
      ["shared/views/panel.tsx", "@generated/assets", ""],
      ["shared/views/panel.tsx", "@features/home", "shared does not import features"],
      ["shared/views/panel.tsx", "@plugins", "shared does not import plugins"],
      ["features/home/flow/home.ts", "@core/kit", ""],
      ["features/home/flow/home.ts", "@shared", ""],
      ["features/home/flow/home.ts", "@features/info", ""],
      ["features/home/flow/home.ts", "@generated/assets", ""],
      ["features/home/flow/home.ts", "@plugins", "features does not import plugins"],
      ["features/home/flow/home.ts", "../../../game", "features does not import game.ts"],
      ["features/home/flow/home.ts", "@tests/helpers/board", "features does not import tests"],
      ["plugins/loading/index.ts", "@core/kit", ""],
      ["plugins/loading/index.ts", "@shared", ""],
      ["plugins/loading/index.ts", "../index", ""],
      ["plugins/loading/index.ts", "@features", "plugins does not import features"],
      ["game.ts", "@features", ""],
      ["game.ts", "@plugins", ""],
      ["game.ts", "@tests/helpers/board", ""],
      // Outside the layout, a package, a generated file and a test: not checked.
      ["nodes/home.ts", "@features/home", ""],
      ["features/x.ts", "@plugins", ""],
      ["shared/views/panel.tsx", "pixi.js", ""],
      ["shared/views/panel.tsx", "../../kit", ""],
      ["generated/assets.ts", "@features", ""],
      ["features/home/__tests__/home.test.ts", "@plugins", ""]
    ];

    for (const [file, from, says] of cases) {
      expect(importsIn("layer-imports", file, from), `${file} ${from}`).toEqual(
        says === "" ? [] : [`Layers: ${says}. ${ORDER}`]
      );
    }
  });

  it("layer-imports: type-only statements, export-from and import() count", () => {
    const visits: [string, GameLintNode][] = [
      ["ImportDeclaration", imports("@features", "type")],
      [
        "ExportNamedDeclaration",
        { type: "ExportNamedDeclaration", source: literal("@features/home"), exportKind: "type" }
      ],
      ["ExportAllDeclaration", { type: "ExportAllDeclaration", source: literal("@plugins") }],
      ["ImportExpression", { type: "ImportExpression", source: literal("@features/info") }],
      ["ImportExpression", { type: "ImportExpression", source: id("name") }],
      ["ExportNamedDeclaration", { type: "ExportNamedDeclaration" }]
    ];

    expect(check("layer-imports", "shared/index.ts", visits)).toEqual([
      `Layers: shared does not import features. ${ORDER}`,
      `Layers: shared does not import features. ${ORDER}`,
      `Layers: shared does not import plugins. ${ORDER}`,
      `Layers: shared does not import features. ${ORDER}`
    ]);
  });

  it("feature-door: barrels, own doors, deep imports and relative escapes", () => {
    // importer, specifier, what the rule says (empty when the import passes)
    const cases: [string, string, string][] = [
      // The barrels belong to game.ts.
      ["features/home/flow/home.ts", "@features", BARREL],
      ["shared/index.ts", "@plugins", BARREL],
      ["core/kit.ts", "@features", BARREL],
      ["features/home/flow/home.ts", "../..", BARREL],
      ["features/index.ts", "@features", ""],
      // A unit does not import its own door.
      ["features/home/flow/home.ts", "@features/home", OWN_DOOR],
      ["features/home/flow/home.ts", "../index", OWN_DOOR],
      ["features/home/flow/home.ts", "..", OWN_DOOR],
      [
        "shared/views/panel.tsx",
        "@shared",
        "Door: shared does not import its own index.ts. Import the file: ./flow/merge."
      ],
      [
        "plugins/loading/api.ts",
        "./index.ts",
        "Door: a plugin does not import its own index.ts. Import the file: ./flow/merge."
      ],
      ["features/home/index.ts", "./index", ""],
      // Another unit is reached through its door.
      ["features/home/flow/home.ts", "@features/info/flow/show", deep("feature", "features/info")],
      ["features/home/flow/home.ts", "../../info/flow/show", deep("feature", "features/info")],
      ["shared/views/panel.tsx", "@features/home/views/screen", deep("feature", "features/home")],
      [
        "features/home/flow/home.ts",
        "../../../plugins/loading/api",
        deep("plugin", "plugins/loading")
      ],
      ["features/home/flow/home.ts", "@features/info", ""],
      ["plugins/loading/api.ts", "@features/home", ""],
      // An import that leaves the unit is an alias.
      ["features/home/flow/home.ts", "../../info", leaves("features/home")],
      ["features/home/flow/home.ts", "../../../shared/rules", leaves("features/home")],
      ["features/home/flow/home.ts", "../../../core/kit", leaves("features/home")],
      ["features/home/flow/home.ts", "../../../generated/assets", leaves("features/home")],
      ["shared/views/panel.tsx", "../../core/kit", leaves("shared")],
      ["features/home/flow/home.ts", "@shared/rules", ""],
      ["features/home/flow/home.ts", "@core/kit", ""],
      ["features/home/flow/home.ts", "@generated/assets", ""],
      // Inside one unit every relative import passes, at any depth.
      ["features/home/flow/home.ts", "../rules/pick", ""],
      ["features/home/index.ts", "./flow/home", ""],
      ["features/home/views/deep/a.tsx", "../../rules/pick", ""],
      ["shared/index.ts", "./views/panel", ""],
      ["shared/views/panel.tsx", "../rules", ""],
      // The barrels import the doors of their layer by relative path; a deep one is reported.
      ["features/index.ts", "./home", ""],
      ["features/index.ts", "./home/index.ts", ""],
      ["plugins/index.ts", "./loading", ""],
      ["features/index.ts", "./home/flow/home", deep("feature", "features/home")],
      ["features/index.ts", "../shared", leaves("features")],
      // Core has no door: inside core and @core/* pass, a relative import out of core is reported.
      ["core/kit.ts", "./types", ""],
      ["core/kit.ts", "@core/types", ""],
      ["core/kit.ts", "@shared", ""],
      ["core/kit.ts", "../shared/rules", leaves("core")],
      // Outside the layout and packages: quiet.
      ["features/home/flow/home.ts", "pixi.js", ""],
      ["features/home/flow/home.ts", "../../../kit", ""],
      ["features/x.ts", "../shared/rules", ""],
      ["features/home/__tests__/home.test.ts", "@features/home", ""]
    ];

    for (const [file, from, says] of cases) {
      expect(importsIn("feature-door", file, from), `${file} ${from}`).toEqual(
        says === "" ? [] : [says]
      );
    }
  });

  it("test-suffix: each kind folder takes its suffix; helpers and unknown kinds pass", () => {
    const cases: [string, string][] = [
      ["tests/e2e/board.e2e.ts", ""],
      [
        "tests/e2e/board.test.ts",
        misnamed("tests/e2e/", ".e2e.ts", "board.test.ts", "board.e2e.ts")
      ],
      ["tests/e2e/flows/board.ts", misnamed("tests/e2e/", ".e2e.ts", "board.ts", "board.e2e.ts")],
      ["tests/visual/home.visual.ts", ""],
      ["tests/visual/run.ts", misnamed("tests/visual/", ".visual.ts", "run.ts", "run.visual.ts")],
      ["tests/editor/flow.editor.ts", ""],
      [
        "tests/editor/e2e/game.spec.ts",
        misnamed("tests/editor/", ".editor.ts", "game.spec.ts", "game.editor.ts")
      ],
      ["features/home/__tests__/home.test.ts", ""],
      [
        "features/home/__tests__/home.ts",
        misnamed("__tests__/", ".test.ts", "home.ts", "home.test.ts")
      ],
      ["rules/__tests__/unit/merge.test.ts", ""],
      [
        "rules/__tests__/integration/merge.ts",
        misnamed("__tests__/integration/", ".test.ts", "merge.ts", "merge.test.ts")
      ],
      ["features/home/__tests__/isolated/home.isolated.ts", ""],
      [
        "features/home/__tests__/isolated/home.test.ts",
        misnamed("__tests__/isolated/", ".isolated.ts", "home.test.ts", "home.isolated.ts")
      ],
      ["features/home/__tests__/visual/home.visual.ts", ""],
      [
        "features/home/__tests__/visual/home.test.ts",
        misnamed("__tests__/visual/", ".visual.ts", "home.test.ts", "home.visual.ts")
      ],
      // `.tsx` takes the suffix with an x.
      ["tests/e2e/board.e2e.tsx", ""],
      ["tests/e2e/board.tsx", misnamed("tests/e2e/", ".e2e.tsx", "board.tsx", "board.e2e.tsx")],
      // Helpers, fixtures, baselines, scenarios and unknown kinds are not checked.
      ["tests/helpers/board.ts", ""],
      ["tests/scenarios/merge.ts", ""],
      ["tests/e2e/helpers/board.ts", ""],
      ["tests/editor/fixtures/game.ts", ""],
      ["tests/visual/baselines/home/rest.ts", ""],
      ["features/home/__tests__/fixtures/board.ts", ""],
      ["tests/fixtures/game/tests/e2e/board.ts", ""],
      ["tests/integration/flow.ts", ""],
      ["tests/play.ts", ""],
      ["features/home/__tests__/other/home.ts", ""],
      ["tests/e2e/data.json", ""],
      ["src/game.ts", ""]
    ];

    for (const [file, says] of cases) {
      expect(named(file), file).toEqual(says === "" ? [] : [says]);
    }

    // `suffixes` replaces the table; a key may leave out its trailing slash.
    const spec = [{ suffixes: { "tests/e2e": ".spec.ts" } }];

    expect(named("tests/e2e/board.test.ts", spec)).toEqual([
      misnamed("tests/e2e/", ".spec.ts", "board.test.ts", "board.spec.ts")
    ]);
    expect(named("tests/e2e/board.spec.ts", spec)).toEqual([]);
    expect(named("tests/visual/run.ts", spec)).toEqual([]);

    // `root` names the game folder; a test outside it is not checked.
    expect(named("game/tests/e2e/board.ts", [{ root: "game" }])).toEqual([
      misnamed("tests/e2e/", ".e2e.ts", "board.ts", "board.e2e.ts")
    ]);
    expect(named("tests/e2e/board.ts", [{ root: "game" }])).toEqual([]);
  });

  it("layout rules take root and an outside importer stays quiet", () => {
    const options = [{ root: "src" }];

    expect(importsIn("layer-imports", "src/core/kit.ts", "@shared", options)).toEqual([
      `Layers: core does not import shared. ${ORDER}`
    ]);
    expect(importsIn("layer-imports", "core/kit.ts", "@shared", options)).toEqual([]);
    expect(importsIn("feature-door", "src/features/home/a.ts", "@features", options)).toEqual([
      BARREL
    ]);
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

/** `@x` lands in features when the tsconfig is read, and is a package without it. */
const toFeatures = { "@x": ["./features/home/index.ts"] };

/**
 * What layer-imports says about `core/kit.ts` importing a specifier in a game folder.
 *
 * @param cwd - The game folder.
 * @param from - The specifier.
 * @param options - The rule options.
 * @returns The messages.
 */
const fromCore = (cwd: string, from = "@x", options: unknown[] = []): string[] =>
  importsIn("layer-imports", "core/kit.ts", from, options, cwd);

/** What layer-imports says when `@x` reaches features. */
const reaches = [`Layers: core does not import features. ${ORDER}`];

/**
 * What the layout rules say about a config that does not parse.
 *
 * @param file - The config, relative to the folder lint runs in.
 * @returns The message.
 */
const broken = (file: string): string =>
  `Lint: ${file} does not parse. The layout rules read the v15 aliases until it does.`;

describe("the tsconfig the layout rules read", () => {
  it("maps an alias as aliasTargetsOf says, the v15 table without a tsconfig", () => {
    // The scenario of the aliasTargetsOf example: /game holds no tsconfig.
    expect(aliasTargetsOf("/game/tsconfig.json", "/game", "@features/orders")).toEqual([
      "/game/features/orders/index.ts"
    ]);
    expect(aliasTargetsOf("/game/tsconfig.json", "/game", "./features/orders")).toEqual([]);
    expect(aliasTargetsOf("/game/tsconfig.json", "/game", "@moku-labs/game/testing")).toEqual([]);
    expect(aliasTargetsOf("/game/tsconfig.json", "/game", "@x")).toEqual([]);
  });

  it("reads JSONC: comments, trailing commas, and both kept inside strings", () => {
    const cwd = tempFolder();
    const tsconfig = `// the game
{
  /* compiler */ "compilerOptions": {
    "paths": {
      "@x": ["./features/home/index.ts",], // home
      "@a//b": ["./features/info/index.ts"],
      "@c/*,]": ["./features/*/index.ts"],
    },
  },
} // end`;

    writeFiles(cwd, { "tsconfig.json": tsconfig });

    const file = path.join(cwd, "tsconfig.json");

    expect(fromCore(cwd)).toEqual(reaches);
    expect(aliasTargetsOf(file, cwd, "@a//b")).toEqual([path.join(cwd, "features/info/index.ts")]);
    expect(aliasTargetsOf(file, cwd, "@c/home,]")).toEqual([
      path.join(cwd, "features/home/index.ts")
    ]);
    // A `paths` block replaces the v15 table whole.
    expect(fromCore(cwd, "@shared")).toEqual([]);
  });

  it("follows relative extends, the later entry and the nearest config winning", () => {
    const cwd = tempFolder();

    writeFiles(cwd, {
      // A package in `extends` ends that branch; a path without .json takes it.
      "tsconfig.json": JSON.stringify({ extends: ["@tsconfig/strictest", "./configs/base"] }),
      "configs/base.json": JSON.stringify({
        extends: ["./first.json", "./second.json"],
        compilerOptions: { baseUrl: ".." }
      }),
      "configs/first.json": JSON.stringify({
        compilerOptions: { paths: { "@y": ["./core/y.ts"] } }
      }),
      "configs/second.json": JSON.stringify({ compilerOptions: { paths: toFeatures } })
    });

    expect(fromCore(cwd)).toEqual(reaches);
    expect(fromCore(cwd, "@y")).toEqual([]);
    // baseUrl resolves against the config that declares it: `..` from configs/ is the game.
    expect(aliasTargetsOf(path.join(cwd, "tsconfig.json"), cwd, "@x")).toEqual([
      path.join(cwd, "features/home/index.ts")
    ]);
  });

  it("takes the extends path as written when it exists, and an absolute one", () => {
    const cwd = tempFolder();
    const base = path.join(cwd, "configs/base");

    writeFiles(cwd, {
      "tsconfig.json": JSON.stringify({ extends: "./configs/base" }),
      "configs/base": JSON.stringify({ extends: `${base}.json` }),
      "configs/base.json": JSON.stringify({ compilerOptions: { paths: toFeatures } })
    });

    expect(fromCore(cwd)).toEqual(reaches);
  });

  it("reads the v15 table when the tsconfig is missing, has no paths or extends a package", () => {
    const cwd = tempFolder();

    expect(fromCore(cwd, "@shared")).toEqual([`Layers: core does not import shared. ${ORDER}`]);
    writeFiles(cwd, { "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }) });
    expect(fromCore(cwd, "@shared")).toHaveLength(1);
    writeFiles(cwd, { "tsconfig.json": JSON.stringify({ extends: "@moku-labs/tsconfig" }) });
    expect(fromCore(cwd, "@shared")).toHaveLength(1);
    // Keys and targets with two `*`, and keys with no target, are dropped like TypeScript drops them.
    writeFiles(cwd, {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@a/*/*": ["./a/*"], "@b/*": ["./b/*/*", 3], "@c": "./c" } }
      })
    });
    expect(fromCore(cwd, "@shared")).toHaveLength(1);
  });

  it("ends an extends cycle and stops at eight configs", () => {
    const cwd = tempFolder();

    writeFiles(cwd, { "tsconfig.json": JSON.stringify({ extends: "./tsconfig.json" }) });

    expect(fromCore(cwd, "@shared")).toHaveLength(1);
  });

  it("keeps the read until a config moves, appears or vanishes", () => {
    const cwd = tempFolder();
    const file = path.join(cwd, "tsconfig.json");
    const toCore = { "@x": ["./core/x.ts"] };
    const write = (paths: Record<string, string[]>, seconds: number): void => {
      writeFiles(cwd, { "tsconfig.json": JSON.stringify({ compilerOptions: { paths } }) });
      utimesSync(file, seconds, seconds);
    };

    write(toFeatures, 1_000_000);
    expect(fromCore(cwd)).toEqual(reaches);
    // New text with the same stamp: the rule keeps its read.
    write(toCore, 1_000_000);
    expect(fromCore(cwd)).toEqual(reaches);
    // The stamp moves: the rule reads again.
    write(toCore, 1_000_010);
    expect(fromCore(cwd)).toEqual([]);
    rmSync(file);
    expect(fromCore(cwd, "@shared")).toHaveLength(1);
  });

  it("reports a config that does not parse once per file and reads the v15 table", () => {
    const cwd = tempFolder();

    writeFiles(cwd, { "tsconfig.json": '{ "compilerOptions": { "paths": ' });
    expect(fromCore(cwd, "@shared")).toEqual([
      broken("tsconfig.json"),
      `Layers: core does not import shared. ${ORDER}`
    ]);
    // An extended config that does not parse is named.
    writeFiles(cwd, {
      "tsconfig.json": JSON.stringify({ extends: "./base.json" }),
      "base.json": "{ /* open"
    });
    expect(fromCore(cwd, "@core/kit")).toEqual([broken("base.json")]);
    // A config that parses to no object, an open string and a folder in its place do not parse.
    writeFiles(cwd, { "base.json": "[]" });
    expect(fromCore(cwd, "@core/kit")).toEqual([broken("base.json")]);
    writeFiles(cwd, { "base.json": '{ "compilerOptions": "open' });
    expect(fromCore(cwd, "@core/kit")).toEqual([broken("base.json")]);
    rmSync(path.join(cwd, "base.json"));
    mkdirSync(path.join(cwd, "base.json"));
    expect(fromCore(cwd, "@core/kit")).toEqual([broken("base.json")]);
  });

  it("reads the tsconfig the options name, relative to the folder lint runs in", () => {
    const cwd = tempFolder();
    const options = [{ tsconfig: "configs/game.json" }];

    writeFiles(cwd, {
      "configs/game.json": JSON.stringify({ compilerOptions: { baseUrl: "..", paths: toFeatures } })
    });

    expect(fromCore(cwd, "@x", options)).toEqual(reaches);
    expect(fromCore(cwd)).toEqual([]);
  });
});

describe("layout rules and the project index", () => {
  it("map every specifier to the same files", async () => {
    const root = tempFolder();
    const paths = {
      "@core/*": ["./core/*"],
      "@shared": ["./shared/index.ts"],
      "@shared/rules": ["./shared/rules/index.ts"],
      "@features": ["./features/index.ts"],
      "@features/*": ["./features/*/index.ts"],
      "@plugins": ["./plugins/index.ts"],
      "@generated/*": ["./generated/*"],
      "@tests/*": ["./tests/*"],
      "@kit": ["./core/kit.ts"],
      "@kit/*": ["./core/kit/*", "./core/alt/*"],
      "@art/*.png": ["./generated/png/*.ts"],
      "@two/*/*": ["./two/*"],
      "@none": [],
      "@moku-labs/game/testing": ["./tests/helpers/testing.ts"]
    };
    const specifiers = [
      "@core/kit",
      "@core/types/cell",
      "@shared",
      "@shared/rules",
      "@shared/views/panel",
      "@features",
      "@features/home",
      "@features/home/flow/home",
      "@plugins",
      "@generated/assets",
      "@tests/helpers/board",
      "@kit",
      "@kit/x",
      "@art/logo.png",
      "@art/logo.jpg",
      "@two/a/b",
      "@none",
      "@moku-labs/game/testing",
      "@moku-labs/game",
      "./local",
      "../up",
      "pixi.js"
    ];

    writeFiles(root, {
      "tsconfig.json": `// extends a sibling, as a game may\n{ "extends": "./tsconfig.base.json", }\n`,
      "tsconfig.base.json": JSON.stringify({ compilerOptions: { paths } })
    });

    const map = await readAliases(await loadTypeScript(), root, "tsconfig.json");
    const index = specifiers.map(specifier =>
      aliasTargets(map, specifier).map(target => path.join(root, target))
    );
    const lint = specifiers.map(specifier =>
      aliasTargetsOf(path.join(root, "tsconfig.json"), root, specifier)
    );

    expect(lint).toEqual(index);
    expect(index.filter(targets => targets.length > 0)).toHaveLength(13);
  });
});
