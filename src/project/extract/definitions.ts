/**
 * @file project, extract — the keys one file defines. A call is a definition when its callee is a
 * definer binding of the file (`definersOf`): `defineFlow("board", …)` makes `flow:board`, and its
 * `nodes` table is kept for the cross-file pass that makes the `node:` keys; `defineFeature`,
 * `defineScene`, `defineEmitter`, `projection`, `defineTextStyles`, `defineStyle` and
 * `defineComponent` make their own keys. A definer whose id is not a literal goes to `unresolved`
 * with the reason; nothing is guessed. The plain components and the JSX keys of the file join the
 * same lists, and the component names the file renders are kept for their `uses`.
 */
import type ts from "typescript";
import type { Anchor } from "../types";
import type { TypeScript } from "../typescript";
import { readComponents, renderedOf } from "./components";
import { anchorOfHit, collectJsx, isOpaque, opaqueReason } from "./jsx";
import type { Definer } from "./module";
import { enclosingName, meaningOf, unwrap } from "./scope";

/** One key a file defines, and where. */
export type Definition = { readonly key: string; readonly anchor: Anchor };

/** One entry of a flow's `nodes` table: its name, and the name its value is, if a plain name. */
export type TableEntry = { readonly name: string; readonly ref?: string };

/** The `nodes` table of one flow, resolved across files later. */
export type NodeTable = {
  /** The flow id. */
  readonly flow: string;
  /** The const the flow is bound to. */
  readonly binding?: string;
  readonly entries: readonly TableEntry[];
};

/** Something a file holds that cannot be read without running it. */
export type Unresolved = { readonly path: string; readonly reason: string };

/** What one file defines. */
export type Extracted = {
  readonly definitions: readonly Definition[];
  readonly tables: readonly NodeTable[];
  readonly unresolved: readonly Unresolved[];
  /** The component names the file renders, sorted: `RoundButton` for `<RoundButton>` and `<ui.RoundButton>`. */
  readonly rendered: readonly string[];
};

/** The key prefix of each definer that takes its id as the first argument. */
const ID_PREFIXES: Partial<Record<Definer, string>> = {
  defineFlow: "flow",
  defineFeature: "feature",
  defineScene: "scene",
  defineEmitter: "emitter",
  defineComponent: "component"
};

/** One file being read: the module, its path, its definers and the lists being filled. */
type Reading = {
  readonly typescript: TypeScript;
  readonly path: string;
  readonly definers: ReadonlyMap<string, Definer>;
  readonly definitions: Definition[];
  readonly tables: NodeTable[];
  readonly unresolved: Unresolved[];
};

/**
 * The text of a string literal or a template without holes.
 *
 * @param typescript - The TypeScript module.
 * @param node - An expression, if any.
 * @returns The text, or `undefined` for anything else.
 */
function literalOf(typescript: TypeScript, node: ts.Expression | undefined): string | undefined {
  const inner = node === undefined ? undefined : unwrap(typescript, node);

  return inner !== undefined && typescript.isStringLiteralLike(inner) ? inner.text : undefined;
}

/**
 * The name of an object property when it is written literally.
 *
 * @param typescript - The TypeScript module.
 * @param property - The property.
 * @returns The name, or `undefined` for a spread or a computed name.
 */
function propertyName(
  typescript: TypeScript,
  property: ts.ObjectLiteralElementLike
): string | undefined {
  const name = property.name;

  if (name === undefined) return undefined;

  const isLiteral =
    typescript.isIdentifier(name) ||
    typescript.isStringLiteral(name) ||
    typescript.isNumericLiteral(name);

  return isLiteral ? name.text : undefined;
}

/**
 * The value of a named property of an object literal; for a shorthand, the name itself.
 *
 * @param typescript - The TypeScript module.
 * @param object - The object literal.
 * @param name - The property name.
 * @returns The value, or `undefined` when the object has no such property.
 */
function propertyValue(
  typescript: TypeScript,
  object: ts.ObjectLiteralExpression,
  name: string
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (propertyName(typescript, property) !== name) continue;
    if (typescript.isPropertyAssignment(property)) return property.initializer;
    if (typescript.isShorthandPropertyAssignment(property)) return property.name;
  }

  return undefined;
}

/**
 * The object literal an expression is, directly or through a same-file const.
 *
 * @param typescript - The TypeScript module.
 * @param node - An expression, if any.
 * @returns The object literal, or `undefined`.
 */
function objectOf(
  typescript: TypeScript,
  node: ts.Expression | undefined
): ts.ObjectLiteralExpression | undefined {
  const inner = node === undefined ? undefined : unwrap(typescript, node);

  if (inner === undefined) return undefined;
  if (typescript.isObjectLiteralExpression(inner)) return inner;
  if (!typescript.isIdentifier(inner)) return undefined;

  const meaning = meaningOf(typescript, inner);
  const value = meaning?.kind === "const" ? unwrap(typescript, meaning.initializer) : undefined;

  return value !== undefined && typescript.isObjectLiteralExpression(value) ? value : undefined;
}

