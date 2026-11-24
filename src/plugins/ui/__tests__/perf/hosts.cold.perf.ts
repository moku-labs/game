import { describe, expect, it } from "vitest";
import { allocCold } from "../../../../../tests/perf/alloc";
import { hostsOf } from "../../jsx/hosts";
import type { DescriptionNode } from "../../jsx/types";

// ---------------------------------------------------------------------------
// Cold perf (change 2026-11-24-f230-hot-path, step 0): what `hostsOf` allocates while V8 runs it in the interpreter
// or the baseline tier (`--max-opt=1`), as a phone runs it in its first seconds. Its `isNameList` walks the names with
// `for…of`: that costs an array iterator and its result objects there, which an index loop does not.
// Measured on Node 24.21, today's code, 3 names:
//   hostsOf today            208 B per call
//   the same with an index     0 B per call
// ---------------------------------------------------------------------------

/** A node that hosts three projections. */
const NODE: DescriptionNode = {
  type: "stack",
  props: { hosts: ["board.items", "board.rings", "board.fx"] },
  children: []
};

/** What `hostsOf` costs today, cold, plus 8 B of margin. A fix lowers this number, never raises it. */
const HOSTS_OF_COLD = 216;

/** What the index-looped copy costs, cold, plus 8 B of margin. */
const INDEXED_COLD = 8;

/**
 * `isNameList` as `hosts.ts` has it, but with an index loop: the copy the cold measure compares with.
 *
 * @param value - The `hosts` prop.
 * @returns True for an array of strings.
 */
function isNameListIndexed(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;

  // A counted loop on purpose: it is the walk the cold measure compares `for…of` with.
  let index = 0;

  while (index < value.length) {
    if (typeof value[index] !== "string") return false;
    index += 1;
  }

  return true;
}

/**
 * `hostsOf` over the index-looped `isNameList`.
 *
 * @param node - The node the markup wrote.
 * @returns The names, empty when the element hosts nothing.
 */
function hostsOfIndexed(node: DescriptionNode): readonly string[] {
  const hosts = node.props.hosts;

  return isNameListIndexed(hosts) ? hosts : [];
}

/** Where the measured calls leave their answer, so no call is dead code. */
const sink: { names: readonly string[] | undefined } = { names: undefined };

describe("hostsOf, run unoptimized", () => {
  it("stays within what it costs today", () => {
    const bytes = allocCold(() => {
      sink.names = hostsOf(NODE);
    });

    expect(bytes).toBeLessThanOrEqual(HOSTS_OF_COLD);
  });

  it("is beaten by the same walk with an index, which costs nothing", () => {
    const bytes = allocCold(() => {
      sink.names = hostsOfIndexed(NODE);
    });

    expect(bytes).toBeLessThanOrEqual(INDEXED_COLD);
  });
});
