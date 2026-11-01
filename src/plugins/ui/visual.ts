/**
 * @file ui plugin — the look of an element: the visual component it is drawn with, and where a
 * `fit: "contain"` ancestor really draws it. Pure: no ctx, no state. Shared by `jsx` (the
 * components of an entity, `lint`) and `layout` (the rest pose, the guide hole), which may not
 * import each other's run-time code.
 */
import {
  arcDefaults,
  NineSlice,
  Shape,
  Sprite,
  type SpriteBlend,
  type SpriteFit,
  type TransformValue
} from "../renderer/components";
import { Text } from "../text/components";
import { isTextFormat } from "../text/format";
import type { TextBind } from "../text/types";
import type { AnyComponentType, AnyComponentValue } from "../world/types";
import type { Element } from "./jsx/types";
import type { ElementLookup, Rect } from "./layout/types";
import type { ResolvedStyle } from "./styles/types";

/** The tag of the one child a scroll container holds: everything inside it moves as one. */
export const CONTENT = "content";

/** The tag whose rect is where its targets are drawn: the anchor pass places it, not the solve. */
export const ANCHOR = "anchor";

/** The three ways a sized sprite fills its box, as the `fit` prop of `image` and `icon` names them. */
const FITS: readonly SpriteFit[] = ["contain", "cover", "fill"];

/**
 * Tells whether a tag draws nothing of its own, so its `Shape` is invisible unless its style fills.
 *
 * @param type - The intrinsic tag.
 * @returns True for the seven container tags and the content of a scroll.
 * @example
 * ```ts
 * isContainer("row"); // true
 * ```
 */
