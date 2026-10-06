/**
 * @file project — an anchor read on one parse of its file. A JSX anchor answers every element
 * whose key reads the same: the line of the attribute, the element as the range. A binding
 * answers its declaration statement, or the property of its `key` inside it (a text style, the
 * `name` of a projection, a slot of a flow table). A style built in a function answers its calls
 * there instead: every style call of the function, or the call under the property of its `key`.
 * An anchor with a key and no binding answers the first place the key is written.
 */
import type ts from "typescript";
import { definerOfCall } from "./extract/definitions";
import { collectJsx, type JsxHit } from "./extract/jsx";
import type { Definer } from "./extract/module";
import {
  declaredFunctions,
  type FunctionNode,
  propertyNameOf,
  propertyOfValue,
  unwrap
} from "./extract/scope";
import type { Anchor, Found } from "./types";
import type { TypeScript } from "./typescript";

/** A line and a range, 1-based, the end column exclusive. */
export type Place = Pick<Found, "line" | "range">;

/** The JSX hits of one parse; a caller that reads many anchors on it collects them once. */
export type JsxHitsOf = () => readonly JsxHit[];

/** What the caller knows beyond the anchor. */
export type LocateContext = {
  /** The kind of the key the anchor belongs to: `style` for a `style:` key. */
  readonly keyKind?: string;
  /** The JSX hits of the parse; collected on the call by default. */
  readonly jsxHits?: JsxHitsOf;
  /** The definers of the file by callee as written, the way extraction recognises them. */
  readonly definers?: () => ReadonlyMap<string, Definer>;
};

/** The kind of a style key. */
const STYLE_KIND = "style";

/**
 * The place of a node: the line of one node and the range of another.
 *
 * @param source - The parsed file.
 * @param lineNode - The node whose start line is the line.
 * @param rangeNode - The node whose span is the range.
 * @returns The place.
 */
function placeOf(source: ts.SourceFile, lineNode: ts.Node, rangeNode: ts.Node): Place {
  const line = source.getLineAndCharacterOfPosition(lineNode.getStart(source)).line + 1;
  const start = source.getLineAndCharacterOfPosition(rangeNode.getStart(source));
  const end = source.getLineAndCharacterOfPosition(rangeNode.getEnd());

  return { line, range: [start.line + 1, start.character + 1, end.line + 1, end.character + 1] };
}

/**
 * Whether a top-level statement declares a name.
 *
 * @param typescript - The TypeScript module.
 * @param statement - The statement.
 * @param binding - The name.
 * @returns True for a const, a destructured const, a function or a class of that name.
 */
function declares(typescript: TypeScript, statement: ts.Statement, binding: string): boolean {
  if (typescript.isFunctionDeclaration(statement) || typescript.isClassDeclaration(statement)) {
    return statement.name?.text === binding;
  }

  if (!typescript.isVariableStatement(statement)) return false;

  return statement.declarationList.declarations.some(declaration => {
    const name = declaration.name;

    if (typescript.isIdentifier(name)) return name.text === binding;

    return name.elements.some(
      element => typescript.isBindingElement(element) && element.name.getText() === binding
    );
  });
}

/**
 * The shallowest property of a key inside a declaration, the first one at that depth.
 *
 * @param typescript - The TypeScript module.
 * @param root - The declaration statement.
 * @param key - The property name.
 * @returns The property, or `undefined`.
 */
function propertyIn(typescript: TypeScript, root: ts.Node, key: string): ts.Node | undefined {
  const queue: ts.Node[] = [root];

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (propertyNameOf(typescript, next) === key) return next;
    typescript.forEachChild(next, child => {
      queue.push(child);
    });
  }

  return undefined;
}

/**
 * The first place a key is written: a string literal of that text, or a property of that name.
 *
 * @param typescript - The TypeScript module.
 * @param source - The parsed file.
 * @param key - The key.
 * @returns The place, or `undefined`.
 */
