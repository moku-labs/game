/**
 * @file ui/jsx — the look of a live element in motion (F85): what a render moved in the value of
 * its visual, the fields written directly while a `change` hook of the visual brings the numbers
 * home, and the `change` hooks of an element `ui` never plays, which a dev build names.
 */
import type { Message } from "../../i18n/types";
import {
  NineSlice,
  type NineSliceValue,
  Shape,
  type ShapeValue,
  Sprite,
  type SpriteValue
} from "../../renderer/components";
import { Text } from "../../text/components";
import type { TextBind, TextValue } from "../../text/types";
import type { AnyComponentType } from "../../world/types";
import type { UiCtx } from "../types";
import type { Element } from "./types";

/**
 * What a render moved in the value of a visual: `"numbers"` when a numeric field changed (what
 * else changed with it is written beside the motion), `"others"` when only other fields did, and
 * `"none"` when it says what it said.
 */
export type LookMove = "none" | "numbers" | "others";

/**
 * Compares the value of a visual a live element was last written with and the value of this
 * render: `"numbers"` when a numeric field moved, else `"others"` when another one did. Every
 * visual has its own comparator that reads its fields by name, so each read site meets one shape
 * of value and a fractional number is compared unboxed: per write of an element with a `change`
 * hook of its visual, 0 B (`__tests__/perf/look-moved.perf.ts`). A field the new value leaves out
 * stays on the entity, as a patch leaves it. A type that is none of the four visuals is reported
 * as `"numbers"`: its hook decides.
 *
 * @param type - The component type of the visual.
 * @param previous - The value the element was last written with.
 * @param next - The value of this render.
 * @returns What moved.
 * @example
 * ```ts
 * lookMoved(Shape, Shape({ kind: "arc", sweep: 0.25 }).value, Shape({ kind: "arc", sweep: 0.5 }).value); // "numbers"
 * ```
 */
export function lookMoved(type: AnyComponentType, previous: object, next: object): LookMove {
  if (type === Shape) return shapeMoved(previous as ShapeValue, next as ShapeValue);
  if (type === Sprite) return spriteMoved(previous as SpriteValue, next as SpriteValue);
  if (type === NineSlice) return nineSliceMoved(previous as NineSliceValue, next as NineSliceValue);
  if (type === Text) return textMoved(previous as TextValue, next as TextValue);

  return "numbers";
}

/**
 * What moved in a `Shape`: its sizes, colours, alphas, radius, stroke and dash are numbers, and
 * the sweep of two arcs; its kind, its clip and the ends of two arcs are not. Only an arc carries
 * `sweep` and `cap`, so they are read between two arcs alone.
 *
 * @param before - The look last written.
 * @param after - The look of this render.
 * @returns What moved.
 * @example
 * ```ts
 * shapeMoved(Shape({ kind: "arc", sweep: 0.2, cap: "round" }).value, Shape({ kind: "arc", sweep: 0.2, cap: "butt" }).value); // "others"
 * ```
 */
function shapeMoved(before: Readonly<ShapeValue>, after: Readonly<ShapeValue>): LookMove {
  const numbers =
    before.w !== after.w ||
    before.h !== after.h ||
    before.fill !== after.fill ||
    before.fillAlpha !== after.fillAlpha ||
    before.alpha !== after.alpha ||
    before.radius !== after.radius ||
    before.stroke !== after.stroke ||
    before.strokeWidth !== after.strokeWidth ||
    before.dash !== after.dash;
  const arcs = before.kind === "arc" && after.kind === "arc";

  if (numbers || (arcs && before.sweep !== after.sweep)) return "numbers";
  if (before.kind !== after.kind || before.clip !== after.clip) return "others";

  return arcs && before.cap !== after.cap ? "others" : "none";
}

/**
 * What moved in a `Sprite`: its tint, alpha and size are numbers; its texture, fit, anchor and
 * blend are not.
 *
 * @param before - The look last written.
 * @param after - The look of this render.
 * @returns What moved.
 * @example
 * ```ts
 * spriteMoved(Sprite({ texture: "ui.coin", width: 40 }).value, Sprite({ texture: "ui.coin", width: 80 }).value); // "numbers"
 * ```
 */
function spriteMoved(before: Readonly<SpriteValue>, after: Readonly<SpriteValue>): LookMove {
  const numbers =
    before.tint !== after.tint ||
    before.alpha !== after.alpha ||
    before.width !== after.width ||
    before.height !== after.height;

  if (numbers) return "numbers";

  const others =
    before.texture !== after.texture ||
    before.fit !== after.fit ||
    before.anchor.x !== after.anchor.x ||
    before.anchor.y !== after.anchor.y ||
    (after.blend !== undefined && before.blend !== after.blend);

  return others ? "others" : "none";
}

/**
 * What moved in a `NineSlice`: its size, alpha and tint are numbers; its texture, outline, clip,
 * rim and blend are not.
 *
 * @param before - The look last written.
 * @param after - The look of this render.
 * @returns What moved.
 * @example
 * ```ts
 * nineSliceMoved(NineSlice({ texture: "ui.panel" }).value, NineSlice({ texture: "ui.panel", hollow: true }).value); // "others"
 * ```
 */
