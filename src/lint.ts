/**
 * @file The lint door of the engine (subpath `./lint`): an oxlint JS plugin named `moku-game` with
 * the rules a game carries. A game loads it by package name in `.oxlintrc.json`
 * (`"jsPlugins": ["@moku-labs/game/lint"]`) and turns the rules on as `moku-game/<rule>`. The rules
 * use the ESLint rule API, so ESLint 9 loads the same object. Every rule takes
 * `[{ files, ignores }]`: globs relative to the directory oxlint runs in; a key given replaces the
 * default. Only `node:path` is imported; the file is erasable TypeScript, so Node loads it unbuilt.
 */
import path from "node:path";

/** The options every rule takes: which files it checks. A key given replaces the rule's default. */
export type GameLintOptions = {
  /** Globs of the files the rule checks, relative to the directory oxlint runs in. */
  files?: string[];
  /** Globs of the files the rule skips, even when `files` matches them. */
  ignores?: string[];
};

/** The part of an ESTree node the rules read. oxlint and ESLint hand over full nodes. */
export type GameLintNode = {
  readonly type: string;
  readonly name?: string;
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
};

/** The part of the rule context the rules read: where the file is, the options, the report. */
export type GameLintContext = {
  readonly cwd: string;
  readonly filename: string;
  readonly options: readonly unknown[];
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

/** The plugin object: `moku-game` and its six rules. */
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
  | "rules-siblings";

/** A rule's default globs. */
type Scope = { readonly files: readonly string[]; readonly ignores: readonly string[] };

/** One forbidden specifier pattern of an import rule and what to say. */
type ImportCheck = { readonly pattern: RegExp; readonly message: string };

/** Tests and test helpers: no rule checks them by default. */
const TESTS = ["tests/**", "**/__tests__/**", "**/*.{test,spec}.{ts,tsx}"];

/** Dev modules: a `.dev` module is wired into the editor only. */
const DEV_MODULES = ["**/*.dev.{ts,tsx}"];

/** The logic of a game: state, tables, nodes, flows, rules, features. `**` so `src/` matches too. */
const LOGIC = ["**/state.ts", "**/tables.ts", "**/{nodes,flows,rules,features}/**"];

/** The options schema every rule shares; oxlint refuses options a rule has no schema for. */
const SCHEMA = [
  {
    type: "object",
    properties: {
      files: { type: "array", items: { type: "string" } },
      ignores: { type: "array", items: { type: "string" } }
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
  const file = path.relative(context.cwd, context.filename).split(path.sep).join("/");

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
 * The name of a member's property: `a.b` and `a["b"]`.
 *
 * @param node - A MemberExpression.
 * @returns The property name, or undefined for a computed non-literal key.
 */
function propertyName(node: GameLintNode): string | undefined {
  const key = node.property;

  if (key === undefined) return undefined;
  if (!node.computed) return key.name;

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
    const isCollection = init?.type === "NewExpression" && COLLECTION.test(init.callee?.name ?? "");

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
  if (callee?.type === "Identifier") return TIMER.test(callee.name ?? "");
  if (callee?.type !== "MemberExpression") return false;

  return GLOBAL_OBJECT.test(callee.object?.name ?? "") && TIMER.test(propertyName(callee) ?? "");
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
  { files: [...LOGIC, "**/kit.ts", "**/game.ts"], ignores: [...DEV_MODULES, ...TESTS] },
  [
    {
      pattern: /^(?:@moku-labs\/(?:system|native)(?:\/|$)|@tauri-apps\/)/,
      message:
        "L13: only platform-bridge.ts, native.ts and web/ import a native package. Pass a PlatformProvider."
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
        "Dev only: web/main.ts, web/dev*.ts, web/editor*.ts, .dev modules and tests import the editor and /control."
    }
  ]
);

/** L4: a rule imports only its siblings. */
const rulesSiblings = importRule(
  "A file under rules/ imports only its siblings.",
  { files: ["**/rules/**"], ignores: TESTS },
  [
    {
      pattern: /^(?!\.\/)/,
      message: "L4: a rule imports only its siblings in rules/: (state, input, tables) => result."
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

/** L3: no device clock, no timers, no unseeded randomness in the logic. */
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
    if (!inScope(context, { files: LOGIC, ignores: [...DEV_MODULES, ...TESTS] })) return {};

    return {
      MemberExpression: node => {
        const property = propertyName(node);
        const read = CLOCK_READS.find(
          item => item.object === node.object?.name && item.property === property
        );

        if (read !== undefined) context.report({ node, message: read.message });
      },
      NewExpression: node => {
        if (node.callee?.name === "Date" && (node.arguments ?? []).length === 0) {
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
    "rules-siblings": rulesSiblings
  }
};

export default plugin;
