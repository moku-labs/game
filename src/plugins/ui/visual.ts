/**
 * @file ui plugin — the look of an element: the visual component it is drawn with, and where a
 * `fit: "contain"` ancestor really draws it. Pure: no ctx, no state. Shared by `jsx` (the
 * components of an entity, `lint`) and `layout` (the rest pose, the guide hole), which may not
 * import each other's run-time code.
 */
import {
  NineSlice,
  Shape,
  Sprite,
  type SpriteFit,
  type TransformValue
} from "../renderer/components";
import { Text } from "../text/components";
import type { AnyComponentValue } from "../world/types";
import type { Element } from "./jsx/types";
import type { ElementLookup, Rect } from "./layout/types";

/** The tag of the one child a scroll container holds: everything inside it moves as one. */
export const CONTENT = "content";

/** The three ways a sized sprite fills its box, as the `fit` prop of `image` and `icon` names them. */
const FITS: readonly SpriteFit[] = ["contain", "cover", "fill"];

/**
 * Tells whether a tag draws nothing of its own, so its `Shape` is invisible unless its style fills.
 *
 * @param type - The intrinsic tag.
 * @returns True for the six container tags and the content of a scroll.
 * @example
 * ```ts
 * isContainer("row"); // true
 * ```
 */
export function isContainer(type: string): boolean {
  return ["screen", "layer", "row", "column", "stack", "spacer", CONTENT].includes(type);
}

/**
 * Reads the asset key of an image or an icon out of its props.
 *
 * @param props - The props of the element.
 * @returns The texture key, empty when the markup named none.
 * @example
 * ```ts
 * textureOf({ name: "ui.gear" }); // "ui.gear"
 * ```
 */
function textureOf(props: Record<string, unknown>): string {
  const key = props.texture ?? props.name;

  return typeof key === "string" ? key : "";
}

/**
 * Reads the `fit` prop of an image or an icon.
 *
 * @param props - The props of the element.
 * @returns The fit, `"contain"` when the markup named none.
 * @example
 * ```ts
 * spriteFitOf({ fit: "cover" }); // "cover"
 * ```
 */
function spriteFitOf(props: Record<string, unknown>): SpriteFit {
  return FITS.find(fit => fit === props.fit) ?? "contain";
}

/**
 * Reads the content of a text out of its props.
 *
 * @param props - The props of the element.
 * @returns The string or message, empty when the markup named none.
 */
function contentOf(props: Record<string, unknown>): string {
  return (props.content ?? "") as string;
}

/**
 * The visual component of an element: a sprite for an image or an icon, the text for a text, the
 * nine-slice of its style (outlined when the style sets `debug`), or a rounded rectangle, a
 * triangle with `shape: "triangle"`, its stroke dashed with `dash`. A clipping element (`scroll`,
 * `overflow: "hidden"`) keeps the rectangle, which carries the clip. A style with a stroke and no fill draws
 * only the stroke, a ring. A container with no fill and no stroke gets an invisible rectangle:
 * the renderer hangs children under the display object of their parent, so every parent needs
 * one.
 *
 * @param element - The element to draw, with its rect known.
 * @returns The component values: one visual.
 */
export function visualOf(element: Element): AnyComponentValue[] {
  const { style, type, node, rect } = element;
  const alpha = style.alpha ?? 1;
  const tint = style.tint ?? Sprite.defaults.tint;

  if (type === "image" || type === "icon") {
    return [
      Sprite({
        texture: textureOf(node.props),
        tint,
        alpha,
        anchor: { x: 0, y: 0 },
        width: rect.w,
        height: rect.h,
        fit: spriteFitOf(node.props)
      })
    ];
  }

  if (type === "text") {
    const styleKey = typeof node.props.style === "string" ? node.props.style : "body";

    return [
      Text({
        content: contentOf(node.props),
        style: styleKey,
        bind: node.props.bind as undefined,
        anchor: { x: 0, y: 0 }
      })
    ];
  }

  const clip = type === "scroll" || style.overflow === "hidden";

  if (style.nineSlice !== undefined && !clip) {
    return [
      NineSlice({
        texture: style.nineSlice,
        width: rect.w,
        height: rect.h,
        alpha,
        tint,
        debug: style.debug ?? false
      })
    ];
  }

  const filled = style.fill !== undefined || style.stroke !== undefined;
  const invisible = isContainer(type) && !filled;

  return [
    Shape({
      kind: style.shape ?? "rect",
      w: rect.w,
      h: rect.h,
      fill: style.fill ?? Shape.defaults.fill,
      // No `fill` paints nothing inside: a stroke-only ring, or a button whose label is all it shows.
      fillAlpha: style.fill === undefined ? 0 : Shape.defaults.fillAlpha,
      alpha: invisible ? 0 : alpha,
      radius: style.radius ?? 0,
      stroke: style.stroke ?? Shape.defaults.stroke,
      strokeWidth: style.strokeWidth ?? 0,
      dash: style.dash ?? 0,
      clip
    })
  ];
}

/**
 * The element itself and every element above it, nearest first.
 *
 * @param element - Where the walk starts.
 * @param lookup - How a parent entity becomes its element.
 * @returns The chain up to the root element.
 */
function chainOf(element: Element, lookup: ElementLookup): Element[] {
  const chain: Element[] = [];
  let current: Element | undefined = element;

  while (current !== undefined) {
    chain.push(current);
    current = current.parent === undefined ? undefined : lookup(current.parent);
  }

  return chain;
}

/**
 * The scale an element is drawn at by the `fit: "contain"` of itself and its ancestors.
 *
 * @param element - The element to ask about.
 * @param lookup - How a parent entity becomes its element.
 * @returns The product of the fit scales, 1 when nothing on the way up fits.
 */
export function fitScaleOf(element: Element, lookup: ElementLookup): number {
  return chainOf(element, lookup).reduce((scale, above) => scale * above.fit, 1);
}

/**
 * Where an element is drawn at rest, in root coordinates: its natural rect, scaled about the
 * centre of every fitted element on the way up, the element itself included. The visual
 * transform styles (offset, scale) are left out: they are a state look, never a place.
 *
 * @param element - The element to place.
 * @param lookup - How a parent entity becomes its element.
 * @returns The drawn rect.
 */
export function visualRectOf(element: Element, lookup: ElementLookup): Rect {
  let rect: Rect = { ...element.rect };

  for (const above of chainOf(element, lookup)) {
    if (above.fit === 1) continue;

    const centre = { x: above.rect.x + above.rect.w / 2, y: above.rect.y + above.rect.h / 2 };

    rect = {
      x: centre.x + above.fit * (rect.x - centre.x),
      y: centre.y + above.fit * (rect.y - centre.y),
      w: rect.w * above.fit,
      h: rect.h * above.fit
    };
  }

  return rect;
}

/**
 * Tells whether two transforms put a view in the same place.
 *
 * @param first - One pose.
 * @param second - The other.
 * @returns True when every field and the pivot are equal.
 * @example
 * ```ts
 * samePose(
 *   { x: 1, y: 2, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
 *   { x: 1, y: 2, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }
 * ); // true
 * ```
 */
export function samePose(
  first: Readonly<TransformValue>,
  second: Readonly<TransformValue>
): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.rotation === second.rotation &&
    first.scale === second.scale &&
    first.pivot.x === second.pivot.x &&
    first.pivot.y === second.pivot.y
  );
}
