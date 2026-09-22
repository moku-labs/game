/**
 * @file text plugin — state factory. The plugin starts empty: `onStart` fills the style table and
 * the font keys, and the layout phase fills everything else.
 */
import type { State } from "./types";

/**
 * Creates one empty table. It lives in its own non-exported function because lint rule L5 refuses
 * a collection built inside an exported declaration.
 *
 * @returns An empty map.
 */
function emptyMap<Key, Value>(): Map<Key, Value> {
  return new Map();
}

/**
 * Creates one empty set, for the same reason as `emptyMap`.
 *
 * @returns An empty set.
 */
function emptySet<Value>(): Set<Value> {
  return new Set();
}

/**
 * Creates the initial text state: no style, no font, no label, nothing measured.
 *
 * @returns The plugin state.
 */
export function createTextState(): State {
  return {
    styles: emptyMap(),
    styleOwner: emptyMap(),
    fontKeys: emptySet(),
    tables: emptyMap(),
    installed: emptySet(),
    seen: emptyMap(),
    bindTypes: emptyMap(),
    measured: emptyMap(),
    cache: emptyMap(),
    dirty: emptySet(),
    warned: emptySet(),
    removers: []
  };
}