function writtenAt(typescript: TypeScript, source: ts.SourceFile, key: string): Place | undefined {
  // forEachChild stops at the first child that answers a node.
  const visit = (node: ts.Node): ts.Node | undefined => {
    const isLiteral = typescript.isStringLiteralLike(node) && node.text === key;

    if (isLiteral || propertyNameOf(typescript, node) === key) return node;

    return typescript.forEachChild(node, visit);
  };
  const found = visit(source);

  if (found === undefined) return undefined;

  // A literal that names a property, or is the id of a call, answers with that property or call.
  const parent = found.parent;
  const isOwned = typescript.isPropertyAssignment(parent) || typescript.isCallExpression(parent);

  return placeOf(source, found, isOwned ? parent : found);
}

/**
 * The style calls a function makes, at any depth, in source order. A call that is the value of a
 * property is left out: it has a key of its own.
 *
 * @param typescript - The TypeScript module.
 * @param factory - The function.
 * @param definers - The definers of the file.
 * @returns The calls.
 */
function styleCallsIn(
  typescript: TypeScript,
  factory: FunctionNode,
  definers: ReadonlyMap<string, Definer>
): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    const isStyle =
      typescript.isCallExpression(node) &&
      definerOfCall(typescript, node, definers) === "defineStyle" &&
      propertyOfValue(typescript, node) === undefined;

    if (isStyle) calls.push(node);
    typescript.forEachChild(node, visit);
  };

  visit(factory);

  return calls;
}

/**
 * Reads a style built in a module-level function: every style call of the function, or, with a
 * key, the property of that key with the call as the range.
 *
 * @param typescript - The TypeScript module.
 * @param source - The parsed file.
 * @param anchor - The anchor, bound to the function.
 * @param context - What the caller knows: the definers of the file.
 * @returns The places; none when the binding is not a function or holds no such call.
 */
function locateFactory(
  typescript: TypeScript,
  source: ts.SourceFile,
  anchor: Anchor,
  context: LocateContext
): Place[] {
  const factory = source.statements
    .flatMap(statement => declaredFunctions(typescript, statement))
    .find(item => item.name === anchor.binding);

  if (factory === undefined) return [];

  if (anchor.key !== undefined) {
    const property = propertyIn(typescript, factory.node, anchor.key);

    if (property === undefined || !typescript.isPropertyAssignment(property)) return [];

    return [placeOf(source, property, unwrap(typescript, property.initializer))];
  }

  const definers = context.definers?.() ?? new Map<string, Definer>();

  return styleCallsIn(typescript, factory.node, definers).map(call => placeOf(source, call, call));
}

/**
 * Reads an anchor on one parse of its file.
 *
 * @param typescript - The TypeScript module.
 * @param source - The parsed file.
 * @param anchor - The anchor.
 * @param context - The kind of its key, the JSX hits of the parse and the definers of the file.
 * @returns Every place of the anchor in the file; none when the file no longer holds it.
 */
export function locate(
  typescript: TypeScript,
  source: ts.SourceFile,
  anchor: Anchor,
  context: LocateContext = {}
): Place[] {
  // A JSX key: every element whose key reads the same pattern, kind, component and prop.
  if (anchor.kind !== undefined) {
    const hits = context.jsxHits?.() ?? collectJsx(typescript, source);

    return hits
      .filter(
        hit =>
          hit.key === anchor.key &&
          hit.kind === anchor.kind &&
          hit.component === anchor.component &&
          hit.prop === anchor.prop
      )
      .map(hit => placeOf(source, hit.attribute, hit.element));
  }

  // A key without a binding: where it is written.
  if (anchor.binding === undefined) {
    const place = anchor.key === undefined ? undefined : writtenAt(typescript, source, anchor.key);

    return place === undefined ? [] : [place];
  }

  // A style built in a function: its calls there.
  const built =
    context.keyKind === STYLE_KIND ? locateFactory(typescript, source, anchor, context) : [];

  if (built.length > 0) return built;

  // A binding: its statement, or the property of the key inside it.
  const binding = anchor.binding;
  const statement = source.statements.find(item => declares(typescript, item, binding));

  if (statement === undefined) return [];

  const property =
    anchor.key === undefined ? undefined : propertyIn(typescript, statement, anchor.key);
  const node = property ?? statement;

  return [placeOf(source, node, node)];
}
