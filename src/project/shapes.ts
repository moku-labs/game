/**
 * @file project — the JSX anchors of an index sorted by shape: the patterns with a prop hole
 * (`{id}`, `{amountKey}`), the `*` patterns and the literal key-carrying props. A leaf module: the
 * session caches the shapes per index, and `find` reads them.
 */
import { ANY, hasHole } from "./extract/pattern";
import type { Anchor, ProjectIndex } from "./types";

/** The prefix of a JSX key. */
export const JSX = "jsx:";

/** The JSX anchors of an index by shape. */
export type JsxShapes = { holePatterns: Anchor[]; wildPatterns: Anchor[]; idProps: Anchor[] };

/**
 * The anchors of the JSX patterns and of the literal key-carrying props of an index.
 *
 * @param index - The index.
 * @returns The prop-hole patterns, the `*` patterns and the `idProp` anchors.
 */
export function jsxShapes(index: ProjectIndex): JsxShapes {
  const shapes: JsxShapes = { holePatterns: [], wildPatterns: [], idProps: [] };

  for (const [key, entry] of Object.entries(index.symbols)) {
    if (!key.startsWith(JSX)) continue;

    for (const anchor of entry.def) {
      const pattern = anchor.key ?? "";

      if (anchor.kind === "idProp") shapes.idProps.push(anchor);
      else if (hasHole(pattern)) shapes.holePatterns.push(anchor);
      else if (pattern.includes(ANY)) shapes.wildPatterns.push(anchor);
    }
  }

  return shapes;
}
