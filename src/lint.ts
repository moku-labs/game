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

/** The plugin object: `moku-game` and its seven rules. */
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
  | "static-keys";

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
    "static-keys": staticKeys
  }
};

export default plugin;
