/**
 * @file ui/jsx — the one place that decides what a child of a tag becomes: fragments lift,
 * arrays flatten, strings and numbers become text nodes, three values drop. Pure.
 */
import type { DescriptionNode, JsxChild } from "./types";

/** The type of the node `Fragment` builds. It never reaches a reconcile: `flatten` lifts it. */
export const FRAGMENT = "#fragment";

/**
 * Builds the node a bare string or number child becomes.
 *
 * @param content - What stood between the tags.
 * @returns A text node carrying it.
 * @example
 * ```ts
 * textNode(5); // { type: "text", props: { content: "5" }, children: [] }
 * ```
 */
export function textNode(content: string | number): DescriptionNode {
  return { type: "text", props: { content: String(content) }, children: [] };
}

/**
 * Tells a description node from the other things a child may be.
 *
 * @param child - One child of a tag.
 * @returns True when it is a node.
 * @example
 * ```ts
 * isNode({ type: "row", props: {}, children: [] }); // true
 * ```
 */
export function isNode(child: JsxChild): child is DescriptionNode {
  return typeof child === "object" && child !== null && !Array.isArray(child) && "type" in child;
}

/**
 * Turns whatever stood between two tags into the children of that tag.
 *
 * @param child - One child, an array of children, or nothing.
 * @returns The children as nodes, fragments lifted and empty values dropped.
 * @example
 * ```ts
 * flatten(["a", undefined, 2]).map(node => node.props.content); // ["a", "2"]
 * ```
 */
export function flatten(child: JsxChild): DescriptionNode[] {
  const nodes: DescriptionNode[] = [];

  flattenInto(child, nodes);

  return nodes;
}

/**
 * Pushes what one child becomes onto a list: a nested array or a fragment adds its items one by one, with no list of
 * its own built and spread (F244: a render of the album's 610 nodes built one per child).
 *
 * @param child - One child, an array of children, or nothing.
 * @param nodes - The list the nodes are pushed onto.
 */
function flattenInto(child: JsxChild, nodes: DescriptionNode[]): void {
  if (child === null || child === undefined || typeof child === "boolean") return;

  if (typeof child === "string" || typeof child === "number") {
    nodes.push(textNode(child));

    return;
  }

  if (Array.isArray(child)) {
    for (const item of child) flattenInto(item, nodes);

    return;
  }

  if (!isNode(child)) return;

  if (child.type !== FRAGMENT) {
    nodes.push(child);

    return;
  }

  for (const lifted of child.children) nodes.push(lifted);
}
