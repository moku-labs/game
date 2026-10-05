/**
 * @file project, extract — the JSX keys of one file. Every `key` attribute becomes a hit with its
 * pattern and how it is written; a literal `id` attribute on a component (an element whose name
 * starts upper-case) becomes an `idProp` hit named after that component. Extraction turns hits
 * into keys; `find` collects them again on a fresh parse to read their lines.
 */
import type ts from "typescript";
import type { Anchor, JsxKind } from "../types";
import type { TypeScript } from "../typescript";
import { ANY, ID, patternOf, stemOf } from "./pattern";
import { enclosingName, unwrap } from "./scope";

/** One JSX key of a file. */
export type JsxHit = {
  /** The pattern of a `key`, or the value of an `id` prop. */
  readonly key: string;
  readonly kind: JsxKind;
  /** The literal head of a template or identifier key. */
  readonly stem?: string;
  /** The component of an `id` prop, or the component an `{id}` pattern is written in. */
  readonly component?: string;
  /** The attribute: its line is the line of the key. */
  readonly attribute: ts.JsxAttribute;
  /** The whole element: the range of the key. */
  readonly element: ts.Node;
  /** The tag as written, for the unresolved reason. */
  readonly tag: string;
  /** The key expression as written, for the unresolved reason. */
  readonly written: string;
};

/** The longest key expression an unresolved reason quotes. */
const QUOTE_LENGTH = 60;

/** A component tag: its name starts upper-case. */
const COMPONENT_TAG = /^[A-Z]/;

/**
 * The expression a JSX attribute holds: the string of `key="x"` or the code of `key={x}`.
 *
 * @param typescript - The TypeScript module.
 * @param attribute - The attribute.
 * @returns The expression, or `undefined` for `<a key />` and `key={}`.
 */
function attributeValue(
  typescript: TypeScript,
  attribute: ts.JsxAttribute
): ts.Expression | undefined {
  const initializer = attribute.initializer;

  if (initializer === undefined) return undefined;
  if (typescript.isStringLiteral(initializer)) return initializer;
  if (typescript.isJsxExpression(initializer)) return initializer.expression;

  return undefined;
}

/**
 * How a key expression is written.
 *
 * @param typescript - The TypeScript module.
 * @param expression - The key expression.
 * @returns `literal` for a string, `template` for a template with holes, `ident` for the rest.
 */
function kindOf(typescript: TypeScript, expression: ts.Expression): JsxKind {
  const inner = unwrap(typescript, expression);

  if (typescript.isStringLiteralLike(inner)) return "literal";

  return typescript.isTemplateExpression(inner) ? "template" : "ident";
}

/**
 * The upper-case top-level declaration a node sits in: the component an `{id}` pattern belongs to.
 *
 * @param typescript - The TypeScript module.
 * @param node - The attribute.
 * @returns The component name, or `undefined` inside a lower-case helper.
 */
function componentAround(typescript: TypeScript, node: ts.Node): string | undefined {
  const name = enclosingName(typescript, node);

  return name !== undefined && COMPONENT_TAG.test(name) ? name : undefined;
}

/**
 * Quotes a key expression for an unresolved reason: one line, cut to a readable length.
 *
 * @param text - The expression as written.
 * @returns The quote.
 * @example
 * ```ts
 * quoteOf("card.key"); // "card.key"
 * ```
 */
function quoteOf(text: string): string {
  const line = text.replaceAll(/\s+/g, " ");

  return line.length > QUOTE_LENGTH ? `${line.slice(0, QUOTE_LENGTH)}…` : line;
}

/**
 * The hit of a `key` attribute.
 *
 * @param typescript - The TypeScript module.
 * @param attribute - The attribute.
 * @param place - The element and its tag.
 * @param place.element - The whole element.
 * @param place.tag - The tag as written.
 * @returns The hit, or `undefined` for a key without a value.
 */
