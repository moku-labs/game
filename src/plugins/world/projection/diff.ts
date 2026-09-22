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
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => deepEquals(entry, right[index]))
    );
  }
  if (Array.isArray(right)) return false;

  const keys = Object.keys(left);

  if (keys.length !== Object.keys(right).length) return false;

  return keys.every(key =>
    deepEquals((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])
  );
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