function nineSliceMoved(
  before: Readonly<NineSliceValue>,
  after: Readonly<NineSliceValue>
): LookMove {
  const numbers =
    before.width !== after.width ||
    before.height !== after.height ||
    before.alpha !== after.alpha ||
    before.tint !== after.tint;

  if (numbers) return "numbers";

  const others =
    before.texture !== after.texture ||
    before.debug !== after.debug ||
    before.clip !== after.clip ||
    (after.hollow !== undefined && before.hollow !== after.hollow) ||
    (after.blend !== undefined && before.blend !== after.blend);

  return others ? "others" : "none";
}

/**
 * What moved in a `Text`: its alpha and the box of two texts that wrap at one are numbers; its
 * content, style, bind and anchor are not. A message or a bind written anew compares by what it
 * says. `resolved` is the text plugin's and never compared.
 *
 * @param before - The look last written.
 * @param after - The look of this render.
 * @returns What moved.
 * @example
 * ```ts
 * textMoved(Text({ content: "Play" }).value, Text({ content: "Play", alpha: 0.5 }).value); // "numbers"
 * ```
 */
function textMoved(before: Readonly<TextValue>, after: Readonly<TextValue>): LookMove {
  const boxes = "box" in before && "box" in after;

  if (before.alpha !== after.alpha || (boxes && before.box !== after.box)) return "numbers";

  const others =
    (!boxes && "box" in after) ||
    before.style !== after.style ||
    before.anchor.x !== after.anchor.x ||
    before.anchor.y !== after.anchor.y ||
    (before.content !== after.content && !sameMessage(before.content, after.content)) ||
    (before.bind !== after.bind && !sameBind(before.bind, after.bind));

  return others ? "others" : "none";
}

/**
 * Tells whether two contents of a text say the same: two messages of one key with the same
 * arguments, each compared by identity. Two strings are the same only when they are equal.
 *
 * @param before - The content last written.
 * @param after - The content of this render.
 * @returns True when the text says the same.
 * @example
 * ```ts
 * sameMessage({ key: "hud.coins", params: { n: 5 } }, { key: "hud.coins", params: { n: 5 } }); // true
 * ```
 */
function sameMessage(before: string | Message, after: string | Message): boolean {
  if (typeof before === "string" || typeof after === "string") return before === after;

  return before.key === after.key && sameArguments(before.params, after.params);
}

/**
 * Tells whether the arguments of two messages hold the same values under the same names: a
 * `for…in` over each, every value compared by identity.
 *
 * @param before - The arguments last written.
 * @param after - The arguments of this render.
 * @returns True when both hold the same.
 * @example
 * ```ts
 * sameArguments({ n: 5 }, { n: 6 }); // false
 * ```
 */
function sameArguments(before: object | undefined, after: object | undefined): boolean {
  if (before === after) return true;
  if (before === undefined || after === undefined) return false;

  const was = before as Readonly<Record<string, unknown>>;
  const now = after as Readonly<Record<string, unknown>>;

  for (const name in now) {
    if (!(name in was) || was[name] !== now[name]) return false;
  }

  for (const name in was) {
    if (!(name in now)) return false;
  }

  return true;
}

/**
 * Tells whether two binds of a text show the same field of the same component in one format.
 *
 * @param before - The bind last written.
 * @param after - The bind of this render.
 * @returns True when both show the same.
 * @example
 * ```ts
 * sameBind(bind(Counter, "value"), bind(Counter, "value")); // true
 * ```
 */
function sameBind(before: TextBind | undefined, after: TextBind | undefined): boolean {
  if (before === undefined || after === undefined) return before === after;

  return (
    before.component === after.component &&
    before.field === after.field &&
    before.format === after.format
  );
}

/**
 * The fields of a visual a render writes directly while its `change` hook brings the numbers
 * home: every field that is no number, without the ones the component type gives to a plugin.
 *
 * @param value - The value of this render.
 * @param owned - The fields the component type gives to a plugin.
 * @returns The patch, or `undefined` when every field is a number.
 * @example
 * ```ts
 * otherFields({ kind: "arc", w: 32, sweep: 0.5, cap: "butt" }, []); // { kind: "arc", cap: "butt" }
 * ```
 */
export function otherFields(
  value: object,
  owned: readonly string[]
): Record<string, unknown> | undefined {
  let patch: Record<string, unknown> | undefined;

  for (const [field, entry] of Object.entries(value)) {
    if (typeof entry === "number" || owned.includes(field)) continue;

    patch ??= {};
    patch[field] = entry;
  }

  return patch;
}

/**
 * Names, once per element and hook name, every `change` hook of an element `ui` never plays: not
 * `Box`, not `Transform`, not the visual it is drawn with, not an extra of its `components` prop.
 * Read when the element mounts and when its `motion` prop changes, against what it carries then.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The live element, its visual and its extras written.
 */
export function warnIdleChanges(ctx: UiCtx, element: Element): void {
  const change = element.motion?.change;

  if (change === undefined) return;

  const visual = element.look?.type.componentName;

  for (const name of Object.keys(change)) {
    // `Box` and `Transform` play whatever the element carries: the rect and the rest pose.
    const plays =
      name === "Box" || name === "Transform" || name === visual || element.extras.has(name);
    const once = `change-never-plays:${name}`;

    if (plays || element.warned.has(once)) continue;

    element.warned.add(once);
    ctx.log.warn("ui:change-never-plays", { key: element.key ?? element.identity, name });
  }
}