/**
 * The const a call is bound to: `export const boardFlow = defineFlow(…)` at the top of the file.
 *
 * @param typescript - The TypeScript module.
 * @param call - The definer call.
 * @returns The binding, or `undefined` when the call is not the initializer of a module const.
 */
function bindingOf(typescript: TypeScript, call: ts.CallExpression): string | undefined {
  let node: ts.Node = call.parent;

  // Up out of the expression the call sits in; the call must be the whole initializer there.
  while (typescript.isExpression(node)) node = node.parent;

  if (!typescript.isVariableDeclaration(node) || !typescript.isIdentifier(node.name))
    return undefined;
  if (node.initializer === undefined || unwrap(typescript, node.initializer) !== call)
    return undefined;

  const list = node.parent;
  const isModuleConst =
    (list.flags & typescript.NodeFlags.Const) !== 0 &&
    typescript.isVariableStatement(list.parent) &&
    typescript.isSourceFile(list.parent.parent);

  return isModuleConst ? node.name.text : undefined;
}

/**
 * The definer a call calls, by its callee as written: `defineFlow(…)` or `kit.defineFlow(…)`.
 *
 * @param typescript - The TypeScript module.
 * @param call - The call.
 * @param definers - The definers of the file.
 * @returns The definer, or `undefined` for any other call.
 */
function definerOfCall(
  typescript: TypeScript,
  call: ts.CallExpression,
  definers: ReadonlyMap<string, Definer>
): Definer | undefined {
  const callee = call.expression;

  if (typescript.isIdentifier(callee)) return definers.get(callee.text);
  if (
    !typescript.isPropertyAccessExpression(callee) ||
    !typescript.isIdentifier(callee.expression)
  ) {
    return undefined;
  }

  return definers.get(`${callee.expression.text}.${callee.name.text}`);
}

/**
 * Adds a key bound to the const of a call, or anchored by its id when the call has no const.
 *
 * @param reading - The file being read.
 * @param call - The definer call.
 * @param key - The key.
 * @param id - The literal id, the anchor key when there is no binding.
 * @param bound - What the anchor adds to the binding: the `name` key of a projection.
 */
function define(
  reading: Reading,
  call: ts.CallExpression,
  key: string,
  id: string,
  bound: Partial<Anchor> = {}
): void {
  const binding = bindingOf(reading.typescript, call);
  const anchor: Anchor =
    binding === undefined
      ? { path: reading.path, key: id }
      : { path: reading.path, binding, ...bound };

  reading.definitions.push({ key, anchor });
}

/**
 * Notes something the file holds that cannot be read.
 *
 * @param reading - The file being read.
 * @param reason - What and why.
 */
function unresolve(reading: Reading, reason: string): void {
  reading.unresolved.push({ path: reading.path, reason });
}

/**
 * The plain name a table entry's value is: `merge` for `{ merge }` and for `{ merge: merge }`.
 *
 * @param typescript - The TypeScript module.
 * @param property - The table entry.
 * @returns The name, or `undefined` for a slot, an inline node or anything else.
 */
function refOf(typescript: TypeScript, property: ts.ObjectLiteralElementLike): string | undefined {
  if (typescript.isShorthandPropertyAssignment(property)) return property.name.text;
  if (!typescript.isPropertyAssignment(property)) return undefined;

  const value = unwrap(typescript, property.initializer);

  return typescript.isIdentifier(value) ? value.text : undefined;
}

/**
 * Reads the `nodes` table of a flow into its entries.
 *
 * @param reading - The file being read.
 * @param call - The `defineFlow` call.
 * @param flow - The flow id.
 */
function readTable(reading: Reading, call: ts.CallExpression, flow: string): void {
  const { typescript } = reading;
  const spec = objectOf(typescript, call.arguments[1]);
  const nodes =
    spec === undefined ? undefined : objectOf(typescript, propertyValue(typescript, spec, "nodes"));

  if (nodes === undefined) {
    unresolve(reading, `defineFlow "${flow}" nodes is not an object literal`);
    return;
  }

  const entries: TableEntry[] = [];

  for (const property of nodes.properties) {
    if (typescript.isSpreadAssignment(property)) {
      unresolve(reading, `defineFlow "${flow}" nodes has a spread`);
      continue;
    }

    const name = propertyName(typescript, property);

    if (name === undefined) {
      unresolve(reading, `defineFlow "${flow}" node name is not a literal`);
      continue;
    }

    // A plain name is followed to its declaration later; a slot or an inline node stays here.
    const ref = refOf(typescript, property);

    entries.push(ref === undefined ? { name } : { name, ref });
  }

  const binding = bindingOf(typescript, call);

  reading.tables.push(binding === undefined ? { flow, entries } : { flow, binding, entries });
}

/**
 * Reads a definer that takes its id as the first argument; a flow also brings its table. A
 * component is bound to its const, and the key takes the literal id.
 *
 * @param reading - The file being read.
 * @param call - The call.
 * @param definer - The definer.
 * @param prefix - The key prefix.
 */
