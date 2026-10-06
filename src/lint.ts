/**
 * @file The lint door of the engine (subpath `./lint`): an oxlint JS plugin named `moku-game` with
 * the rules a game carries. A game loads it by package name in `.oxlintrc.json`
 * (`"jsPlugins": ["@moku-labs/game/lint"]`) and turns the rules on as `moku-game/<rule>`. The rules
 * use the ESLint rule API, so ESLint 9 loads the same object. Every rule takes
 * `[{ files, ignores }]`: globs relative to the directory oxlint runs in; a key given replaces the
 * default. The layout rules also take the folder of the game's layers (`root`) and the tsconfig
 * whose `paths` name the aliases (`tsconfig`). Only `node:path` and `node:fs` are imported; the
 * file is erasable TypeScript, so Node loads it unbuilt.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** The options every rule takes: which files it checks. A key given replaces the rule's default. */
export type GameLintOptions = {
  /** Globs of the files the rule checks, relative to the directory oxlint runs in. */
  files?: string[];
  /** Globs of the files the rule skips, even when `files` matches them. */
  ignores?: string[];
};

/**
 * The options of the layout rules `layer-imports`, `feature-door` and `rules-siblings`: the files,
 * where the layers sit and which tsconfig names the aliases.
 */
export type GameLintLayoutOptions = GameLintOptions & {
  /** The folder of `core/`, `shared/`, `features/`, `plugins/` and `game.ts`, relative to the directory oxlint runs in. Default `.`. */
  root?: string;
  /** The tsconfig whose `paths` name the aliases, relative to the directory oxlint runs in. Default `tsconfig.json`. */
  tsconfig?: string;
};

/** The options of `test-suffix`: the files, the game root and the suffix of each test kind folder. */
export type GameLintSuffixOptions = GameLintOptions & {
  /** The folder whose test files the rule reads, relative to the directory oxlint runs in. Default `.`. */
  root?: string;
  /** Kind folder to the suffix of its files, as `{ "tests/e2e/": ".e2e.ts" }`. Replaces the default table. */
  suffixes?: Record<string, string>;
};

/** The part of an ESTree node the rules read. oxlint and ESLint hand over full nodes. */
export type GameLintNode = {
  readonly type: string;
  /** A string on an `Identifier`; the `JSXIdentifier` node on a `JSXAttribute`. */
  readonly name?: string | GameLintNode;
  readonly value?: unknown;
  readonly kind?: string;
  readonly computed?: boolean;
  readonly importKind?: string;
  readonly exportKind?: string;
  readonly source?: GameLintNode | null;
  readonly body?: readonly GameLintNode[];
  readonly declarations?: readonly GameLintNode[];
  readonly declaration?: GameLintNode | null;
  readonly init?: GameLintNode | null;
  readonly callee?: GameLintNode;
  readonly arguments?: readonly GameLintNode[];
  readonly object?: GameLintNode;
  readonly property?: GameLintNode;
  readonly expression?: GameLintNode;
  readonly expressions?: readonly GameLintNode[];
};

/** One declaration of a name, as the scope manager of oxlint and ESLint hands it over. */
export type GameLintDefinition = {
  /** `Variable`, `Parameter`, `ImportBinding`, `FunctionName` and the other ESLint kinds. */
  readonly type: string;
  /** The declarator of a `Variable`: its `init` is the value. */
  readonly node: GameLintNode;
  /** The declaration of a `Variable`: its `kind` is `const`, `let` or `var`. */
  readonly parent?: GameLintNode | null;
};

/** The part of a scope the rules read: the names it declares and the scope around it. */
export type GameLintScope = {
  readonly set: ReadonlyMap<string, { readonly defs: readonly GameLintDefinition[] }>;
  readonly upper?: GameLintScope | null;
};

/**
 * The part of the rule context the rules read: where the file is, the options, the scopes of the
 * file and the report.
 */
export type GameLintContext = {
  readonly cwd: string;
  readonly filename: string;
  readonly options: readonly unknown[];
  readonly sourceCode: { getScope(node: GameLintNode): GameLintScope };
  report(descriptor: { node: GameLintNode; message: string }): void;
};

/** A node visitor per ESTree node type. */
export type GameLintListeners = Record<string, (node: GameLintNode) => void>;

/** One rule in the ESLint rule shape oxlint `jsPlugins` load. */
export type GameLintRule = {
  readonly meta: {
    readonly type: "problem";
    readonly docs: { readonly description: string };
    readonly schema: readonly unknown[];
  };
  create(context: GameLintContext): GameLintListeners;
};

/** The plugin object: `moku-game` and its ten rules. */
export type GameLintPlugin = {
  readonly meta: { readonly name: "moku-game" };
  readonly rules: Readonly<Record<GameLintRuleName, GameLintRule>>;
};

/** The rule names, without the `moku-game/` prefix. */
export type GameLintRuleName =
  | "lazy-imports"
  | "native-imports"
  | "dev-imports"
  | "no-module-state"
  | "determinism"
  | "rules-siblings"
  | "static-keys"
  | "layer-imports"
  | "feature-door"
  | "test-suffix";

/** A rule's default globs. */
type Scope = { readonly files: readonly string[]; readonly ignores: readonly string[] };

/** One forbidden specifier pattern of an import rule and what to say. */
type ImportCheck = { readonly pattern: RegExp; readonly message: string };

/** A layer of the v15 layout a path lies in; `other` is everything outside the layout. */
type Layer = "core" | "shared" | "features" | "plugins" | "generated" | "game" | "tests" | "other";

/**
 * Where a path lies in the layout: its layer, its unit (`core`, `shared`, `features/<f>`,
 * `plugins/<p>`, or `features` and `plugins` for the two barrels) and whether it is the unit's door,
 * its `index.ts`.
 */
type Place = { readonly layer: Layer; readonly unit?: string; readonly door: boolean };

/** One key of tsconfig `paths`: the text around its `*` and its targets, absolute, `*` kept. */
type AliasPattern = {
  readonly prefix: string;
  readonly suffix?: string;
  readonly targets: readonly string[];
};

/** One read of a tsconfig and the configs it extends. */
type TsconfigRead = {
  /** The patterns of the nearest `paths`; undefined when there is none or a config does not parse. */
  readonly patterns: readonly AliasPattern[] | undefined;
  /** The absolute path of the config that does not parse, if one does not. */
  readonly broken: string | undefined;
  /** Every config file read, with its `mtimeMs`, or `MISSING` when it was not there. */
  readonly stamps: ReadonlyMap<string, number>;
};

/** What the configs of an `extends` chain say: the nearest `paths` and `baseUrl`. */
type Chain = {
  readonly paths: Readonly<Record<string, unknown>> | undefined;
  /** Absolute: TypeScript resolves `baseUrl` against the config that declares it. */
  readonly baseUrl: string | undefined;
  /** The absolute path of the config that does not parse, if one does not. */
  readonly broken: string | undefined;
};

/** The part of a tsconfig the layout rules read. */
type TsconfigJson = Readonly<Record<string, unknown>>;

/** What a layout rule knows about the file it lints. */
type Layout = {
  /** The absolute folder of the layers. */
  readonly root: string;
  /** The absolute folder of the file. */
  readonly folder: string;
  /** Where the file lies in the layout. */
  readonly importer: Place;
  /** The aliases: the tsconfig `paths`, else the v15 table. */
  readonly patterns: readonly AliasPattern[];
  /** The report of a tsconfig that does not parse, once per file. */
  readonly problem: string | undefined;
};

