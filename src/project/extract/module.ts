/**
 * @file project, extract — the module facts of one file: what it imports, what it exports and
 * from where, what it declares at the top, and, for the kit, which definers the `defineGame`
 * destructure hands out under which local names. The facts of every file together let a name be
 * followed from the file that uses it to the file that declares it, without the parse trees.
 */
import type ts from "typescript";
import type { TypeScript } from "../typescript";

/** The package a game imports the engine from. */
export const GAME_PACKAGE = "@moku-labs/game";

/** The definers whose calls make keys. */
export const DEFINERS = [
  "defineFlow",
  "defineFeature",
  "defineScene",
  "projection",
  "defineEmitter",
  "defineTextStyles",
  "defineStyle",
  "defineComponent"
] as const;

/** One definer whose calls make keys. */
export type Definer = (typeof DEFINERS)[number];

/** A value import: the module and the name taken from it, `default` or `*` for a namespace. */
export type ImportReference = { readonly specifier: string; readonly imported: string };

/** Where an export comes from: a binding of the file, or a name of another module. */
export type ExportReference = { readonly local: string } | ImportReference;

/** The module facts of one file. */
export type ModuleFacts = {
  /** Local name to the value import that brings it. */
  readonly imports: ReadonlyMap<string, ImportReference>;
  /** Exported name to where it comes from. */
  readonly exports: ReadonlyMap<string, ExportReference>;
  /** The modules of `export * from`. */
  readonly stars: readonly string[];
  /** The names declared at the top of the file. */
  readonly declared: ReadonlySet<string>;
  /** In the kit: local name to the definer the `defineGame` destructure hands out. */
  readonly kit: ReadonlyMap<string, Definer>;
};

/** The facts while they are collected. */
type Draft = {
  imports: Map<string, ImportReference>;
  exports: Map<string, ExportReference>;
  stars: string[];
  declared: Set<string>;
  kit: Map<string, Definer>;
};

/**
 * Whether a name is a definer whose calls make keys.
 *
 * @param name - A name.
 * @returns True for the definers of `DEFINERS`.
 * @example
 * ```ts
 * isDefiner("defineScene"); // true
 * ```
 */
export function isDefiner(name: string): name is Definer {
  return (DEFINERS as readonly string[]).includes(name);
}

/**
 * Whether a statement carries a modifier.
 *
 * @param typescript - The TypeScript module.
 * @param node - The statement.
 * @param kind - `ExportKeyword` or `DefaultKeyword`.
 * @returns True when the modifier is there.
 */
function hasModifier(typescript: TypeScript, node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!typescript.canHaveModifiers(node)) return false;

  return typescript.getModifiers(node)?.some(modifier => modifier.kind === kind) ?? false;
}

/**
 * The names a binding declares: the identifier, or every name of a destructure.
 *
 * @param typescript - The TypeScript module.
 * @param name - The binding name.
 * @returns The declared names.
 */
function namesOf(typescript: TypeScript, name: ts.BindingName): string[] {
  if (typescript.isIdentifier(name)) return [name.text];

  return name.elements.flatMap(element =>
    typescript.isBindingElement(element) ? namesOf(typescript, element.name) : []
  );
}

/**
 * Records the value imports of one import statement.
 *
 * @param typescript - The TypeScript module.
 * @param statement - The import statement.
 * @param draft - The facts so far.
 */
function readImport(typescript: TypeScript, statement: ts.ImportDeclaration, draft: Draft): void {
  const clause = statement.importClause;

  if (clause === undefined || clause.isTypeOnly) return;
  if (!typescript.isStringLiteral(statement.moduleSpecifier)) return;

  const specifier = statement.moduleSpecifier.text;
  const bindings = clause.namedBindings;

  if (clause.name !== undefined)
    draft.imports.set(clause.name.text, { specifier, imported: "default" });
  if (bindings === undefined) return;

  if (typescript.isNamespaceImport(bindings)) {
    draft.imports.set(bindings.name.text, { specifier, imported: "*" });
    return;
  }

  for (const element of bindings.elements) {
    if (element.isTypeOnly) continue;

    const imported = element.propertyName?.text ?? element.name.text;

    draft.imports.set(element.name.text, { specifier, imported });
  }
}

/**
 * Records one export statement: a re-export from another module, a star, or a list of local
 * bindings.
 *
 * @param typescript - The TypeScript module.
 * @param statement - The export statement.
 * @param draft - The facts so far.
 */
function readExport(typescript: TypeScript, statement: ts.ExportDeclaration, draft: Draft): void {
  const source = statement.moduleSpecifier;
  const specifier = source !== undefined && typescript.isStringLiteral(source) ? source.text : "";
  const clause = statement.exportClause;

  if (statement.isTypeOnly) return;

  if (clause === undefined) {
    if (specifier !== "") draft.stars.push(specifier);
    return;
  }

  if (typescript.isNamespaceExport(clause)) {
    draft.exports.set(clause.name.text, { specifier, imported: "*" });
    return;
  }

  for (const element of clause.elements) {
    if (element.isTypeOnly) continue;

    const inner = element.propertyName?.text ?? element.name.text;
    const target: ExportReference =
      specifier === "" ? { local: inner } : { specifier, imported: inner };

    draft.exports.set(element.name.text, target);
  }
}

