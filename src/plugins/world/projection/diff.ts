/**
 * @file world/projection — the component diff: deep structural equality over plain JSON, and the
 * three lists one reconcile entry works from.
 */
import type { AnyComponentValue } from "../ecs/types";

/**
 * Compares two stored component values structurally. Payload objects are rebuilt by every `view`
 * call, so identity says nothing.
 *
 * @param left - First value.
 * @param right - Second value.
 * @returns True when both sides hold the same data.
 * @example
 * ```ts
 * deepEquals({ x: 1, tags: ["a"] }, { x: 1, tags: ["a"] }); // true
 * deepEquals({ x: 1 }, { x: 2 }); // false
 * ```
 */
export function deepEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left)) return Array.isArray(right) && sameEntries(left, right);
  if (Array.isArray(right)) return false;

  return sameFields(left as Record<string, unknown>, right as Record<string, unknown>);
}

/**
 * Compares two arrays entry by entry, with an index loop: no closure and no iterator.
 *
 * @param left - First array.
 * @param right - Second array.
 * @returns True when both have the same length and equal entries.
 */
function sameEntries(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false;

  // eslint-disable-next-line unicorn/no-for-loop -- the index reads both arrays; no iterator on the hot path
  for (let index = 0; index < left.length; index += 1) {
    if (!deepEquals(left[index], right[index])) return false;
  }

  return true;
}

/**
 * Compares the own fields of two objects: every field of `left` equals the same field of `right`,
 * and both have as many own fields. A `for…in` with an own check reads the keys without the array
 * `Object.keys` builds, so a compare allocates nothing; the result is the one `Object.keys` gave.
 *
 * @param left - First object.
 * @param right - Second object.
 * @returns True when both hold the same data.
 */
function sameFields(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  let count = 0;

  for (const key in left) {
    if (!Object.hasOwn(left, key)) continue;

    count += 1;

    if (!deepEquals(left[key], right[key])) return false;
  }

  for (const key in right) {
    if (Object.hasOwn(right, key)) count -= 1;
  }

  return count === 0;
}

/**
 * Reads the node a `Tree` value carries. A tag stores `true` and carries none.
 *
 * @param value - The stored component value.
 * @returns The node, compared by identity, or `undefined`.
 */
function nodeOf(value: AnyComponentValue): unknown {
  const stored = value.value;

  return stored !== true && "node" in stored ? stored.node : undefined;
}

/**
 * Names what changed between the rest pose of a view and the next output of `view(item)`.
 *
 * @param rest - The rest pose, by component name.
 * @param next - The new output of `view(item)`, by component name.
 * @param byIdentity - Name of the component that is compared by identity, not structurally: the
 *   `Tree` of a screen, whose node is a foreign object the world only carries.
 * @returns The component names that were added, changed and removed.
 */
export function diffComponents(
  rest: ReadonlyMap<string, AnyComponentValue>,
  next: ReadonlyMap<string, AnyComponentValue>,
  byIdentity?: string
): { added: string[]; changed: string[]; removed: string[] } {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [name, value] of next) {
    const before = rest.get(name);

    if (before === undefined) added.push(name);
    else if (name === byIdentity) {
      if (nodeOf(before) !== nodeOf(value)) changed.push(name);
    } else if (!deepEquals(before.value, value.value)) changed.push(name);
  }

  for (const name of rest.keys()) {
    if (!next.has(name)) removed.push(name);
  }

  return { added, changed, removed };
}
