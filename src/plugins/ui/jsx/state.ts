/**
 * @file ui/jsx — state factory: the component registry, the roots, the elements and the
 * instances whose local state outlives every render.
 */
import type { Rect } from "../layout/types";
import type { Anchor, JsxState, TextState } from "./types";

/**
 * Creates an empty map. Its own non-exported function, because lint rule L5 refuses a collection
 * built inside an exported declaration.
 *
 * @returns A map with nothing in it.
 */
function emptyMap<Key, Value>(): Map<Key, Value> {
  return new Map();
}

/**
 * Creates an empty set, for the same reason as `emptyMap`.
 *
 * @returns A set with nothing in it.
 */
function emptySet<Value>(): Set<Value> {
  return new Set();
}

/**
 * Creates the text input branch: no hidden input, nothing edited, an empty mirror.
 *
 * @returns The text state.
 */
function createTextState(): TextState {
  return {
    element: undefined,
    editing: undefined,
    mirror: { value: "", selectionStart: 0, selectionEnd: 0, direction: "none" },
    composing: undefined,
    keyboard: { inset: 0, innerHeight: 0, lift: 0 },
    lifted: undefined,
    placed: undefined,
    watching: undefined,
    cleanups: []
  };
}

/**
 * Creates the jsx branch of the ui state. Everything starts empty: the registry is filled in
 * `onStart` from the `ui` key of every feature.
 *
 * @returns The module state.
 * @example
 * ```ts
 * createJsxState().roots.size; // 0
 * ```
 */
export function createJsxState(): JsxState {
  return {
    components: emptyMap(),
    roots: emptyMap(),
    elements: emptyMap(),
    byIdentity: emptyMap(),
    byKey: emptyMap(),
    instances: emptyMap(),
    exiting: emptySet(),
    leading: emptySet(),
    removing: emptySet(),
    hosts: emptySet(),
    hosted: emptyMap(),
    hostsVersion: 0,
    // Never seen: the first full hosting step runs.
    hostsSeen: -1,
    membershipSeen: -1,
    risen: emptySet(),
    released: emptySet(),
    building: undefined,
    reconciles: 0,
    focus: {
      entity: undefined,
      ring: undefined,
      drawn: undefined,
      tapping: false,
      ringless: false
    },
    fields: emptyMap(),
    text: createTextState(),
    hints: [],
    entering: { list: [], count: 0 },
    scrolls: emptySet(),
    windowRenders: 0,
    remount: false,
    epoch: 0,
    styled: 0,
    written: 0,
    debugTaps: [],
    debugWarned: false,
    overlays: emptySet(),
    asideRoots: 0,
    anchors: emptyMap()
  };
}

/**
 * Creates a rect the anchor pass writes in every frame. Its keys come in an order of their own
 * (`w`, `h`, `x`, `y`): V8 gives every `{ x, y, w, h }` object one hidden shape, the frozen `Box`
 * values among them, and in that shape `x` and `y` hold boxed numbers, so each fractional number
 * written there allocates 16 B. In a shape of its own the four fields take a double in place.
 *
 * @param x - The left.
 * @param y - The top.
 * @param w - The width.
 * @param h - The height.
 * @returns The rect.
 * @example
 * ```ts
 * ownRect(40, 1500, 116, 120).x; // 40
 * ```
 */
export function ownRect(x: number, y: number, w: number, h: number): Rect {
  return { w, h, x, y };
}

/**
 * Creates what the anchor pass keeps for a new `<anchor>`: nothing read yet, not placed.
 *
 * @returns The record, every rect and the pose zeroed.
 */
export function createAnchor(): Anchor {
  return {
    node: undefined,
    to: undefined,
    retarget: false,
    seen: [],
    shown: [],
    count: 0,
    shownCount: 0,
    screen: ownRect(0, 0, 0, 0),
    part: ownRect(0, 0, 0, 0),
    next: ownRect(0, 0, 0, 0),
    pose: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
    placed: false,
    hidden: false,
    missing: 0,
    owed: false,
    stale: false,
    boxes: false,
    held: undefined,
    aim: { x: 0, y: 0 },
    track: { x: 0, y: 0 },
    wrote: { x: Number.NaN, y: Number.NaN },
    warned: { missing: false, own: false, style: false }
  };
}
