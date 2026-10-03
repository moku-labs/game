/**
 * @file visual — the JSON of a baseline: written with sorted keys and a two-space indent, so a
 * diff in git reads, and compared exactly, naming the path of the first difference. Pure.
 */
import type { Json } from "../plugins/model/types";

/** The path `compareJson` names when the two values differ at the top. */
const ROOT = "(root)";

/** A key that can follow a dot in a path: an identifier. */
const identifier = /^[A-Za-z_$][\w$]*$/u;

/** A JSON object, the one JSON value with keys. */
type JsonObject = { [key: string]: Json };

/**
 * Tells a JSON object from the other JSON values.
 *
 * @param value - A JSON value.
 * @returns True for an object that is neither `null` nor an array.
 * @example
 * ```ts
 * isJsonObject({ coins: 3 }); // true
 * ```
 */
function isJsonObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Adds a key to a path: after a dot when it is an identifier, in brackets otherwise.
 *
 * @param path - The path so far, empty at the top.
 * @param key - The key.
 * @returns The longer path.
 * @example
 * ```ts
 * keyPath("views", "board.items"); // 'views["board.items"]'
 * ```
 */
function keyPath(path: string, key: string): string {
  if (!identifier.test(key)) return `${path}[${JSON.stringify(key)}]`;

  return path === "" ? key : `${path}.${key}`;
}

/**
 * Finds the first difference of two arrays, element by element: past the shorter array, the
 * missing element is the difference.
 *
 * @param expected - The array of the baseline.
 * @param actual - The array read now.
 * @param path - The path of the two arrays.
 * @returns The path of the first difference, or `undefined` when they are equal.
 */
function compareArrays(expected: Json[], actual: Json[], path: string): string | undefined {
  const length = Math.max(expected.length, actual.length);

  for (let index = 0; index < length; index += 1) {
    const found = compareAt(expected[index], actual[index], `${path}[${index}]`);

    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * Finds the first difference of two objects, key by key in sorted order: a key only one side
 * has, or a value that differs.
 *
 * @param expected - The object of the baseline.
 * @param actual - The object read now.
 * @param path - The path of the two objects.
 * @returns The path of the first difference, or `undefined` when they are equal.
 */
function compareObjects(
  expected: JsonObject,
  actual: JsonObject,
  path: string
): string | undefined {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].toSorted();

  for (const key of keys) {
    const found = compareAt(expected[key], actual[key], keyPath(path, key));

    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * Finds the first difference of two JSON values at a path. `undefined` stands for a key or an
 * element only the other side has.
 *
 * @param expected - The value of the baseline.
 * @param actual - The value read now.
 * @param path - The path of the two values, empty at the top.
 * @returns The path of the first difference, or `undefined` when they are equal.
 */
function compareAt(
  expected: Json | undefined,
  actual: Json | undefined,
  path: string
): string | undefined {
  const here = path === "" ? ROOT : path;

  // The callers pass at least one defined side: a key of either object, an index of the longer array.
  if (expected === undefined || actual === undefined) return here;

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return here;

    return compareArrays(expected, actual, path);
  }

  if (isJsonObject(expected) || isJsonObject(actual)) {
    if (!isJsonObject(expected) || !isJsonObject(actual)) return here;

    return compareObjects(expected, actual, path);
  }

  return expected === actual ? undefined : here;
}

/**
 * Compares two JSON values exactly and names the first difference: keys in sorted order, the
 * way the baseline file lists them, and array elements in order. A key only one side has, a
 * changed type and a changed value are each a difference.
 *
 * @param expected - The value of the baseline.
 * @param actual - The value read now.
 * @returns The JSON path of the first difference, `"(root)"` for the top, or `undefined` when
 *   the two are equal.
 * @example
 * ```ts
 * compareJson({ ui: { children: [{ rect: { y: 1 } }] } }, { ui: { children: [{ rect: { y: 2 } }] } });
 * // "ui.children[0].rect.y"
 * ```
 */
export function compareJson(expected: Json, actual: Json): string | undefined {
  return compareAt(expected, actual, "");
}

/**
 * Rebuilds a value with the keys of every object in sorted order, so `JSON.stringify` writes
 * them sorted.
 *
 * @param value - The value to write.
 * @returns The same value with sorted objects.
 * @example
 * ```ts
 * Object.keys(sortKeys({ b: 1, a: 2 }) as object); // ["a", "b"]
 * ```
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => sortKeys(item));

  if (typeof value !== "object" || value === null) return value;

  const entries = Object.entries(value).toSorted(([left], [right]) => (left < right ? -1 : 1));

  return Object.fromEntries(entries.map(([key, item]) => [key, sortKeys(item)]));
}

/**
 * Writes a value as the text of a baseline file: JSON with sorted keys, a two-space indent and
 * a final newline. A field that is `undefined` is left out, as `JSON.stringify` does.
 *
 * @param value - What a reader answered: plain data.
 * @returns The text.
 * @example
 * ```ts
 * stableJson({ b: 1, a: true }); // '{\n  "a": true,\n  "b": 1\n}\n'
 * ```
 */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), undefined, 2)}\n`;
}

/**
 * Reads the text of a baseline file as JSON.
 *
 * @param text - The text.
 * @param file - The file it came from, for the message.
 * @returns The JSON value.
 * @throws {Error} When the text is not JSON, say a merge conflict left markers in it.
 * @example
 * ```ts
 * parseJson('{ "path": "home" }', "tests/visual/home/rest/state.json"); // { path: "home" }
 * ```
 */
export function parseJson(text: string, file: string): Json {
  try {
    return JSON.parse(text) as Json;
  } catch {
    throw new Error(
      `[game] The baseline "${file}" is not JSON.\n  Fix the file, or write it again with --update.`
    );
  }
}