/** The kind folder a test file lies in and the suffix its files end with. */
type Kind = { readonly folder: string; readonly suffix: string; readonly end: number };

/** Tests and test helpers: no rule checks them by default. */
const TESTS = ["tests/**", "**/__tests__/**", "**/*.{test,spec}.{ts,tsx}"];

/** Dev modules: a `.dev` module is wired into the editor only. */
const DEV_MODULES = ["**/*.dev.{ts,tsx}"];

/**
 * The logic of a game: state, tables, the root flow in game.ts, core, nodes, flows, rules,
 * features, shared. `**` so `src/` matches too.
 */
const LOGIC = [
  "**/state.ts",
  "**/tables.ts",
  "**/game.ts",
  "**/{core,nodes,flows,rules,features,shared}/**"
];

/** The effect side: moku plugins answer effects and may hold timers. */
const EFFECT_SIDE = ["**/{plugin,plugins}/**"];

/** The folders `test-suffix` reads. */
const TEST_FOLDERS = ["**/tests/**", "**/__tests__/**"];

/** The scope options every rule shares. */
const SCOPE_PROPERTIES = {
  files: { type: "array", items: { type: "string" } },
  ignores: { type: "array", items: { type: "string" } }
};

/** The options schema of the rules without a layout; oxlint refuses options a rule has no schema for. */
const SCHEMA = [{ type: "object", properties: SCOPE_PROPERTIES, additionalProperties: false }];

/** The options schema of the layout rules: the scope, `root` and `tsconfig`. */
const LAYOUT_SCHEMA = [
  {
    type: "object",
    properties: { ...SCOPE_PROPERTIES, root: { type: "string" }, tsconfig: { type: "string" } },
    additionalProperties: false
  }
];

/** The options schema of `test-suffix`: the scope, `root` and `suffixes`. */
const SUFFIX_SCHEMA = [
  {
    type: "object",
    properties: {
      ...SCOPE_PROPERTIES,
      root: { type: "string" },
      suffixes: { type: "object", additionalProperties: { type: "string" } }
    },
    additionalProperties: false
  }
];

/** Bases of a timer call that still reach the global timer. */
const GLOBAL_OBJECT = /^(?:globalThis|window|self)$/;

/** The global timers of L3. */
const TIMER = /^set(?:Timeout|Interval)$/;

/** The forbidden member reads of L3: object, property and the fix. */
const CLOCK_READS = [
  { object: "Math", property: "random", message: "L3: use an rng stream: rng.stream(id)." },
  { object: "Date", property: "now", message: "L3: use `now` from the node context." },
  { object: "performance", property: "now", message: "L3: use `now` from the node context." }
];

/** The collections a module may not hold at module scope (L5). */
const COLLECTION = /^(?:Map|Set|WeakMap|WeakSet)$/;

/**
 * A key-carrying prop the project index fills a key from: `id`, or a name that ends in `Key`. The
 * index holds its own copy; a behavioural unit test keeps the two in step: the rule accepts
 * `props.<name>` exactly when the index turns it into a `{<name>}` hole.
 */
const KEY_PROP = /^(?:id|\w+Key)$/;

/** The wrappers a key is read through, as the index reads them: casts, parentheses, `?.` chains. */
const KEY_WRAPPER =
  /^(?:TSAsExpression|TSSatisfiesExpression|TSNonNullExpression|TSTypeAssertion|ParenthesizedExpression|ChainExpression)$/;

/** How many `const` initializers a key name is followed through. */
const KEY_HOPS = 3;

/** What static-keys says about a key the project index cannot follow. */
const STATIC_KEYS_MESSAGE =
  'Keys: a JSX key must be a literal, a template, or props.id / props.<name>Key. Pass the key in as a prop: <X id="…">.';

/**
 * The aliases of the v15 layout, relative to the game root. The layout rules read them when the
 * tsconfig is missing, declares no `paths` or does not parse; a `paths` block replaces them whole.
 */
const V15_PATHS: Readonly<Record<string, readonly string[]>> = {
  "@core/*": ["core/*"],
  "@shared": ["shared/index.ts"],
  "@shared/rules": ["shared/rules/index.ts"],
  "@features": ["features/index.ts"],
  "@features/*": ["features/*/index.ts"],
  "@plugins": ["plugins/index.ts"],
  "@generated/*": ["generated/*"],
  "@tests/*": ["tests/*"]
};

/** The engine and its subpaths: a package even when the tsconfig `paths` map it. */
const ENGINE = /^@moku-labs\/game(?:\/|$)/;

/** A specifier relative to the importing file, or an absolute path: never an alias. */
const NOT_BARE = /^(?:\.{1,2}(?:\/|$)|\/)/;

/** A specifier relative to the importing file. */
const RELATIVE = /^\.{1,2}(?:\/|$)/;

/** How many configs deep an `extends` chain is followed; a cycle ends there too. */
const MAX_EXTENDS = 8;

/** The stamp of a config file that is not there. */
const MISSING = -1;

/** A door file: the `index` of a unit, with or without its extension. */
const INDEX_FILE = /^index(?:\.[jt]sx?)?$/;

/** The root flow of a game, with or without its extension. */
const GAME_FILE = /^game(?:\.[jt]sx?)?$/;

/** The place of every path outside the layout. */
const OTHER: Place = { layer: "other", door: false };

/** The layers each layer imports. `game.ts` imports every layer; the rest is not checked. */
const LAYER_REACH: Readonly<Partial<Record<Layer, readonly Layer[]>>> = {
  core: ["core", "generated"],
  shared: ["core", "shared", "generated"],
  features: ["core", "shared", "features", "generated"],
  plugins: ["core", "shared", "plugins", "generated"]
};

/** The second sentence of every layer-imports report. */
const LAYER_ORDER = "Order: core ← shared ← features ← game.ts; plugins import core and shared.";

/** What feature-door says about a barrel imported below game.ts. */
const BARREL_MESSAGE = "Door: only game.ts imports the @features and @plugins barrels.";

/** The specifiers a rule imports besides its siblings, as written. */
const RULE_ALIASES = /^@(?:core\/types|shared\/rules)$/;

/** The files a rule imports besides its siblings, relative to the game root, any spelling. */
const RULE_IMPORTS = [
  /^core\/types(?:\.[jt]sx?|\/.+)?$/,
  /^shared\/rules(?:\/index(?:\.[jt]sx?)?)?$/
];

/** What rules-siblings says. */
const SIBLINGS_MESSAGE =
  "L4: a rule imports only its siblings in rules/, @core/types and @shared/rules: (state, input, tables) => result.";

/** The suffix of each test kind folder. A table given in the options replaces it whole. */
const TEST_SUFFIXES: Readonly<Record<string, string>> = {
  "tests/e2e/": ".e2e.ts",
  "tests/visual/": ".visual.ts",
  "tests/editor/": ".editor.ts",
  "__tests__/": ".test.ts",
  "__tests__/unit/": ".test.ts",
  "__tests__/integration/": ".test.ts",
  "__tests__/isolated/": ".isolated.ts",
  "__tests__/visual/": ".visual.ts"
};

/** A test root folder. */
const TEST_ROOT = /^(?:tests|__tests__)$/;

/** A kind folder key that names a test root itself: it holds only the files directly inside. */
const TEST_ROOT_KEY = /(?:^|\/)(?:tests|__tests__)\/$/;

/** The sub-folders of a test root whose files are helpers, not tests. */
const HELPER_FOLDER = /^(?:helpers|fixtures|baselines)$/;

/** A source file `test-suffix` reads. */
const SCRIPT = /\.tsx?$/;

