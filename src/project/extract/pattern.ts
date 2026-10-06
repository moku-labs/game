/**
 * @file project, extract — a JSX key expression reduced to a pattern. Literal text stays; a name is
 * followed through same-file initializers, and a call through a same-file function that returns
 * one expression, with its parameters bound to the arguments. A hole that is a key-carrying prop
 * of a component (`id`, or a name that ends in `Key`) becomes `{id}` or `{amountKey}`; any other
 * hole becomes `*`. `` `${id}Picture` `` with `const id = cardKey(card.slot)` and `cardKey`
 * returning `` `card${slot}` `` reads `card*Picture`.
 */
import type ts from "typescript";
import type { TypeScript } from "../typescript";
import { type FunctionNode, meaningOf, unwrap } from "./scope";

/** A hole nothing in the file can fill. */
export const ANY = "*";

/**
 * A hole filled at run time by a key-carrying prop of the component: `{id}`, `{amountKey}`. The
 * regex is global, so `.test` keeps `lastIndex` between calls: test a pattern with `hasHole`, never
 * `HOLE.test`.
 */
export const HOLE = /\{\w+\}/g;

/** A key-carrying prop: `id`, or a name that ends in `Key`. */
export const KEY_PROP = /^(?:id|\w+Key)$/;

/** How deep names and calls are followed before a hole is given up on. */
const MAX_DEPTH = 8;

/** Parameter name to the pattern of its argument, inside a function read through a call. */
type Bindings = ReadonlyMap<string, string>;

/**
 * The hole a prop of a component leaves in a key.
 *
 * @param property - The name of the prop.
 * @returns The hole: `{amountKey}` for `amountKey`.
 * @example
 * ```ts
 * holeOf("amountKey"); // "{amountKey}"
 * ```
 */
export function holeOf(property: string): string {
  return `{${property}}`;
}

/**
 * Whether a pattern holds a hole a prop fills.
 *
 * @param pattern - A pattern or a key.
 * @returns True when it holds `{id}`, `{amountKey}` or another prop hole.
 * @example
 * ```ts
 * hasHole("{id}Close"); // true
 * ```
 */
export function hasHole(pattern: string): boolean {
  return pattern.search(HOLE) !== -1;
}

/**
 * The hole a prop of a parameter object leaves: its own hole for a key-carrying prop, `*` else.
 *
 * @param property - The name of the prop, when the parameter is read through one.
 * @returns The hole.
 * @example
 * ```ts
 * propertyHole("tab"); // "*"
 * ```
 */
function propertyHole(property: string | undefined): string {
  return property !== undefined && KEY_PROP.test(property) ? holeOf(property) : ANY;
}

/**
 * The one expression a function returns, when it has exactly one.
 *
 * @param typescript - The TypeScript module.
 * @param node - The function.
 * @returns The returned expression, or `undefined`.
 */
function returnedBy(typescript: TypeScript, node: FunctionNode): ts.Expression | undefined {
  const body = node.body;

  if (body === undefined) return undefined;
  if (!typescript.isBlock(body)) return body;

  const returns: ts.ReturnStatement[] = [];
  const collect = (child: ts.Node): void => {
    if (typescript.isReturnStatement(child)) returns.push(child);
    if (!typescript.isFunctionLike(child)) typescript.forEachChild(child, collect);
  };

  typescript.forEachChild(body, collect);

  return returns.length === 1 ? returns[0]?.expression : undefined;
}

/**
 * Reads a name: a bound parameter, a const, or a destructured key-carrying prop.
 *
 * @param typescript - The TypeScript module.
 * @param identifier - The name.
 * @param bindings - The parameters bound by the call being read.
 * @param depth - How deep the reading is.
 * @returns The pattern.
 */
function readName(
  typescript: TypeScript,
  identifier: ts.Identifier,
  bindings: Bindings,
  depth: number
): string {
  const bound = bindings.get(identifier.text);

  if (bound !== undefined) return bound;

  const meaning = meaningOf(typescript, identifier);

  if (meaning?.kind === "const") return read(typescript, meaning.initializer, bindings, depth + 1);
  if (meaning?.kind === "param") return propertyHole(meaning.property);

  return ANY;
}

/**
 * Reads `props.id` or `props.amountKey`: a key-carrying prop of a parameter object becomes its
 * hole, any other prop `*`.
 *
 * @param typescript - The TypeScript module.
 * @param access - The property access.
 * @param bindings - The parameters bound by the call being read.
 * @returns The pattern.
 */
function readAccess(
  typescript: TypeScript,
  access: ts.PropertyAccessExpression,
  bindings: Bindings
): string {
  const owner = access.expression;
  const isOfParameter =
    typescript.isIdentifier(owner) &&
    !bindings.has(owner.text) &&
    meaningOf(typescript, owner)?.kind === "param";

  return isOfParameter ? propertyHole(access.name.text) : ANY;
}

