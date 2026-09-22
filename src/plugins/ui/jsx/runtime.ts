/**
 * @file ui/jsx — the JSX runtime itself: the three factories a TypeScript build calls, the
 * fragment, and the `JSX` namespace `"jsxImportSource": "@moku-labs/game"` resolves to. Pure and
 * reachable only through `src/jsx-runtime.ts` and `src/jsx-dev-runtime.ts` (lint L9).
 */
import { isComponentDefinition } from "./component";
import { FRAGMENT, flatten } from "./flatten";
import type { UiIntrinsicElements } from "./intrinsics";
import type { DescriptionNode, JsxChild } from "./types";

/** What the compiler passes as props: the children plus whatever the tag declared. */
type JsxProperties = Record<string, unknown> & { children?: JsxChild };

/**
 * Splits the children out of the props the compiler built, so a node never carries them twice.
 *
 * @param props - What the compiler passed.
 * @returns The props without `children`.
 * @example
 * ```ts
 * withoutChildren({ style: {}, children: "a" }); // { style: {} }
 * ```
 */
function withoutChildren(props: JsxProperties): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...props };

  delete rest.children;

  return rest;
}

/**
 * Wraps what a plain function component returned so it can stand where one node is expected.
 *
 * @param produced - What the function returned.
 * @param key - The key the tag carried, if any.
 * @returns One node; several results are lifted by the parent's `flatten`.
 */
function asSingleNode(produced: JsxChild, key: string | undefined): DescriptionNode {
  const nodes = flatten(produced);
  const single = nodes.length === 1 ? nodes[0] : undefined;

  if (single === undefined) return { type: FRAGMENT, props: {}, children: nodes };
  if (key === undefined) return single;

  return { ...single, key };
}

/**
 * Builds one description node. A string tag becomes an intrinsic, a component definition becomes
 * one node the reconcile expands, and a plain function runs now.
 *
 * @param type - The tag: a string, `Fragment`, a component definition or a plain function.
 * @param props - What the compiler collected, `children` included.
 * @param key - The `key` attribute, passed as the third argument, never inside `props`.
 * @returns The node.
 * @example
 * ```ts
 * jsx("row", { style: { gap: 8 } }, "tabs"); // { type: "row", key: "tabs", props: { style: { gap: 8 } }, children: [] }
 * ```
 */
export function jsx(type: unknown, props: JsxProperties, key?: string): DescriptionNode {
  const rest = withoutChildren(props);

  if (type === Fragment) return { type: FRAGMENT, props: rest, children: flatten(props.children) };

  if (isComponentDefinition(type)) {
    const node: DescriptionNode = { type: type.name, props, children: [] };

    return key === undefined ? node : { ...node, key };
  }

  if (typeof type === "function") {
    return asSingleNode((type as (given: JsxProperties) => JsxChild)(props), key);
  }

  const node: DescriptionNode = {
    type: String(type),
    props: rest,
    children: flatten(props.children)
  };

  return key === undefined ? node : { ...node, key };
}

/**
 * The factory for a tag with several static children. The same function as `jsx`.
 */
export const jsxs = jsx;

/**
 * The development factory. The last three arguments are debug information the runtime drops.
 *
 * @param type - The tag.
 * @param props - What the compiler collected.
 * @param key - The `key` attribute.
 * @param _isStatic - Whether the children list is static. Ignored.
 * @param _source - The file and line of the tag. Ignored.
 * @param _self - The `this` of the enclosing scope. Ignored.
 * @returns The node `jsx` builds.
 * @example
 * ```ts
 * jsxDEV("row", {}, "tabs", false, { fileName: "hud.tsx" }, undefined).key; // "tabs"
 * ```
 */
export function jsxDEV(
  type: unknown,
  props: JsxProperties,
  key?: string,
  _isStatic?: boolean,
  _source?: unknown,
  _self?: unknown
): DescriptionNode {
  return jsx(type, props, key);
}

/**
 * Groups children without a tag of its own. Its children are lifted into the parent.
 *
 * @param props - The children between the two ends of the fragment.
 * @returns The fragment node, which `flatten` lifts.
 * @example
 * ```ts
 * Fragment({ children: ["a"] }).children.length; // 1
 * ```
 */
export function Fragment(props: JsxProperties): DescriptionNode {
  return { type: FRAGMENT, props: {}, children: flatten(props.children) };
}

/**
 * The namespace TypeScript reads a `.tsx` file against. A game sets `"jsx": "react-jsx"` and
 * `"jsxImportSource": "@moku-labs/game"`, and both entry files export this namespace.
 */

export declare namespace JSX {
  /** What a tag evaluates to. */
  interface Element extends DescriptionNode {}
  /** The thirteen tags a screen is written with. */
  interface IntrinsicElements extends UiIntrinsicElements {}
  /** The prop children are collected into. */
  interface ElementChildrenAttribute {
    children: unknown;
  }
  /** The attribute every tag takes next to its own props. */
  interface IntrinsicAttributes {
    key?: string;
  }
  /** The same attribute on a component tag. */
  interface IntrinsicClassAttributes<Component> {
    key?: string;
    ref?: Component;
  }
}