/** The test word a misnamed file may carry already: `board.test.ts` becomes `board.e2e.ts`. */
const TEST_WORD = /\.(?:test|spec|e2e|visual|editor|isolated)$/;

/**
 * Turn a glob into an anchored regular expression: `**`, `*`, `?` and one level of `{a,b}`.
 *
 * @param glob - A POSIX glob relative to the lint root.
 * @returns The expression a relative POSIX path is tested against.
 * @example
 * ```ts
 * globToRegExp("{nodes,rules}/*.ts").test("rules/merge.ts"); // true
 * ```
 */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  let index = 0;

  while (index < glob.length) {
    const char = glob.charAt(index);

    if (glob.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 3;
    } else if (glob.startsWith("**", index)) {
      source += ".*";
      index += 2;
    } else {
      source += globChar(char);
      index += 1;
    }
  }

  return new RegExp(`^${source}$`);
}

/**
 * The expression for one glob character other than `**`.
 *
 * @param char - The character.
 * @returns Its regular-expression source.
 */
function globChar(char: string): string {
  switch (char) {
    case "*": {
      return "[^/]*";
    }
    case "?": {
      return "[^/]";
    }
    case "{": {
      return "(?:";
    }
    case "}": {
      return ")";
    }
    case ",": {
      return "|";
    }
    default: {
      return char.replaceAll(/[$()+.[\\\]^|]/g, String.raw`\$&`);
    }
  }
}

/**
 * A path with `/` between its parts on every platform.
 *
 * @param file - A path.
 * @returns The POSIX spelling.
 * @example
 * ```ts
 * toPosix("core/kit.ts"); // "core/kit.ts"
 * ```
 */
function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}

/**
 * A path relative to a folder, when it lies inside it.
 *
 * @param folder - The absolute folder.
 * @param file - The absolute path.
 * @returns The relative POSIX path, or undefined for a path outside the folder.
 * @example
 * ```ts
 * insideOf("/game", "/game/core/kit.ts"); // "core/kit.ts"
 * ```
 */
function insideOf(folder: string, file: string): string | undefined {
  const relative = toPosix(path.relative(folder, file));
  const isOutside = relative === ".." || relative.startsWith("../") || path.isAbsolute(relative);

  return isOutside ? undefined : relative;
}

/**
 * Whether the rule checks the file the context lints: `files` match and no `ignores` match.
 *
 * @param context - The rule context.
 * @param defaults - The rule's default globs.
 * @returns True when the rule applies.
 */
function inScope(context: GameLintContext, defaults: Scope): boolean {
  const [given] = context.options as [GameLintOptions?];
  const files = given?.files ?? defaults.files;
  const ignores = given?.ignores ?? defaults.ignores;
  const file = toPosix(path.relative(context.cwd, context.filename));

  const matches = (globs: readonly string[]): boolean =>
    globs.some(glob => globToRegExp(glob).test(file));

  return matches(files) && !matches(ignores);
}

/**
 * The specifier of an import node, when it is a string literal.
 *
 * @param node - An import, export-from or `import()` node.
 * @returns The specifier, or undefined for a computed `import()` or a local export.
 */
function specifierOf(node: GameLintNode): string | undefined {
  const value = node.source?.type === "Literal" ? node.source.value : undefined;

  return typeof value === "string" ? value : undefined;
}

/**
 * Whether a static import or export carries types only: `import type` or `export type`.
 * `import { type A }` keeps a side-effect import under `verbatimModuleSyntax`, so it counts as a value.
 *
 * @param node - A static import or export node.
 * @returns True for a type-only statement.
 */
function isTypeOnly(node: GameLintNode): boolean {
  return node.importKind === "type" || node.exportKind === "type";
}

/**
 * Build a rule that reports imports of forbidden specifiers.
 *
 * @param description - What the rule enforces.
 * @param defaults - The rule's default globs.
 * @param checks - The forbidden patterns and their messages.
 * @param lazy - True for L2: `import()` and type-only statements pass.
 * @returns The rule.
 */
function importRule(
  description: string,
  defaults: Scope,
  checks: readonly ImportCheck[],
  lazy = false
): GameLintRule {
  return {
    meta: { type: "problem", docs: { description }, schema: SCHEMA },
    /**
     * Visit the file when the rule's globs match it.
     *
     * @param context - The rule context.
     * @returns The node visitors, none for a file out of scope.
     */
    create(context) {
      if (!inScope(context, defaults)) return {};

      const check = (node: GameLintNode): void => {
        const name = specifierOf(node);
        const hit = name === undefined ? undefined : checks.find(item => item.pattern.test(name));

        if (hit === undefined) return;
        if (lazy && isTypeOnly(node)) return;
        context.report({ node, message: hit.message });
      };

      const listeners: GameLintListeners = {
        ImportDeclaration: check,
        ExportAllDeclaration: check,
        ExportNamedDeclaration: check
      };

      if (!lazy) listeners.ImportExpression = check;

      return listeners;
    }
  };
}

/**
 * The name a node carries: the name of an `Identifier`, the name of the `JSXIdentifier` of a
 * `JSXAttribute`.
 *
 * @param node - Any node.
 * @returns The name, or undefined for a node without one.
 */
function nameOf(node: GameLintNode | null | undefined): string | undefined {
  const name = node?.name;

  if (typeof name === "string") return name;

  return typeof name?.name === "string" ? name.name : undefined;
}

/**
 * The name of a member's property: `a.b` and `a["b"]`.
 *
 * @param node - A MemberExpression.
 * @returns The property name, or undefined for a computed non-literal key.
 */
function propertyName(node: GameLintNode): string | undefined {
  const key = node.property;

  if (key === undefined) return undefined;
  if (!node.computed) return nameOf(key);

  return typeof key.value === "string" ? key.value : undefined;
}

/**
 * Report the module-scope state of one top-level statement (L5).
 *
 * @param context - The rule context.
 * @param statement - A statement of the Program body.
 */
function reportModuleState(context: GameLintContext, statement: GameLintNode): void {
  const declaration =
    statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;

  if (declaration?.type !== "VariableDeclaration") return;

  // A `let` or `var` binding is state that outlives every app.
  if (declaration.kind === "let" || declaration.kind === "var") {
    context.report({
      node: declaration,
      message: "L5: no module-scope state. State lives in player and session."
    });
    return;
  }

  // A collection is state too, even behind a `const`.
  for (const declarator of declaration.declarations ?? []) {
    const init = declarator.init;
    const isCollection =
      init?.type === "NewExpression" && COLLECTION.test(nameOf(init.callee) ?? "");

    if (isCollection) {
      context.report({
        node: init,
        message: "L5: no module-scope collections. Create them inside a function."
      });
    }
  }
}

/**
 * Whether a call's callee reaches a global timer: `setTimeout(...)`, `globalThis.setInterval(...)`.
 *
 * @param callee - The callee of a CallExpression.
 * @returns True for a timer.
 */
function isTimer(callee: GameLintNode | undefined): boolean {
  if (callee?.type === "Identifier") return TIMER.test(nameOf(callee) ?? "");
  if (callee?.type !== "MemberExpression") return false;

  return GLOBAL_OBJECT.test(nameOf(callee.object) ?? "") && TIMER.test(propertyName(callee) ?? "");
}

