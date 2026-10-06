/**
 * @file project — the JSX anchors of an index sorted by shape: the `{id}` patterns, the `*`
 * patterns and the literal `id=` props. A leaf module: the session caches the shapes per index,
 * and `find` reads them.
 */
import { ANY, ID } from "./extract/pattern";
import type { Anchor, ProjectIndex } from "./types";

/** The prefix of a JSX key. */
export const JSX = "jsx:";

/** The JSX anchors of an index by shape. */
export type JsxShapes = { idPatterns: Anchor[]; wildPatterns: Anchor[]; idAttributes: Anchor[] };

/**
 * The anchors of the JSX patterns and of the literal `id=` props of an index.
 *
 * @param index - The index.
 * @returns The `{id}` patterns, the `*` patterns and the `id=` props.
 */
export function jsxShapes(index: ProjectIndex): JsxShapes {
  const shapes: JsxShapes = { idPatterns: [], wildPatterns: [], idAttributes: [] };

  for (const [key, entry] of Object.entries(index.symbols)) {
    if (!key.startsWith(JSX)) continue;

    for (const anchor of entry.def) {
      const pattern = anchor.key ?? "";

      if (anchor.kind === "idProp") shapes.idAttributes.push(anchor);
      else if (pattern.includes(ID)) shapes.idPatterns.push(anchor);
      else if (pattern.includes(ANY)) shapes.wildPatterns.push(anchor);
    }
  }

  return shapes;
}