/**
 * Reads a call of a same-file function: its one returned expression, with each parameter bound
 * to the pattern of its argument.
 *
 * @param typescript - The TypeScript module.
 * @param call - The call.
 * @param bindings - The parameters bound by the call being read.
 * @param depth - How deep the reading is.
 * @returns The pattern.
 */
function readCall(
  typescript: TypeScript,
  call: ts.CallExpression,
  bindings: Bindings,
  depth: number
): string {
  const callee = call.expression;
  const meaning = typescript.isIdentifier(callee) ? meaningOf(typescript, callee) : undefined;

  if (meaning?.kind !== "function") return ANY;

  const returned = returnedBy(typescript, meaning.node);

  if (returned === undefined) return ANY;

  const inner = new Map<string, string>();

  for (const [index, parameter] of meaning.node.parameters.entries()) {
    const argument = call.arguments[index];

    if (!typescript.isIdentifier(parameter.name)) continue;

    inner.set(
      parameter.name.text,
      argument === undefined ? ANY : read(typescript, argument, bindings, depth + 1)
    );
  }

  return read(typescript, returned, inner, depth + 1);
}

/**
 * Reads a template: its literal parts stay, each span is read into a pattern.
 *
 * @param typescript - The TypeScript module.
 * @param template - The template expression.
 * @param bindings - The parameters bound by the call being read.
 * @param depth - How deep the reading is.
 * @returns The pattern.
 */
function readTemplate(
  typescript: TypeScript,
  template: ts.TemplateExpression,
  bindings: Bindings,
  depth: number
): string {
  const spans = template.templateSpans.map(
    span => read(typescript, span.expression, bindings, depth + 1) + span.literal.text
  );

  return template.head.text + spans.join("");
}

/**
 * Reads one expression into a pattern.
 *
 * @param typescript - The TypeScript module.
 * @param node - The expression.
 * @param bindings - The parameters bound by the call being read.
 * @param depth - How deep the reading is.
 * @returns The pattern, holes not yet merged.
 */
function read(
  typescript: TypeScript,
  node: ts.Expression,
  bindings: Bindings,
  depth: number
): string {
  const expression = unwrap(typescript, node);

  // Too deep: give the hole up.
  if (depth > MAX_DEPTH) return ANY;

  // A string or number literal: its text as it is.
  if (typescript.isStringLiteralLike(expression) || typescript.isNumericLiteral(expression)) {
    return expression.text;
  }

  // A template: the literal parts, each span read.
  if (typescript.isTemplateExpression(expression)) {
    return readTemplate(typescript, expression, bindings, depth);
  }

  const isConcat =
    typescript.isBinaryExpression(expression) &&
    expression.operatorToken.kind === typescript.SyntaxKind.PlusToken;

  // A `+` concatenation: both sides read and joined.
  if (isConcat) {
    return (
      read(typescript, expression.left, bindings, depth + 1) +
      read(typescript, expression.right, bindings, depth + 1)
    );
  }

  // A name: a bound parameter, a const or a key-carrying prop.
  if (typescript.isIdentifier(expression)) return readName(typescript, expression, bindings, depth);

  // `props.id`, `props.amountKey`: a key-carrying prop of a parameter object.
  if (typescript.isPropertyAccessExpression(expression))
    return readAccess(typescript, expression, bindings);

  // A call of a same-file function: its one returned expression.
  if (typescript.isCallExpression(expression))
    return readCall(typescript, expression, bindings, depth);

  // Anything else is a hole.
  return ANY;
}

/**
 * Reduces a key expression to its pattern, with neighbouring `*` holes merged into one.
 *
 * @param typescript - The TypeScript module.
 * @param expression - The expression of a JSX `key` attribute.
 * @returns The pattern: `card*Picture`, `{id}Close`, `{amountKey}`, `hudRow`, or `*` when nothing
 * is literal.
 */
export function patternOf(typescript: TypeScript, expression: ts.Expression): string {
  return read(typescript, expression, new Map(), 0).replaceAll(/\*+/g, ANY);
}

/**
 * The literal head of a pattern: the text before its first hole.
 *
 * @param pattern - A pattern.
 * @returns The head, empty when the pattern starts with a hole.
 * @example
 * ```ts
 * stemOf("card*Picture"); // "card"
 * ```
 */
export function stemOf(pattern: string): string {
  const holes = [pattern.indexOf(ANY), pattern.search(HOLE)].filter(at => at >= 0);

  return pattern.slice(0, holes.length === 0 ? undefined : Math.min(...holes));
}