/** L2: static value imports of the packages the engine loads lazily. */
const lazyImports = importRule(
  "No static import of pixi.js or yoga-layout; import() and import type pass.",
  { files: ["**"], ignores: TESTS },
  [
    {
      pattern: /^pixi\.js(?:\/|$)/,
      message:
        "L2: the renderer loads Pixi lazily. Draw with the engine's tags, use import() or import type."
    },
    {
      pattern: /^yoga-layout(?:\/|$)/,
      message: "L2: the ui plugin loads Yoga lazily. Use import() or import type."
    }
  ],
  true
);

/** L13: native packages stay out of the engine-facing layers. */
const nativeImports = importRule(
  "No @moku-labs/system, @moku-labs/native or @tauri-apps/* in the engine-facing layers.",
  { files: [...LOGIC, "**/kit.ts", "**/plugins/**"], ignores: [...DEV_MODULES, ...TESTS] },
  [
    {
      pattern: /^(?:@moku-labs\/(?:system|native)(?:\/|$)|@tauri-apps\/)/,
      message:
        "L13: a native package is imported only where the platform is wired: platform-bridge.ts, native.ts, web/ today; the engine CLI after B3. Pass a PlatformProvider."
    }
  ]
);

/** Dev only: the editor and the control door stay in dev files. */
const developmentImports = importRule(
  "@moku-labs/editor and @moku-labs/game/control only in dev files and tests.",
  {
    files: ["**"],
    ignores: ["web/main.ts", "web/dev*.ts", "web/editor*.ts", ...DEV_MODULES, ...TESTS]
  },
  [
    {
      pattern: /^@moku-labs\/(?:editor(?:\/|$)|game\/control$)/,
      message:
        "Dev only: the dev page (web/main.ts, web/dev*.ts, web/editor*.ts), .dev modules and tests import the editor and /control."
    }
  ]
);

/** L5: no module-scope `let` or `var` and no module-scope collection. */
const noModuleState: GameLintRule = {
  meta: {
    type: "problem",
    docs: {
      description: "No module-scope let or var and no module-scope Map, Set, WeakMap, WeakSet."
    },
    schema: SCHEMA
  },
  /**
   * Visit the file when the rule's globs match it.
   *
   * @param context - The rule context.
   * @returns The node visitors, none for a file out of scope.
   */
  create(context) {
    if (!inScope(context, { files: ["**"], ignores: TESTS })) return {};

    return {
      Program: program => {
        for (const statement of program.body ?? []) reportModuleState(context, statement);
      }
    };
  }
};

/** L3: no device clock, no timers, no unseeded randomness in the logic. Plugins hold the timers. */
const determinism: GameLintRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "No Math.random, Date.now, performance.now, new Date(), setTimeout or setInterval in the logic."
    },
    schema: SCHEMA
  },
  /**
   * Visit the file when the rule's globs match it.
   *
   * @param context - The rule context.
   * @returns The node visitors, none for a file out of scope.
   */
  create(context) {
    const ignores = [...EFFECT_SIDE, ...DEV_MODULES, ...TESTS];

    if (!inScope(context, { files: LOGIC, ignores })) return {};

    return {
      MemberExpression: node => {
        const property = propertyName(node);
        const read = CLOCK_READS.find(
          item => item.object === nameOf(node.object) && item.property === property
        );

        if (read !== undefined) context.report({ node, message: read.message });
      },
      NewExpression: node => {
        if (nameOf(node.callee) === "Date" && (node.arguments ?? []).length === 0) {
          context.report({ node, message: "L3: use `now` from the node context." });
        }
      },
      CallExpression: node => {
        if (isTimer(node.callee)) {
          context.report({
            node,
            message: "L3: store the moment in player, await fx(schedule(moment))."
          });
        }
      }
    };
  }
};

/**
 * Whether a value an attribute holds is a node: the `JSXExpressionContainer` of `key={…}`.
 *
 * @param value - The `value` of a node.
 * @returns True for a node.
 */
function isNode(value: unknown): value is GameLintNode {
  return typeof value === "object" && value !== null && "type" in value;
}

/**
 * A key expression without the wrappers around it: `props.id as string` and `props?.id` read
 * `props.id`.
 *
 * @param node - The key expression.
 * @returns The expression inside.
 */
function unwrapKey(node: GameLintNode | null | undefined): GameLintNode | null | undefined {
  let inner = node;

  while (inner !== null && inner !== undefined && KEY_WRAPPER.test(inner.type)) {
    inner = inner.expression;
  }

  return inner;
}

/**
 * The declaration of a name where it is used, read scope by scope outwards.
 *
 * @param context - The rule context.
 * @param identifier - The name where it is used.
 * @returns Its first declaration, or undefined for a name the file does not declare.
 */
function definitionOf(
  context: GameLintContext,
  identifier: GameLintNode
): GameLintDefinition | undefined {
  const name = nameOf(identifier) ?? "";

  for (
    let scope: GameLintScope | null | undefined = context.sourceCode.getScope(identifier);
    scope;
    scope = scope.upper
  ) {
    const variable = scope.set.get(name);

    if (variable !== undefined) return variable.defs[0];
  }

  return undefined;
}

/** The declarations a key name is left to the index for: `--check` lists what it cannot read. */
const OUT_OF_REACH = /^(?:Parameter|ImportBinding)$/;

/**
 * Whether a key name is one the project index reads: a `const` whose value is a static key, or a
 * name out of reach here (a parameter, an import, a global), which `--check` lists when the index
 * cannot read it.
 *
 * @param context - The rule context.
 * @param identifier - The name.
 * @param hops - How many `const` initializers were followed to reach it.
 * @returns False for a `let`, a `var`, a `const` whose value the index cannot follow, and a
 *   function, a class or a catch parameter.
 */
function isStaticName(context: GameLintContext, identifier: GameLintNode, hops: number): boolean {
  const definition = definitionOf(context, identifier);

  if (definition === undefined || OUT_OF_REACH.test(definition.type) || hops >= KEY_HOPS) {
    return true;
  }
  if (definition.type !== "Variable") return false;

  return (
    definition.parent?.kind === "const" && isStaticKey(context, definition.node.init, hops + 1)
  );
}

/**
 * Whether a key expression is one the project index reads: a literal, a template of static parts,
 * `props.id` or `props.<name>Key`, a call, or a name that holds one.
 *
 * @param context - The rule context.
 * @param node - The key expression.
 * @param hops - How many `const` initializers were followed to reach it.
 * @returns False for an element access, `??`, `||`, `&&`, `?:` and any other member.
 */
function isStaticKey(
  context: GameLintContext,
  node: GameLintNode | null | undefined,
  hops: number
): boolean {
  const expression = unwrapKey(node);

  switch (expression?.type) {
    case "Literal": {
      return typeof expression.value === "string" || typeof expression.value === "number";
    }
    case "TemplateLiteral": {
      return (expression.expressions ?? []).every(part => isStaticKey(context, part, hops));
    }
    case "MemberExpression": {
      const isPlainMember = !expression.computed && expression.object?.type === "Identifier";

      return isPlainMember && KEY_PROP.test(propertyName(expression) ?? "");
    }
    case "Identifier": {
      return isStaticName(context, expression, hops);
    }
    case "CallExpression": {
      return true;
    }
    default: {
      return false;
    }
  }
}

/** Keys: a JSX key is a shape the project index reads, so `find` reaches it from a runtime key. */
const staticKeys: GameLintRule = {
  meta: {
    type: "problem",
    docs: {
      description: "A JSX key is a literal, a template, props.id or props.<name>Key, or a call."
    },
    schema: SCHEMA
  },
  /**
   * Visit the file when the rule's globs match it.
   *
   * @param context - The rule context.
   * @returns The node visitors, none for a file out of scope.
   */
  create(context) {
    if (!inScope(context, { files: ["**/*.tsx"], ignores: TESTS })) return {};

    return {
      JSXAttribute: node => {
        const container = isNode(node.value) ? node.value : undefined;
        const isKey = nameOf(node) === "key" && container?.type === "JSXExpressionContainer";

        if (isKey && !isStaticKey(context, container.expression, 0)) {
          context.report({ node, message: STATIC_KEYS_MESSAGE });
        }
      }
    };
  }
};