function keyHit(
  typescript: TypeScript,
  attribute: ts.JsxAttribute,
  place: { element: ts.Node; tag: string }
): JsxHit | undefined {
  const expression = attributeValue(typescript, attribute);

  if (expression === undefined) return undefined;

  const kind = kindOf(typescript, expression);
  const key = patternOf(typescript, expression);
  const stem = kind === "literal" ? "" : stemOf(key);
  const component = key.includes(ID) ? componentAround(typescript, attribute) : undefined;
  const written = quoteOf(expression.getText());

  return {
    key,
    kind,
    attribute,
    ...place,
    written,
    ...(stem === "" ? {} : { stem }),
    ...(component === undefined ? {} : { component })
  };
}

/**
 * The hit of a literal `id` prop on a component.
 *
 * @param typescript - The TypeScript module.
 * @param attribute - The attribute.
 * @param place - The element and its tag.
 * @param place.element - The whole element.
 * @param place.tag - The tag as written.
 * @returns The hit, or `undefined` when the value is not a string literal.
 */
function idHit(
  typescript: TypeScript,
  attribute: ts.JsxAttribute,
  place: { element: ts.Node; tag: string }
): JsxHit | undefined {
  const expression = attributeValue(typescript, attribute);
  const value = expression === undefined ? undefined : unwrap(typescript, expression);

  if (value === undefined || !typescript.isStringLiteralLike(value)) return undefined;

  return {
    key: value.text,
    kind: "idProp",
    component: place.tag,
    attribute,
    ...place,
    written: value.text
  };
}

/**
 * The hits of the attributes of one opening or self-closing element.
 *
 * @param typescript - The TypeScript module.
 * @param opening - The opening or self-closing element.
 * @returns Its hits.
 */
function hitsOf(typescript: TypeScript, opening: ts.JsxOpeningLikeElement): JsxHit[] {
  const element = typescript.isJsxOpeningElement(opening) ? opening.parent : opening;
  const place = { element, tag: opening.tagName.getText() };
  const isComponent = COMPONENT_TAG.test(place.tag);
  const hits: JsxHit[] = [];

  for (const attribute of opening.attributes.properties) {
    if (!typescript.isJsxAttribute(attribute) || !typescript.isIdentifier(attribute.name)) continue;

    const name = attribute.name.text;
    const keyEntry = name === "key" ? keyHit(typescript, attribute, place) : undefined;
    const idEntry = name === "id" && isComponent ? idHit(typescript, attribute, place) : undefined;

    if (keyEntry !== undefined) hits.push(keyEntry);
    if (idEntry !== undefined) hits.push(idEntry);
  }

  return hits;
}

/**
 * Collects every JSX key of a file, in source order.
 *
 * @param typescript - The TypeScript module.
 * @param source - The parsed file.
 * @returns The hits; a key that reads `*` is among them.
 */
export function collectJsx(typescript: TypeScript, source: ts.SourceFile): JsxHit[] {
  const hits: JsxHit[] = [];
  const visit = (node: ts.Node): void => {
    const isOpening =
      typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node);

    if (isOpening) hits.push(...hitsOf(typescript, node));
    typescript.forEachChild(node, visit);
  };

  if (source.languageVariant === typescript.LanguageVariant.JSX) visit(source);

  return hits;
}

/**
 * Whether a hit holds nothing literal: its key reads `*` alone.
 *
 * @param hit - A hit.
 * @returns True for a key nothing in the file can read.
 */
export function isOpaque(hit: JsxHit): boolean {
  return hit.key === ANY;
}

/**
 * The anchor of a hit.
 *
 * @param file - The root-relative path of the file.
 * @param hit - The hit.
 * @returns The anchor: path, key, kind, and the stem and component when there are.
 */
export function anchorOfHit(file: string, hit: JsxHit): Anchor {
  return {
    path: file,
    key: hit.key,
    kind: hit.kind,
    ...(hit.stem === undefined ? {} : { stem: hit.stem }),
    ...(hit.component === undefined ? {} : { component: hit.component })
  };
}

/**
 * The unresolved reason of a key that reads `*`.
 *
 * @param hit - The hit.
 * @returns The reason: `JSX key "card.key" on <row> resolves to "*"`.
 */
export function opaqueReason(hit: JsxHit): string {
  return `JSX key "${hit.written}" on <${hit.tag}> resolves to "${ANY}"`;
}