/**
 * Whether an import brings a name of the engine package.
 *
 * @param ref - The import, if any.
 * @param name - The name taken from the package, `*` for a namespace.
 * @returns True for that import of `@moku-labs/game`.
 * @example
 * ```ts
 * isGameImport({ specifier: "@moku-labs/game", imported: "defineGame" }, "defineGame"); // true
 * ```
 */
function isGameImport(ref: ImportReference | undefined, name: string): boolean {
  return ref?.specifier === GAME_PACKAGE && ref.imported === name;
}

/**
 * Whether an expression calls `defineGame` of the engine: by a named import, renamed or not, or
 * through a namespace import of the package.
 *
 * @param typescript - The TypeScript module.
 * @param expression - The initializer of a destructure.
 * @param imports - The value imports of the file.
 * @returns True for the kit call.
 */
function callsDefineGame(
  typescript: TypeScript,
  expression: ts.Expression | undefined,
  imports: ReadonlyMap<string, ImportReference>
): boolean {
  if (expression === undefined || !typescript.isCallExpression(expression)) return false;

  const callee = expression.expression;

  if (typescript.isIdentifier(callee)) return isGameImport(imports.get(callee.text), "defineGame");

  const isNamespaceCall =
    typescript.isPropertyAccessExpression(callee) &&
    typescript.isIdentifier(callee.expression) &&
    callee.name.text === "defineGame";

  return isNamespaceCall && isGameImport(imports.get(callee.expression.text), "*");
}

/**
 * Records the definers a `defineGame` destructure hands out, under their local names.
 *
 * @param typescript - The TypeScript module.
 * @param pattern - The destructure.
 * @param draft - The facts so far.
 */
function readKit(typescript: TypeScript, pattern: ts.ObjectBindingPattern, draft: Draft): void {
  for (const element of pattern.elements) {
    if (!typescript.isIdentifier(element.name)) continue;

    const property = element.propertyName;
    const handed =
      property !== undefined && typescript.isIdentifier(property)
        ? property.text
        : element.name.text;

    if (isDefiner(handed)) draft.kit.set(element.name.text, handed);
  }
}

/**
 * Records one top-level variable statement: its names, its exports and a kit destructure.
 *
 * @param typescript - The TypeScript module.
 * @param statement - The statement.
 * @param draft - The facts so far.
 */
function readVariables(
  typescript: TypeScript,
  statement: ts.VariableStatement,
  draft: Draft
): void {
  const exported = hasModifier(typescript, statement, typescript.SyntaxKind.ExportKeyword);

  for (const declaration of statement.declarationList.declarations) {
    for (const name of namesOf(typescript, declaration.name)) {
      draft.declared.add(name);
      if (exported) draft.exports.set(name, { local: name });
    }

    // The kit: `export const { defineFlow, … } = defineGame<…>()`.
    const pattern = declaration.name;
    const isKit =
      typescript.isObjectBindingPattern(pattern) &&
      callsDefineGame(typescript, declaration.initializer, draft.imports);

    if (isKit) readKit(typescript, pattern, draft);
  }
}

/**
 * Records a top-level function or class: its name, and its export.
 *
 * @param typescript - The TypeScript module.
 * @param statement - The declaration.
 * @param draft - The facts so far.
 */
function readNamed(
  typescript: TypeScript,
  statement: ts.FunctionDeclaration | ts.ClassDeclaration,
  draft: Draft
): void {
  const name = statement.name?.text;

  if (name === undefined) return;

  draft.declared.add(name);
  if (!hasModifier(typescript, statement, typescript.SyntaxKind.ExportKeyword)) return;

  const isDefault = hasModifier(typescript, statement, typescript.SyntaxKind.DefaultKeyword);

  draft.exports.set(isDefault ? "default" : name, { local: name });
}

/**
 * Reads the module facts of one parsed file. Imports come first, so a kit destructure anywhere
 * in the file knows where its `defineGame` comes from.
 *
 * @param typescript - The TypeScript module.
 * @param source - The parsed file.
 * @returns The facts.
 */
export function readModule(typescript: TypeScript, source: ts.SourceFile): ModuleFacts {
  const draft: Draft = {
    imports: new Map(),
    exports: new Map(),
    stars: [],
    declared: new Set(),
    kit: new Map()
  };

  for (const statement of source.statements) {
    if (typescript.isImportDeclaration(statement)) readImport(typescript, statement, draft);
  }

  for (const statement of source.statements) {
    if (typescript.isVariableStatement(statement)) readVariables(typescript, statement, draft);
    if (typescript.isFunctionDeclaration(statement) || typescript.isClassDeclaration(statement)) {
      readNamed(typescript, statement, draft);
    }
    if (typescript.isExportDeclaration(statement)) readExport(typescript, statement, draft);

    const exportsIdentifier =
      typescript.isExportAssignment(statement) && typescript.isIdentifier(statement.expression);

    if (exportsIdentifier) draft.exports.set("default", { local: statement.expression.text });
  }

  return draft;
}