/**
 * Where a JSON string that opens at `at` ends: the index after its closing quote.
 *
 * @param text - The text.
 * @param at - The index of the opening quote.
 * @returns The index after the closing quote, or the length for a string left open.
 * @example
 * ```ts
 * stringEnd('"a\\"b" x', 0); // 6
 * ```
 */
function stringEnd(text: string, at: number): number {
  let index = at + 1;

  while (index < text.length && text.charAt(index) !== '"') {
    index += text.charAt(index) === "\\" ? 2 : 1;
  }

  return Math.min(index + 1, text.length);
}

/**
 * JSONC without its comments; a comment inside a string stays.
 *
 * @param text - The JSONC text.
 * @returns The text with every `//` and `/* *\/` comment turned into a space.
 * @example
 * ```ts
 * withoutComments('{ "a": "//" } // note'); // '{ "a": "//" }  '
 * ```
 */
function withoutComments(text: string): string {
  let json = "";
  let index = 0;

  while (index < text.length) {
    if (text.charAt(index) === '"') {
      const end = stringEnd(text, index);

      json += text.slice(index, end);
      index = end;
    } else if (text.startsWith("//", index)) {
      const end = text.indexOf("\n", index);

      json += " ";
      index = end === -1 ? text.length : end;
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);

      json += " ";
      index = end === -1 ? text.length : end + 2;
    } else {
      json += text.charAt(index);
      index += 1;
    }
  }

  return json;
}

/**
 * Whether the next character after the blanks from an index closes an object or an array.
 *
 * @param json - The text.
 * @param from - Where to look from.
 * @returns True before `}` or `]`.
 * @example
 * ```ts
 * closesNext("1,\n]", 2); // true
 * ```
 */
function closesNext(json: string, from: number): boolean {
  let index = from;

  while (/\s/.test(json.charAt(index))) index += 1;

  return json.charAt(index) === "}" || json.charAt(index) === "]";
}

/**
 * JSON without its trailing commas; a comma inside a string stays.
 *
 * @param json - JSON without comments.
 * @returns The text with every comma before a `}` or `]` dropped.
 * @example
 * ```ts
 * withoutTrailingCommas('{ "a": [1, 2,], }'); // '{ "a": [1, 2] }'
 * ```
 */
function withoutTrailingCommas(json: string): string {
  let strict = "";
  let index = 0;

  while (index < json.length) {
    const char = json.charAt(index);

    if (char === '"') {
      const end = stringEnd(json, index);

      strict += json.slice(index, end);
      index = end;
    } else {
      if (char !== "," || !closesNext(json, index + 1)) strict += char;
      index += 1;
    }
  }

  return strict;
}

/**
 * Whether a parsed JSON value is an object.
 *
 * @param value - The value.
 * @returns True for an object that is not an array.
 * @example
 * ```ts
 * isObject({ paths: {} }); // true
 * ```
 */
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A tsconfig as JSON: comments and trailing commas allowed, as TypeScript allows them.
 *
 * @param text - The text of the file.
 * @returns The object, or undefined when the text does not parse to one.
 * @example
 * ```ts
 * parseTsconfig('{ "extends": "./base.json", } // shared'); // { extends: "./base.json" }
 * ```
 */
