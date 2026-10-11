/**
 * @file ui/jsx — the comparison of two prop values of a description. A view builds its props
 * again at every render, so identity says nothing about plain data: a plain object and an array
 * are compared by value. Anything else is compared by identity, because only its owner knows what
 * it holds: a function, a `Set`, a `Map`, a `Date`, a class instance. Pure.
 */

/**
 * Tells a plain object from any other: one written as a literal, or made without a prototype.
 *
 * @param value - An object that is no array.
 * @returns True when its own enumerable keys are all it holds.
 * @example
 * ```ts
 * isPlain(new Set(["a"])); // false
 * ```
 */
function isPlain(value: object): value is Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Compares two lists by value: the same length and the same entry at every index.
 *
 * @param left - The list of the last render.
 * @param right - What this render wrote in its place.
 * @returns True when `right` is a list that says the same.
 * @example
 * ```ts
 * sameList(["a", { n: 1 }], ["a", { n: 1 }]); // true
 * ```
 */
function sameList(left: readonly unknown[], right: unknown): boolean {
  return (
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((entry, index) => sameValue(entry, right[index]))
  );
}

/**
 * Compares two plain objects by value: the same own keys, each with the same value.
 *
 * @param left - The object of the last render.
 * @param right - The object of this render.
 * @returns True when both say the same.
 * @example
 * ```ts
 * sameFieldsDeep({ gap: 8, padding: { top: 4 } }, { gap: 8, padding: { top: 4 } }); // true
 * ```
 */
function sameFieldsDeep(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const keys = Object.keys(left);

  return (
    keys.length === Object.keys(right).length &&
    keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}

/**
 * Tells whether two prop values say the same. Plain objects and arrays are compared by value,
 * recursing with this function; everything else by identity: a function, a `Set`, a `Map`, a
 * `Date`, a typed array, a class instance. So two sets are never the same, whatever they hold,
 * and a hook built once is the same in every new object around it. `NaN` is the same as `NaN`.
 *
 * @param left - The value of the last render.
 * @param right - The value of this render.
 * @returns True when nothing has to be done for the difference.
 * @example
 * ```ts
 * sameValue({ gap: 8, is: { hover: { gap: 4 } } }, { gap: 8, is: { hover: { gap: 4 } } }); // true
 * sameValue({ picked: new Set(["a"]) }, { picked: new Set(["a"]) }); // false
 * ```
 */
export function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;

  // Two values that are not both objects: only `NaN` is the same without being identical.
  const areObjects =
    typeof left === "object" && typeof right === "object" && left !== null && right !== null;

  if (!areObjects) return Number.isNaN(left) && Number.isNaN(right);

  if (Array.isArray(left)) return sameList(left, right);
  if (Array.isArray(right) || !isPlain(left) || !isPlain(right)) return false;

  return sameFieldsDeep(left, right);
}