function readIdCall(
  reading: Reading,
  call: ts.CallExpression,
  definer: Definer,
  prefix: string
): void {
  const id = literalOf(reading.typescript, call.arguments[0]);

  if (id === undefined) {
    unresolve(reading, `${definer} id is not a string literal`);
    return;
  }

  define(reading, call, `${prefix}:${id}`, id);
  if (definer === "defineFlow") readTable(reading, call, id);
}

/**
 * Reads a projection: its key is its `name`, its line the `name` property.
 *
 * @param reading - The file being read.
 * @param call - The call.
 */
function readProjection(reading: Reading, call: ts.CallExpression): void {
  const { typescript } = reading;
  const spec = objectOf(typescript, call.arguments[0]);
  const name =
    spec === undefined ? undefined : literalOf(typescript, propertyValue(typescript, spec, "name"));

  if (name === undefined) {
    unresolve(reading, "projection name is not a string literal");
    return;
  }

  define(reading, call, `projection:${name}`, name, { key: "name" });
}

/**
 * Reads a text style table: every literal key is a key.
 *
 * @param reading - The file being read.
 * @param call - The call.
 */
function readTextStyles(reading: Reading, call: ts.CallExpression): void {
  const { typescript } = reading;
  const table = call.arguments[0] === undefined ? undefined : unwrap(typescript, call.arguments[0]);

  if (table === undefined || !typescript.isObjectLiteralExpression(table)) {
    unresolve(reading, "defineTextStyles argument is not an object literal");
    return;
  }

  const binding = bindingOf(typescript, call);

  for (const property of table.properties) {
    const key = propertyName(typescript, property);

    if (key === undefined) {
      unresolve(reading, "defineTextStyles key is not a literal");
      continue;
    }

    const anchor: Anchor =
      binding === undefined ? { path: reading.path, key } : { path: reading.path, binding, key };

    reading.definitions.push({ key: `textStyle:${key}`, anchor });
  }
}

/**
 * Reads a style: only one bound to a module const has a key, `style:<path>#<binding>`.
 *
 * @param reading - The file being read.
 * @param call - The call.
 */
function readStyle(reading: Reading, call: ts.CallExpression): void {
  const binding = bindingOf(reading.typescript, call);

  if (binding !== undefined) {
    reading.definitions.push({
      key: `style:${reading.path}#${binding}`,
      anchor: { path: reading.path, binding }
    });
    return;
  }

  const around = enclosingName(reading.typescript, call);
  const where = around === undefined ? "" : ` in "${around}"`;

  unresolve(reading, `defineStyle${where} is not bound to a module-level const`);
}

/**
 * Reads one definer call.
 *
 * @param reading - The file being read.
 * @param call - The call.
 * @param definer - The definer it calls.
 */
function readCall(reading: Reading, call: ts.CallExpression, definer: Definer): void {
  const prefix = ID_PREFIXES[definer];

  if (prefix !== undefined) readIdCall(reading, call, definer, prefix);
  if (definer === "projection") readProjection(reading, call);
  if (definer === "defineTextStyles") readTextStyles(reading, call);
  if (definer === "defineStyle") readStyle(reading, call);
}

/**
 * Adds the JSX keys of the file; the same key twice in one file is one anchor, since `find`
 * answers every place of an anchor in its file.
 *
 * @param reading - The file being read.
 * @param source - The parsed file.
 */
function readJsx(reading: Reading, source: ts.SourceFile): void {
  const seen = new Set<string>();

  for (const hit of collectJsx(reading.typescript, source)) {
    if (isOpaque(hit)) {
      unresolve(reading, opaqueReason(hit));
      continue;
    }

    const anchor = anchorOfHit(reading.path, hit);
    const identity = JSON.stringify(anchor);

    if (seen.has(identity)) continue;

    seen.add(identity);
    reading.definitions.push({ key: `jsx:${hit.key}`, anchor });
  }
}

/**
 * Reads the keys one file defines.
 *
 * @param typescript - The TypeScript module.
 * @param source - The parsed file.
 * @param path - The root-relative path of the file.
 * @param definers - The definers the file can call, from `definersOf`.
 * @returns The definitions, the node tables and the unresolved items in source order, and the
 *   component names the file renders.
 */
export function extractFile(
  typescript: TypeScript,
  source: ts.SourceFile,
  path: string,
  definers: ReadonlyMap<string, Definer>
): Extracted {
  const reading: Reading = {
    typescript,
    path,
    definers,
    definitions: [],
    tables: [],
    unresolved: []
  };
  const visit = (node: ts.Node): void => {
    const definer = typescript.isCallExpression(node)
      ? definerOfCall(typescript, node, definers)
      : undefined;

    if (definer !== undefined && typescript.isCallExpression(node))
      readCall(reading, node, definer);
    typescript.forEachChild(node, visit);
  };

  if (definers.size > 0) visit(source);
  reading.definitions.push(...readComponents(typescript, source, path));
  readJsx(reading, source);

  return {
    definitions: reading.definitions,
    tables: reading.tables,
    unresolved: reading.unresolved,
    rendered: renderedOf(typescript, source)
  };
}