function parseTsconfig(text: string): TsconfigJson | undefined {
  try {
    const value: unknown = JSON.parse(withoutTrailingCommas(withoutComments(text)));

    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read and parse a config file.
 *
 * @param file - The absolute path.
 * @returns The object, or undefined when the file cannot be read or does not parse.
 */
function readConfig(file: string): TsconfigJson | undefined {
  try {
    return parseTsconfig(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * The stamp of a file: its `mtimeMs`, or `MISSING`.
 *
 * @param file - The absolute path.
 * @returns The stamp.
 */
function stampOf(file: string): number {
  return statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? MISSING;
}

/**
 * The configs a tsconfig extends that the rules follow: relative and absolute paths, in the order
 * written. A package name ends the chain: lint resolves no node module. A path without `.json`
 * that is not there takes the extension, as TypeScript does.
 *
 * @param file - The absolute path of the config.
 * @param value - Its `extends`: a string, an array, or nothing.
 * @returns The absolute paths of the configs it extends.
 */
function parentsOf(file: string, value: unknown): string[] {
  const names = Array.isArray(value) ? value : [value];

  return names
    .filter((name): name is string => typeof name === "string")
    .filter(name => RELATIVE.test(name) || path.isAbsolute(name))
    .map(name => path.resolve(path.dirname(file), name))
    .map(parent =>
      parent.endsWith(".json") || stampOf(parent) !== MISSING ? parent : `${parent}.json`
    );
}

/**
 * Read a config and the configs it extends: the nearest `paths` and `baseUrl` win, and the later
 * entry of an `extends` array wins over the earlier one, as in TypeScript.
 *
 * @param file - The absolute path of the config.
 * @param depth - How many configs deep the chain is.
 * @param stamps - The files read and their stamps; this read adds to it.
 * @returns What the chain says, or the config that does not parse.
 */
function readChain(file: string, depth: number, stamps: Map<string, number>): Chain {
  const stamp = stampOf(file);

  stamps.set(file, stamp);
  if (stamp === MISSING) return { paths: undefined, baseUrl: undefined, broken: undefined };

  const config = readConfig(file);

  if (config === undefined) return { paths: undefined, baseUrl: undefined, broken: file };

  const options = isObject(config.compilerOptions) ? config.compilerOptions : {};
  let paths = isObject(options.paths) ? options.paths : undefined;
  let baseUrl =
    typeof options.baseUrl === "string"
      ? path.resolve(path.dirname(file), options.baseUrl)
      : undefined;

  for (const parent of parentsOf(file, config.extends).toReversed()) {
    if ((paths !== undefined && baseUrl !== undefined) || depth >= MAX_EXTENDS) break;

    const inherited = readChain(parent, depth + 1, stamps);

    if (inherited.broken !== undefined) return inherited;
    paths ??= inherited.paths;
    baseUrl ??= inherited.baseUrl;
  }

  return { paths, baseUrl, broken: undefined };
}

/**
 * How many `*` a key or a target holds.
 *
 * @param text - A key or a target of `paths`.
 * @returns The count.
 * @example
 * ```ts
 * starsOf("@features/*"); // 1
 * ```
 */
function starsOf(text: string): number {
  return text.split("*").length - 1;
}

/**
 * The targets of one key of `paths`, absolute: each string target with one `*` at most.
 *
 * @param base - The absolute folder the targets are relative to.
 * @param value - The value of the key.
 * @returns The targets, `*` kept.
 * @example
 * ```ts
 * targetsOf("/game", ["./core/*", 3]); // ["/game/core/*"]
 * ```
 */
function targetsOf(base: string, value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((target): target is string => typeof target === "string" && starsOf(target) <= 1)
    .map(target => path.resolve(base, target));
}

/**
 * The patterns of a `paths` block: one per key with one `*` at most and a target.
 *
 * @param base - The absolute folder the targets are relative to.
 * @param paths - The `paths` block.
 * @returns The patterns, in the order of the keys.
 * @example
 * ```ts
 * patternsOf("/game", { "@core/*": ["./core/*"] }); // [{ prefix: "@core/", suffix: "", targets: ["/game/core/*"] }]
 * ```
 */
function patternsOf(base: string, paths: Readonly<Record<string, unknown>>): AliasPattern[] {
  const patterns: AliasPattern[] = [];

  for (const [key, value] of Object.entries(paths)) {
    const targets = targetsOf(base, value);
    const star = key.indexOf("*");

    if (targets.length === 0 || starsOf(key) > 1) continue;

    patterns.push(
      star === -1
        ? { prefix: key, targets }
        : { prefix: key.slice(0, star), suffix: key.slice(star + 1), targets }
    );
  }

  return patterns;
}

/**
 * Read a tsconfig for the layout rules: the patterns of its nearest `paths`, resolved against
 * `baseUrl` when one is set, else against the folder of the tsconfig, as the project index does.
 *
 * @param file - The absolute path of the tsconfig.
 * @returns The read, with the stamps of every config it touched.
 */
function readTsconfig(file: string): TsconfigRead {
  const stamps = new Map<string, number>();
  const chain = readChain(file, 0, stamps);
  const patterns =
    chain.paths === undefined ? [] : patternsOf(chain.baseUrl ?? path.dirname(file), chain.paths);

  return {
    patterns: patterns.length === 0 ? undefined : patterns,
    broken: chain.broken,
    stamps
  };
}

/**
 * Whether every file of a read still has its stamp: one `statSync` per file.
 *
 * @param read - An earlier read.
 * @returns True when no config moved, appeared or vanished.
 */
function isFresh(read: TsconfigRead): boolean {
  for (const [file, stamp] of read.stamps) if (stampOf(file) !== stamp) return false;

  return true;
}

/**
 * Whether a `*` key matches a specifier.
 *
 * @param prefix - The text before the `*`.
 * @param suffix - The text after it.
 * @param specifier - The module specifier.
 * @returns True when the specifier starts with the prefix and ends with the suffix.
 * @example
 * ```ts
 * matchesStar("@core/", "", "@core/kit"); // true
 * ```
 */
function matchesStar(prefix: string, suffix: string, specifier: string): boolean {
  return (
    specifier.length >= prefix.length + suffix.length &&
    specifier.startsWith(prefix) &&
    specifier.endsWith(suffix)
  );
}

/**
 * The targets a specifier maps to, the way TypeScript maps it: a key without `*` equal to the
 * specifier wins; else the `*` key with the longest prefix, its `*` filled into every target. A
 * copy of `aliasTargets` in `src/project/aliases.ts`, which reads the tsconfig with TypeScript; this
 * file stays free of it. A behavioural unit test keeps the two in step.
 *
 * @param patterns - The aliases.
 * @param specifier - The module specifier as written.
 * @returns The absolute targets; `[]` for a relative specifier, the engine and no match.
 * @example
 * ```ts
 * targetsFor([{ prefix: "@core/", suffix: "", targets: ["/game/core/*"] }], "@core/kit"); // ["/game/core/kit"]
 * ```
 */
function targetsFor(patterns: readonly AliasPattern[], specifier: string): string[] {
  if (NOT_BARE.test(specifier) || ENGINE.test(specifier)) return [];

  const exact = patterns.find(
    pattern => pattern.suffix === undefined && pattern.prefix === specifier
  );

  if (exact !== undefined) return [...exact.targets];

  let best: { readonly pattern: AliasPattern; readonly suffix: string } | undefined;

  for (const pattern of patterns) {
    const { suffix } = pattern;
    const isLonger = best === undefined || pattern.prefix.length > best.pattern.prefix.length;

    if (suffix !== undefined && isLonger && matchesStar(pattern.prefix, suffix, specifier)) {
      best = { pattern, suffix };
    }
  }

  if (best === undefined) return [];

  const hole = specifier.slice(best.pattern.prefix.length, specifier.length - best.suffix.length);

  return best.pattern.targets.map(target => target.replace("*", () => hole));
}

/**
 * The files a module specifier names through the aliases the layout rules read: the nearest
 * `paths` of the tsconfig and the configs it extends by relative path, else the v15 aliases under
 * the game root. A specifier is matched as TypeScript matches it; `@moku-labs/game` is a package
 * even when the paths map it. The project index maps a specifier the same way, and a unit test
 * keeps the two in step.
 *
 * @param tsconfig - The absolute path of the tsconfig.
 * @param root - The absolute folder of the layers; the v15 aliases resolve against it.
 * @param specifier - The module specifier as written.
 * @returns The absolute targets in the order of the tsconfig; `[]` for a relative specifier, the
 *   engine and a package.
 * @example
 * ```ts
 * // A game without a tsconfig reads the v15 aliases.
 * aliasTargetsOf("/game/tsconfig.json", "/game", "@features/orders"); // ["/game/features/orders/index.ts"]
 * ```
 */
export function aliasTargetsOf(tsconfig: string, root: string, specifier: string): string[] {
  return targetsFor(readTsconfig(tsconfig).patterns ?? patternsOf(root, V15_PATHS), specifier);
}

/**
 * Whether the parts of a path below a unit folder name its door: nothing, or `index` alone.
 *
 * @param inner - The parts below the unit folder.
 * @returns True for the unit folder itself and its `index` file.
 * @example
 * ```ts
 * isDoor(["index.ts"]); // true
 * ```
 */
function isDoor(inner: readonly string[]): boolean {
  return inner.length === 0 || (inner.length === 1 && INDEX_FILE.test(inner[0] ?? ""));
}

/**
 * The place of a path under `features/` or `plugins/`: the barrel, a unit and its door, or a
 * file that lies directly in the folder, which is outside the layout.
 *
 * @param layer - `features` or `plugins`.
 * @param below - The parts of the path below the layer folder.
 * @returns The place.
 * @example
 * ```ts
 * unitOf("features", ["orders", "index.ts"]); // { layer: "features", unit: "features/orders", door: true }
 * ```
 */
function unitOf(layer: "features" | "plugins", below: readonly string[]): Place {
  const [name, ...inner] = below;

  if (name === undefined || (inner.length === 0 && INDEX_FILE.test(name))) {
    return { layer, unit: layer, door: true };
  }
  if (inner.length === 0 && path.extname(name) !== "") return OTHER;

  return { layer, unit: `${layer}/${name}`, door: isDoor(inner) };
}

/**
 * Where a path lies in the layout of a game.
 *
 * @param root - The absolute folder of the layers.
 * @param file - The absolute path, with or without its extension.
 * @returns The place; `other` for a path outside the layout.
 * @example
 * ```ts
 * placeOf("/game", "/game/shared/index.ts"); // { layer: "shared", unit: "shared", door: true }
 * ```
 */
function placeOf(root: string, file: string): Place {
  const relative = insideOf(root, file);

  if (relative === undefined) return OTHER;

  const [head = "", ...below] = relative.split("/");

  switch (head) {
    case "core": {
      return { layer: "core", unit: "core", door: false };
    }
    case "shared": {
      return { layer: "shared", unit: "shared", door: isDoor(below) };
    }
    case "features":
    case "plugins": {
      return unitOf(head, below);
    }
    case "generated":
    case "tests": {
      return { layer: head, door: false };
    }
    default: {
      return GAME_FILE.test(relative) ? { layer: "game", door: false } : OTHER;
    }
  }
}

/**
 * Whether a place is one of the two barrels, `features/index.ts` or `plugins/index.ts`.
 *
 * @param place - A place.
 * @returns True for a barrel.
 * @example
 * ```ts
 * isBarrel({ layer: "features", unit: "features", door: true }); // true
 * ```
 */
function isBarrel(place: Place): boolean {
  return (place.layer === "features" || place.layer === "plugins") && place.unit === place.layer;
}

/**
 * What a layout rule knows about the file the context lints: the layers, the aliases and where
 * the file lies.
 *
 * @param context - The rule context.
 * @param reads - The tsconfig reads of the rule, by absolute path.
 * @returns The layout.
 */
function layoutOf(context: GameLintContext, reads: Map<string, TsconfigRead>): Layout {
  const [given] = context.options as [GameLintLayoutOptions?];
  const root = path.resolve(context.cwd, given?.root ?? ".");
  const tsconfig = path.resolve(context.cwd, given?.tsconfig ?? "tsconfig.json");
  const file = path.resolve(context.cwd, context.filename);
  let read = reads.get(tsconfig);

  if (read === undefined || !isFresh(read)) {
    read = readTsconfig(tsconfig);
    reads.set(tsconfig, read);
  }

  const broken = read.broken === undefined ? undefined : path.relative(context.cwd, read.broken);

  return {
    root,
    folder: path.dirname(file),
    importer: placeOf(root, file),
    patterns: read.patterns ?? patternsOf(root, V15_PATHS),
    problem:
      broken === undefined
        ? undefined
        : `Lint: ${toPosix(broken)} does not parse. The layout rules read the v15 aliases until it does.`
  };
}

/**
 * The file an import names: a relative specifier joined to the folder of the file, an alias to its
 * first target.
 *
 * @param layout - The layout of the importing file.
 * @param specifier - The module specifier as written.
 * @returns The absolute target, or undefined for a package.
 */
function targetOf(layout: Layout, specifier: string): string | undefined {
  if (RELATIVE.test(specifier)) return path.resolve(layout.folder, specifier);

  return targetsFor(layout.patterns, specifier)[0];
}

/**
 * Build a layout rule: it reads where the layers sit and the aliases, then judges each import,
 * export-from and `import()`, type-only statements too. The rule keeps the tsconfig it read for
 * the files of one lint run; the stamps of the configs keep the copy fresh.
 *
 * @param description - What the rule enforces.
 * @param defaults - The rule's default globs.
 * @param judge - The message for one import, or undefined when it passes.
 * @returns The rule.
 */
function layoutRule(
  description: string,
  defaults: Scope,
  judge: (layout: Layout, specifier: string) => string | undefined
): GameLintRule {
  const reads = new Map<string, TsconfigRead>();

  return {
    meta: { type: "problem", docs: { description }, schema: LAYOUT_SCHEMA },
    /**
     * Visit the file when the rule's globs match it.
     *
     * @param context - The rule context.
     * @returns The node visitors, none for a file out of scope.
     */
    create(context) {
      if (!inScope(context, defaults)) return {};

      const layout = layoutOf(context, reads);
      const check = (node: GameLintNode): void => {
        const specifier = specifierOf(node);
        const message = specifier === undefined ? undefined : judge(layout, specifier);

        if (message !== undefined) context.report({ node, message });
      };

      return {
        Program: node => {
          if (layout.problem !== undefined) context.report({ node, message: layout.problem });
        },
        ImportDeclaration: check,
        ExportAllDeclaration: check,
        ExportNamedDeclaration: check,
        ImportExpression: check
      };
    }
  };
}

/**
 * What rules-siblings says about one import of a rule: a sibling, `@core/types` and
 * `@shared/rules` pass, by alias or by relative path.
 *
 * @param layout - The layout of the rule's file.
 * @param specifier - The module specifier as written.
 * @returns The report, or undefined when the import passes.
 */
function siblingMessage(layout: Layout, specifier: string): string | undefined {
  if (specifier.startsWith("./") || RULE_ALIASES.test(specifier)) return undefined;

  const target = targetOf(layout, specifier);
  const relative = target === undefined ? undefined : insideOf(layout.root, target);
  const isAllowed = RULE_IMPORTS.some(pattern => pattern.test(relative ?? ""));

  return isAllowed ? undefined : SIBLINGS_MESSAGE;
}

/**
 * What layer-imports says about one import: a layer imports the layers below it only.
 *
 * @param layout - The layout of the importing file.
 * @param specifier - The module specifier as written.
 * @returns The report, or undefined when the import passes.
 */
function layerMessage(layout: Layout, specifier: string): string | undefined {
  const reach = LAYER_REACH[layout.importer.layer];
  const target = targetOf(layout, specifier);

  if (reach === undefined || target === undefined) return undefined;

  const { layer } = placeOf(layout.root, target);

  if (layer === "other" || reach.includes(layer)) return undefined;

  const name = layer === "game" ? "game.ts" : layer;

  return `Layers: ${layout.importer.layer} does not import ${name}. ${LAYER_ORDER}`;
}

/**
 * What feature-door says about an import that goes deep into another feature or plugin.
 *
 * @param importer - Where the importing file lies.
 * @param place - Where the import lands.
 * @returns The report, or undefined when the import lands on a door or in no unit of another.
 * @example
 * ```ts
 * deepMessage({ layer: "features", unit: "features/home", door: false }, { layer: "features", unit: "features/orders", door: false });
 * // "Door: another feature is imported from its index.ts only: @features/orders."
 * ```
 */
function deepMessage(importer: Place, place: Place): string | undefined {
  const isUnit = place.layer === "features" || place.layer === "plugins";

  if (!isUnit || place.door || place.unit === importer.unit) return undefined;

  const kind = place.layer === "features" ? "feature" : "plugin";

  return `Door: another ${kind} is imported from its index.ts only: @${place.unit}.`;
}

/**
 * What feature-door says about a unit that imports its own door.
 *
 * @param importer - Where the importing file lies.
 * @returns The report.
 * @example
 * ```ts
 * ownDoorMessage({ layer: "shared", unit: "shared", door: false });
 * // "Door: shared does not import its own index.ts. Import the file: ./flow/merge."
 * ```
 */
function ownDoorMessage(importer: Place): string {
  const nouns: Partial<Record<Layer, string>> = { features: "a feature", plugins: "a plugin" };
  const noun = nouns[importer.layer] ?? importer.layer;

  return `Door: ${noun} does not import its own index.ts. Import the file: ./flow/merge.`;
}

/**
 * What feature-door says about a relative import that leaves its unit.
 *
 * @param importer - Where the importing file lies.
 * @returns The report.
 * @example
 * ```ts
 * escapeMessage({ layer: "features", unit: "features/orders", door: false });
 * // "Door: an import that leaves features/orders is written as an alias: @features/<f>, @shared, @core/<file>."
 * ```
 */
function escapeMessage(importer: Place): string {
  return `Door: an import that leaves ${importer.unit ?? importer.layer} is written as an alias: @features/<f>, @shared, @core/<file>.`;
}

/**
 * What feature-door says about an import of shared, a feature, a plugin or a barrel that lands in
 * the layout outside the barrels.
 *
 * @param importer - Where the importing file lies.
 * @param place - Where the import lands.
 * @param isRelative - True for a relative specifier.
 * @returns The report, or undefined when the import passes.
 * @example
 * ```ts
 * unitDoorMessage({ layer: "features", unit: "features", door: true }, { layer: "features", unit: "features/home", door: true }, true); // undefined
 * ```
 */
function unitDoorMessage(importer: Place, place: Place, isRelative: boolean): string | undefined {
  const deep = deepMessage(importer, place);

  if (deep !== undefined) return deep;
  if (place.unit === importer.unit) {
    return place.door && !importer.door ? ownDoorMessage(importer) : undefined;
  }

  // The barrel reaches the doors of its own layer by relative path.
  const staysInBarrel = isBarrel(importer) && place.layer === importer.layer;

  return isRelative && !staysInBarrel ? escapeMessage(importer) : undefined;
}

/**
 * What feature-door says about one import of a unit: the barrels belong to game.ts, a unit does
 * not import its own door, another feature is reached through its door, and an import that
 * leaves the unit is written as an alias.
 *
 * @param layout - The layout of the importing file.
 * @param specifier - The module specifier as written.
 * @returns The report, or undefined when the import passes.
 */
function doorMessage(layout: Layout, specifier: string): string | undefined {
  const { importer } = layout;
  const target = targetOf(layout, specifier);

  if (importer.unit === undefined || target === undefined) return undefined;

  const place = placeOf(layout.root, target);
  const isRelative = RELATIVE.test(specifier);

  if (place.layer === "other") return undefined;
  if (isBarrel(place)) return place.unit === importer.unit ? undefined : BARREL_MESSAGE;
  if (importer.layer === "core") {
    return isRelative && place.layer !== "core" ? escapeMessage(importer) : undefined;
  }

  return unitDoorMessage(importer, place, isRelative);
}

/** L4: a rule imports only its siblings, the types of core and the rules of shared. */
const rulesSiblings = layoutRule(
  "A file under rules/ imports only its siblings, @core/types and @shared/rules.",
  { files: ["**/rules/**"], ignores: TESTS },
  siblingMessage
);

/** Layers: core ← shared ← features ← game.ts; plugins import core and shared. */
const layerImports = layoutRule(
  "A layer imports only the layers below it: core ← shared ← features ← game.ts; plugins import core and shared.",
  { files: ["**"], ignores: [...TESTS, "**/generated/**"] },
  layerMessage
);

/** Doors: a feature is imported from its index.ts, and the barrels only by game.ts. */
const featureDoor = layoutRule(
  "A feature is imported from its index.ts; the barrels only by game.ts; an import that leaves a feature is an alias.",
  { files: ["**/{core,shared,features,plugins}/**"], ignores: TESTS },
  doorMessage
);

/**
 * The key of a suffix table as a folder: with a trailing `/`.
 *
 * @param key - A key of the table.
 * @returns The folder.
 * @example
 * ```ts
 * folderOf("tests/e2e"); // "tests/e2e/"
 * ```
 */
function folderOf(key: string): string {
  return key.endsWith("/") ? key : `${key}/`;
}

/**
 * The kind folder of the table that holds a folder: the nearest one, then the longest key. A key
 * that names a test root itself holds only the files directly inside.
 *
 * @param folder - The folder of the file, as `/a/b/`.
 * @param table - Kind folder to suffix.
 * @returns The kind, or undefined for a folder no key holds.
 * @example
 * ```ts
 * kindOf("/features/home/__tests__/unit/", { "__tests__/unit/": ".test.ts" })?.suffix; // ".test.ts"
 * ```
 */
function kindOf(folder: string, table: Readonly<Record<string, string>>): Kind | undefined {
  let best: Kind | undefined;

  for (const [key, suffix] of Object.entries(table)) {
    const kind = folderOf(key);
    const at = folder.lastIndexOf(`/${kind}`);
    const end = at + kind.length + 1;
    const holds = at !== -1 && (end === folder.length || !TEST_ROOT_KEY.test(kind));
    const isBetter =
      best === undefined ||
      end > best.end ||
      (end === best.end && kind.length > best.folder.length);

    if (holds && isBetter) best = { folder: kind, suffix, end };
  }

  return best;
}

/**
 * Whether a test file is a helper: it lies in `helpers/`, `fixtures/` or `baselines/` somewhere
 * below its test root.
 *
 * @param folders - The folders of the file, from the game root.
 * @returns True for a helper, and for a file outside every test root.
 * @example
 * ```ts
 * isHelper(["tests", "visual", "baselines", "home"]); // true
 * ```
 */
function isHelper(folders: readonly string[]): boolean {
  const first = folders.findIndex(folder => TEST_ROOT.test(folder));

  return first === -1 || folders.slice(first + 1).some(folder => HELPER_FOLDER.test(folder));
}

/**
 * What test-suffix says about a file: a file in a test kind folder ends with that folder's suffix.
 *
 * @param file - The file, relative to the game root.
 * @param table - Kind folder to suffix.
 * @returns The report, or undefined for a file that passes or is not checked.
 * @example
 * ```ts
 * suffixMessage("tests/e2e/board.test.ts", { "tests/e2e/": ".e2e.ts" });
 * // "Tests: a file in tests/e2e/ ends with .e2e.ts. Rename board.test.ts to board.e2e.ts, or move a helper to tests/helpers/."
 * ```
 */
function suffixMessage(file: string, table: Readonly<Record<string, string>>): string | undefined {
  const name = path.posix.basename(file);
  const extension = SCRIPT.exec(name)?.[0];
  const folder = path.posix.dirname(file);
  const kind = isHelper(folder.split("/")) ? undefined : kindOf(`/${folder}/`, table);

  if (extension === undefined || kind === undefined) return undefined;

  const suffix =
    extension === ".tsx" && kind.suffix.endsWith(".ts") ? `${kind.suffix}x` : kind.suffix;

  if (name.endsWith(suffix)) return undefined;

  const renamed = `${name.slice(0, -extension.length).replace(TEST_WORD, "")}${suffix}`;
  const helpers = kind.folder.includes("__tests__") ? "__tests__/fixtures/" : "tests/helpers/";

  return `Tests: a file in ${kind.folder} ends with ${suffix}. Rename ${name} to ${renamed}, or move a helper to ${helpers}.`;
}

/** Tests: a file in a test kind folder ends with the folder's suffix. */
const testSuffix: GameLintRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A file in a test kind folder ends with its suffix: .e2e.ts, .visual.ts, .editor.ts, .test.ts, .isolated.ts."
    },
    schema: SUFFIX_SCHEMA
  },
  /**
   * Visit the file when the rule's globs match it and its name misses the suffix.
   *
   * @param context - The rule context.
   * @returns The node visitors, none for a file out of scope or named right.
   */
  create(context) {
    if (!inScope(context, { files: TEST_FOLDERS, ignores: [] })) return {};

    const [given] = context.options as [GameLintSuffixOptions?];
    const root = path.resolve(context.cwd, given?.root ?? ".");
    const file = insideOf(root, path.resolve(context.cwd, context.filename));
    const message =
      file === undefined ? undefined : suffixMessage(file, given?.suffixes ?? TEST_SUFFIXES);

    if (message === undefined) return {};

    return { Program: node => context.report({ node, message }) };
  }
};

/**
 * The `moku-game` oxlint plugin. A game loads it by package name and turns its rules on.
 *
 * @example
 * ```json
 * { "jsPlugins": ["@moku-labs/game/lint"], "rules": { "moku-game/lazy-imports": "error" } }
 * ```
 */
const plugin: GameLintPlugin = {
  meta: { name: "moku-game" },
  rules: {
    "lazy-imports": lazyImports,
    "native-imports": nativeImports,
    "dev-imports": developmentImports,
    "no-module-state": noModuleState,
    determinism,
    "rules-siblings": rulesSiblings,
    "static-keys": staticKeys,
    "layer-imports": layerImports,
    "feature-door": featureDoor,
    "test-suffix": testSuffix
  }
};

export default plugin;
