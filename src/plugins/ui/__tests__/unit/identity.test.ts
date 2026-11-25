import { describe, expect, it } from "vitest";
import { identityOf, isIdentityOf } from "../../jsx/reconcile";
import type { DescriptionNode } from "../../jsx/types";

/**
 * A node of a tag and a key.
 *
 * @param type - The tag.
 * @param key - The key, if any.
 * @returns The node.
 */
function node(type: string, key?: string): DescriptionNode {
  return key === undefined
    ? { type, props: {}, children: [] }
    : { type, key, props: {}, children: [] };
}

/** Parents, among them one that is a prefix of another and one whose key holds the separator. */
const PARENTS = ["0", "01", "0|row@1|row", "0|row@11|row", "7|a|b|row"];

/** Nodes: unkeyed of two tags, keyed, a key that looks like an unkeyed name, a key with `|` and `@`. */
const NODES = [
  node("row"),
  node("text"),
  node("row", "row@1"),
  node("row", "a"),
  node("row", "a|b"),
  node("text", "row@1|text"),
  node("Board", "boardView")
];

/** Indexes of one and of several digits, and two that share their last digit. */
const INDEXES = [0, 1, 2, 10, 11, 21, 123];

/** One place a node can be put: under a parent, at an index. */
type Place = { parent: string; placed: DescriptionNode; index: number };

/** Every parent, node and index there is. */
const PLACES: Place[] = PARENTS.flatMap(parent =>
  NODES.flatMap(placed => INDEXES.map(index => ({ parent, placed, index })))
);

describe("isIdentityOf", () => {
  it("answers true exactly when identityOf builds the same string", () => {
    // Bug caught: an element keeps an identity that only looks like the one this render builds (a
    // shorter index, a key with a separator, a prefix of the parent), so the reconcile patches the
    // wrong element or leaves a new one out.
    let mismatches = 0;
    let matches = 0;

    for (const wanted of PLACES) {
      const expected = identityOf(wanted.parent, wanted.placed, wanted.index);

      for (const kept of PLACES) {
        const identity = identityOf(kept.parent, kept.placed, kept.index);
        const same = identity === expected;

        if (isIdentityOf(identity, wanted.parent, wanted.placed, wanted.index) !== same) {
          mismatches += 1;
        }
        if (same) matches += 1;
      }
    }

    expect(mismatches).toBe(0);
    expect(matches).toBeGreaterThan(PLACES.length - 1);
  });
});