export function isContainer(type: string): boolean {
  return ["screen", "layer", "row", "column", "stack", "spacer", ANCHOR, CONTENT].includes(type);
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
 * The bind of a text, when the markup gave it one.
 *
 * @param element - The element to ask about.
 * @returns What `bind()` built, or `undefined` for any other element.
 */
export function bindOf(element: Element): TextBind | undefined {
  const { bind } = element.node.props;
  const isBound = element.type === "text" && typeof bind === "object" && bind !== null;

  return isBound ? (bind as TextBind) : undefined;
}

/**
 * Tells whether an element is a text whose bind names a format of the game, not one of the four
 * built-in ones: such a format answers the style of the label too, so `Text.style` is what the
 * label shows and its `style` prop is only where it starts.
 *
 * @param element - The element to ask about.
 * @returns True for a text whose bind names a format.
 */
export function namesFormat(element: Element): boolean {
  const bind = bindOf(element);

  return bind !== undefined && !isTextFormat(bind.format);
}

/**
 * Whether a nine-slice draws its rim alone: `true` while its style says so, `false` once it did and
 * no longer does, and no field on a panel that was never hollow, so a game's describe and saved
 * values stay as they were without it.
 *
 * @param element - The element framed by the nine-slice.
 * @param hollow - The style's `hollow`.
 * @returns `{ hollow }`, or nothing.
 */
function hollowOf(element: Element, hollow: boolean | undefined): { hollow?: boolean } {
  if (hollow === true) {
    element.hollowed = true;

    return { hollow: true };
  }

  return element.hollowed === true ? { hollow: false } : {};
}

/** The blend field a sprite or a nine-slice value is spread with: one field, or none. */
type BlendField = Readonly<{ blend?: SpriteBlend }>;

/** What an element that never blended spreads into its visual: no field at all. */
const NO_BLEND: BlendField = Object.freeze({});

/** What an element that blended once spreads once its style no longer blends: the glow turned off. */
const NORMAL_BLEND: BlendField = Object.freeze({ blend: "normal" });

/** What an element spreads while its style blends, one frozen object per mode. */
const BLENDS: Readonly<Record<NonNullable<ResolvedStyle["blend"]>, BlendField>> = Object.freeze({
  add: Object.freeze({ blend: "add" }),
  screen: Object.freeze({ blend: "screen" })
});

/**
 * How an image or a nine-slice lays its pixels over what is under it: the style's blend while it
 * says one, `"normal"` once it did and no longer does (a live element is patched, so the old blend
 * would stay), and no field on an element that never blended, so a game's describe and saved
 * values stay as they were without it. Each answer is a frozen module constant: nothing is built.
 *
 * @param element - The element drawn with the sprite or the nine-slice.
 * @param blend - The style's `blend`.
 * @returns `{ blend }`, or nothing.
 */
function blendOf(element: Element, blend: ResolvedStyle["blend"]): BlendField {
  if (blend !== undefined) {
    element.blended = true;

    return BLENDS[blend];
  }

  return element.blended === true ? NORMAL_BLEND : NO_BLEND;
}

/**
 * The box a text wraps at: its laid-out width while it wraps at it, 0 once it fits again, so a
 * text that wrapped draws on one line, and no field on a text that never wrapped.
 *
 * @param element - The text element, with its rect known.
 * @returns `{ box }`, or nothing.
 */
function boxOf(element: Element): { box?: number } {
  if (element.measuredWidth !== undefined) {
    element.boxed = true;

    return { box: element.rect.w };
  }

  return element.boxed === true ? { box: 0 } : {};
}

/**
 * Tells whether a style states the width of its element: a width, or both side edges of an absolute element.
 *
 * @param style - The resolved style.
 * @returns True when it does.
 */
function statesWidth(style: ResolvedStyle): boolean {
  return (
    style.width !== undefined ||
    (style.position === "absolute" && style.left !== undefined && style.right !== undefined)
  );
}

/**
 * Tells whether a style states the height of its element: a height, or both top and bottom edges of an absolute
 * element.
 *
 * @param style - The resolved style.
 * @returns True when it does.
 */
function statesHeight(style: ResolvedStyle): boolean {
  return (
    style.height !== undefined ||
    (style.position === "absolute" && style.top !== undefined && style.bottom !== undefined)
  );
}

/**
 * Whether the layout sized an image to nothing: an axis whose size its style states (a width or a
 * height, or both edges of an absolute element) came out at 0. An image whose style states no size
 * is 0 by 0 too, and draws as its `Sprite` says: at its texture's size, or at the size a game's own
 * system writes into the sprite.
 *
 * @param style - The resolved style of the image.
 * @param rect - Its laid-out rect.
 * @returns True when it draws nothing.
 */
function sizedToNothing(style: ResolvedStyle, rect: Rect): boolean {
  return (statesWidth(style) && rect.w <= 0) || (statesHeight(style) && rect.h <= 0);
}

/**
 * The patch a live element writes into one of its components: every field but the ones the
 * component type gives to a plugin. That plugin keeps such a field for the life of the entity, so
 * a re-render never puts it back to its default: a label keeps the string `text` resolved for it.
 *
 * @param value - The component value the element carries now.
 * @param owned - The fields the component type gives to a plugin.
 * @returns The fields to write.
 * @example
 * ```ts
 * livePatch({ content: "Play", resolved: "" }, ["resolved"]); // { content: "Play" }
 * ```
 */
export function livePatch(value: object, owned: readonly string[]): object {
  if (owned.length === 0) return value;

  return Object.fromEntries(Object.entries(value).filter(([field]) => !owned.includes(field)));
}

/**
 * The rest pose recorded for an extra component: the value of this render, but the fields the
 * component type gives to a plugin stay as the entity carries them, so a render never resets them.
 *
 * @param current - The value the entity carries now; none before the component is added.
 * @param value - The value of this render.
 * @param owned - The fields the component type gives to a plugin.
 * @returns The rest value.
 * @example
 * ```ts
 * restValueOf({ until: 2000, left: 42 }, { until: 5000, left: 0 }, ["left"]); // { until: 5000, left: 42 }
 * ```
 */
export function restValueOf(
  current: object | undefined,
  value: object,
  owned: readonly string[]
): object {
  if (current === undefined || owned.length === 0) return value;

  return { ...current, ...livePatch(value, owned) };
}

/** The sizes of a sprite ui leaves alone, by axis: one list each, never a new one. */
const LEFT_NONE: readonly string[] = [];
const LEFT_WIDTH: readonly string[] = ["width"];
const LEFT_HEIGHT: readonly string[] = ["height"];
const LEFT_BOTH: readonly string[] = ["width", "height"];

/**
 * The list of sizes left alone for the axes that are.
 *
 * @param width - The width is left alone.
 * @param height - The height is left alone.
 * @returns One of the four lists.
 */
function leftSizes(width: boolean, height: boolean): readonly string[] {
  if (width && height) return LEFT_BOTH;
  if (width) return LEFT_WIDTH;

  return height ? LEFT_HEIGHT : LEFT_NONE;
}

/**
 * The fields of a value ui does not write onto a live element, or record as its rest: those its component type gives
 * to a plugin; for the `Sprite` of an image or an icon, the size on an axis its style does not state and the layout
 * left at 0; and for the `Text` of a label whose bind names a format, the style its format answered (F135). A game's own
 * system sizes such a sprite; written again by ui (a new viewport, a covered root, a restore) it went back to 0 by 0,
 * drawn at its texture's size (F111). On a first add the size is 0 anyway, the texture's. `element.node` is the node of
 * this render, so a bind that went back to a built-in format or left has its prop written as usual.
 *
 * @param element - The element.
 * @param type - The component type of the value.
 * @param owned - The fields its type gives to a plugin.
 * @returns The fields left alone.
 */
export function fieldsLeftAlone(
  element: Element,
  type: AnyComponentType,
  owned: readonly string[]
): readonly string[] {
  if (type === Text) return namesFormat(element) ? [...owned, "style"] : owned;

  const { style, rect } = element;
  const isImage = element.type === "image" || element.type === "icon";

  if (!isImage || type !== Sprite) return owned;

  const width = rect.w <= 0 && !statesWidth(style);
  const height = rect.h <= 0 && !statesHeight(style);
  const sizes = leftSizes(width, height);

  if (owned.length === 0) return sizes;

  return sizes.length === 0 ? owned : [...owned, ...sizes];
}

/**
 * The visual component of an element: a sprite for an image or an icon (at alpha 0 while its style
 * states a size the layout makes 0: the renderer draws a sprite of width 0 at its texture's size,
 * so the size alone cannot say "nothing"), the text for a text (with
 * its laid-out width as the box a `"box"` style wraps at), the nine-slice of its style (outlined
 * when the style sets `debug`, its rim alone when it sets `hollow`; the sprite and the nine-slice
 * blended by the style's `blend`), or a rounded rectangle, a triangle with `shape: "triangle"`, its
 * stroke dashed with `dash`, or an arc with `shape: "arc"`
 * over the `sweep` of its style, ended by its `cap`. A clipping element (`scroll`,
 * `overflow: "hidden"`) keeps the rectangle, which carries the clip; a text field's rectangle
 * clips too, and a nine-slice field draws its slices and clips to them. A style with a stroke and
 * no fill draws only the stroke, a ring. A container with no fill and no stroke gets a rectangle that draws
 * nothing, no fill and no stroke: the renderer hangs children under the display object of their
 * parent, so every parent needs one. It keeps the alpha of its style, because the alpha of an
 * entity fades its children too.
 *
 * @param element - The element to draw, with its rect known.
 * @returns The component values: one visual.
 */
export function visualOf(element: Element): AnyComponentValue[] {
  const { style, type, node, rect } = element;
  const alpha = style.alpha ?? 1;
  const tint = style.tint ?? Sprite.defaults.tint;

  if (type === "image" || type === "icon") {
    const hidden = sizedToNothing(style, rect);

    return [
      Sprite({
        texture: textureOf(node.props),
        tint,
        // Sized to nothing, it draws nothing and, below the hit test's alpha, takes no tap.
        alpha: hidden ? 0 : alpha,
        anchor: { x: 0, y: 0 },
        width: rect.w,
        height: rect.h,
        fit: spriteFitOf(node.props),
        // Only on an image that blended once: a variant that made it glow never leaves it glowing after.
        ...blendOf(element, style.blend)
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
        anchor: { x: 0, y: 0 },
        // The laid-out width, only on a text of a style with `wrap: "box"` that wrapped at its box:
        // any other text carries no box, so a saved or described value has none.
        ...boxOf(element)
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
        debug: style.debug ?? false,
        // A text field framed by slices clips its value to them, so a long one never leaves it.
        clip: type === "input",
        // Only on a panel that was hollow once: a variant that made it hollow never leaves it hollow after.
        ...hollowOf(element, style.hollow),
        ...blendOf(element, style.blend)
      })
    ];
  }

  const filled = style.fill !== undefined || style.stroke !== undefined;
  const invisible = isContainer(type) && !filled;

  const shape = {
    kind: style.shape ?? "rect",
    w: rect.w,
    h: rect.h,
    fill: style.fill ?? Shape.defaults.fill,
    // No `fill` paints nothing inside: a stroke-only ring, or a button whose label is all it shows.
    fillAlpha: style.fill === undefined ? 0 : Shape.defaults.fillAlpha,
    // The alpha fades the children too: a container that draws nothing keeps its style's.
    alpha,
    radius: style.radius ?? 0,
    stroke: style.stroke ?? Shape.defaults.stroke,
    strokeWidth: invisible ? 0 : (style.strokeWidth ?? 0),
    dash: style.dash ?? 0,
    // A text field clips its value to its box, so a long one never leaves it.
    clip: clip || type === "input"
  };

  // An arc writes its share and its ends, both, so the share of an earlier render never stays on it; a rectangle or a
  // triangle writes neither and ignores what an earlier arc left.
  if (shape.kind !== "arc") return [Shape(shape)];

  return [
    Shape({
      ...shape,
      sweep: style.sweep ?? arcDefaults.sweep,
      cap: style.cap ?? arcDefaults.cap
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
 * Scales a rect about the centre of every fitted link of a chain, in order: the way ui draws a
 * `fit: "contain"`. A link with fit 1 leaves the rect alone.
 *
 * @param rect - The natural rect.
 * @param chain - The element and its ancestors, nearest first, each with its rect and fit scale.
 * @returns The drawn rect, a new object.
 * @example
 * ```ts
 * scaleByFits({ x: 0, y: 0, w: 100, h: 100 }, [{ rect: { x: 0, y: 0, w: 100, h: 100 }, fit: 0.5 }]); // { x: 25, y: 25, w: 50, h: 50 }
 * ```
 */
export function scaleByFits(
  rect: Readonly<Rect>,
  chain: readonly { readonly rect: Readonly<Rect>; readonly fit: number }[]
): Rect {
  let drawn: Rect = { ...rect };

  for (const above of chain) {
    if (above.fit === 1) continue;

    const centre = { x: above.rect.x + above.rect.w / 2, y: above.rect.y + above.rect.h / 2 };

    drawn = {
      x: centre.x + above.fit * (drawn.x - centre.x),
      y: centre.y + above.fit * (drawn.y - centre.y),
      w: drawn.w * above.fit,
      h: drawn.h * above.fit
    };
  }

  return drawn;
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
  return scaleByFits(element.rect, chainOf(element, lookup));
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

/**
 * Where a local box of a view lands in root space: moved by the pose, scaled around its pivot.
 * A guide hole is axis-aligned, so the rotation is left out.
 *
 * @param pose - The root pose of the view, `rootPoseOf` of `renderer`.
 * @param local - The box in the view's local units.
 * @returns The rect in root coordinates.
 * @example
 * ```ts
 * drawnRect({ x: 200, y: 200, rotation: 0, scale: 0.8, pivot: { x: 250, y: 250 } },
 *   { x: 50, y: 50, w: 100, h: 100 }); // { x: 40, y: 40, w: 80, h: 80 }
 * ```
 */
export function drawnRect(pose: Readonly<TransformValue>, local: Rect): Rect {
  return {
    x: pose.x + pose.scale * (local.x - pose.pivot.x),
    y: pose.y + pose.scale * (local.y - pose.pivot.y),
    w: local.w * pose.scale,
    h: local.h * pose.scale
  };
}
