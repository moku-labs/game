/**
 * @file text plugin — resolution: a `content` becomes one tagged string, a tagged string becomes
 * a cached layout, and the one world system of phase `layout` keeps `Text.resolved`, the measured
 * sizes and `Countdown.left` true; the step after the layout flush does the same for the labels the
 * flush brings. This is also where every dev warning is written once.
 */
import type { ElementNode, Message } from "../i18n/types";
import { system } from "../world/ecs/define";
import type { AnyComponent, AnySystem, Entity } from "../world/ecs/types";
import { builtInStyles, Countdown, Text } from "./components";
import { formatBound, isTextFormat, unitOf, wholeValue } from "./format";
import { layoutRuns } from "./measure";
import { parseTags } from "./tags";
import type {
  FormattedNumber,
  SeenText,
  Size,
  State,
  TextBind,
  TextCtx,
  TextFormat,
  TextFormatAnswer,
  TextFormatFunction,
  TextLayout,
  TextStyle,
  TextValue,
  Warn
} from "./types";

/** Separates the style name from the resolved text in a cache key. No style name holds it. */
const CACHE_SEPARATOR = String.fromCodePoint(0);

/** How many laid-out blocks are kept. The oldest goes when a new one does not fit. */
const CACHE_LIMIT = 1024;

/** How every inline icon tag starts. A resolved text without it holds no icon. */
const ICON_OPEN = "<icon=";

/** The name the system is registered under; it shows up in a world error message. */
export const TEXT_SYSTEM_NAME = "text.resolve";

/**
 * Writes one dev warning per key. Every warning of this plugin goes through here, so a font, a
 * style, a glyph or a bad tag is reported once and never floods a frame.
 *
 * @param ctx - Domain context of the text plugin.
 * @param key - What makes this warning unique.
 * @param message - The log event.
 * @param data - What to log with it.
 */
export function warnOnce(
  ctx: TextCtx,
  key: string,
  message: string,
  data?: Record<string, unknown>
): void {
  if (ctx.state.warned.has(key)) return;

  ctx.state.warned.add(key);
  ctx.log.warn(message, data);
}

/**
 * The warning the pure modules are handed, bound to this app's `warned` set.
 *
 * @param ctx - Domain context of the text plugin.
 * @returns A warning that repeats nothing.
 */
export function warnFor(ctx: TextCtx): Warn {
  return (key, message, data): void => warnOnce(ctx, key, message, data);
}

/**
 * The style behind a name. An unknown name is reported once and drawn as `body`.
 *
 * @param ctx - Domain context of the text plugin.
 * @param name - The style name a component or a caller wrote.
 * @returns The style to measure and draw with.
 */
export function styleOf(ctx: TextCtx, name: string): TextStyle {
  const style = ctx.state.styles.get(name);

  if (style !== undefined) return style;

  warnOnce(ctx, `style:${name}`, "text: unknown style", { style: name });

  return ctx.state.styles.get("body") ?? builtInStyles(ctx.config.fonts).body;
}

/**
 * Tells whether a style wraps at the box of its text element. An unknown name is drawn as `body`,
 * so it answers for `body`. Two map reads, no warning: the frame step asks it.
 *
 * @param ctx - Domain context of the text plugin.
 * @param styleName - The style name a component wrote.
 * @returns True for a style with `wrap: "box"`.
 */
function wrapsAtBox(ctx: TextCtx, styleName: string): boolean {
  const style = ctx.state.styles.get(styleName) ?? ctx.state.styles.get("body");

  return style?.wrap === "box";
}

/**
 * The layout of one resolved string in one style, from the cache or freshly laid out. The cache
 * is what makes `measure` cheap enough for `ui` to ask per invalidation. A `"box"` style with a
 * box is cached per width too; any other style ignores the box and keeps one layout.
 *
 * @param ctx - Domain context of the text plugin.
 * @param resolved - The tagged string.
 * @param styleName - The style name.
 * @param box - The width a `"box"` style wraps at; 0 for one line.
 * @returns The lines and the size of the block.
 */
export function layoutFor(ctx: TextCtx, resolved: string, styleName: string, box = 0): TextLayout {
  const width = box > 0 && wrapsAtBox(ctx, styleName) ? box : 0;
  const key =
    width > 0
      ? `${styleName}${CACHE_SEPARATOR}${width}${CACHE_SEPARATOR}${resolved}`
      : `${styleName}${CACHE_SEPARATOR}${resolved}`;
  const hit = ctx.state.cache.get(key);

  if (hit !== undefined) return hit;

  const warn = warnFor(ctx);
  const runs = parseTags(resolved, warn);
  const layout = layoutRuns(runs, styleOf(ctx, styleName), ctx.state.tables, { warn }, width);

  if (ctx.state.cache.size >= CACHE_LIMIT) {
    const oldest = ctx.state.cache.keys().next().value;

    if (oldest !== undefined) ctx.state.cache.delete(oldest);
  }

  ctx.state.cache.set(key, layout);

  return layout;
}

/**
 * Whether the font of a style has a glyph for one character, the lookup Pixi draws by: a
 * character the font lacks is drawn as nothing and measures 0 wide. While the font is not loaded
 * every character counts, as the fallback measures it.
 *
 * @param ctx - Domain context of the text plugin.
 * @param char - One character.
 * @param styleName - The style name.
 * @returns False only for a character a loaded font has no glyph for.
 */
export function hasGlyphOf(ctx: TextCtx, char: string, styleName: string): boolean {
  const table = ctx.state.tables.get(styleOf(ctx, styleName).font);

  return table === undefined || table.advances.has(char);
}

/**
 * The size of a laid-out block, as `measure` and `ui` read it.
 *
 * @param layout - What `layoutFor` answered.
 * @returns The width and height in reference pixels.
 */
export function sizeOf(layout: TextLayout): Size {
  return { width: layout.width, height: layout.height };
}

/**
 * Tells whether a value is a plain record, so its fields can be read one by one.
 *
 * @param value - A node's props, as another plugin built them.
 * @returns True for a plain object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The asset key of an icon element, when the element is one.
 *
 * @param node - The element a message part carried.
 * @returns The key, or `undefined` for anything else.
 */
function iconName(node: ElementNode): string | undefined {
  if (node.type !== "icon" || !isRecord(node.props)) return undefined;

  const name = node.props.name;

  return typeof name === "string" ? name : undefined;
}

/**
 * Turns what a game wrote into the one tagged string everything below reads: a plain string is
 * taken as it is, a message is formatted in the current locale, and an icon inside a sentence
 * becomes an icon tag. Any other element is reported once and dropped.
 *
 * @param ctx - Domain context of the text plugin.
 * @param content - The `content` of a component, or what a caller handed `measure`.
 * @returns The tagged string.
 */
export function sourceOf(ctx: TextCtx, content: string | Message): string {
  if (typeof content === "string") return content;

  let source = "";

  for (const part of ctx.deps.i18n.format(content)) {
    if (part.kind === "text") {
      source += part.text;

      continue;
    }

    const icon = iconName(part.node);

    if (icon === undefined) {
      warnOnce(ctx, `element:${content.key}:${part.node.type}`, "text: message element dropped", {
        key: content.key,
        element: part.node.type
      });

      continue;
    }

    source += `<icon=${icon}>`;
  }

  return source;
}

/**
 * The world type behind a `bind.component`, cached. A name the world never met is reported once
 * and stays unresolved: a component registers itself on first use, so a name nobody wrote is a
 * typo, not a race.
 *
 * @param ctx - Domain context of the text plugin.
 * @param name - The component name the label binds to.
 * @returns The type, or `undefined`.
 */
function bindTypeOf(ctx: TextCtx, name: string): AnyComponent | undefined {
  if (ctx.state.bindTypes.has(name)) return ctx.state.bindTypes.get(name);

  const type = ctx.deps.world.ecs.typeOf(name);

  if (type === undefined) {
    warnOnce(ctx, `bind-component:${name}`, "text: unknown bind component", { component: name });
  }

  ctx.state.bindTypes.set(name, type);

  return type;
}

/**
 * What one run of the system shares between its labels, and the step after the layout flush with
 * it: the locale, read once at the top of a run, the trusted time, read on the first countdown that
 * asks, so neither is read per label, and the duration formatter, made once with the plugin. `now`
 * is `NaN` until read: the field stays a double, and writing it keeps nothing.
 */
export type TextFrame = { now: number; locale: string; duration: (ms: number) => string };

/**
 * Tells whether a bind shows the time left of a `Countdown`, which is derived, not read.
 *
 * @param bind - What the label carries.
 * @returns True for `bind(Countdown, "left", …)`.
 */
function isCountdownLeft(bind: TextBind): boolean {
  return bind.component === Countdown.componentName && bind.field === "left";
}

/**
 * Reads what a bind points at: the time left until `Countdown.until` for a countdown, the stored
 * field for any other component.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity the label sits on.
 * @param bind - Which component field it shows.
 * @param frame - What this run of the system shares.
 * @returns The value, or `undefined` when the entity has nothing there.
 */
function readBound(ctx: TextCtx, entity: Entity, bind: TextBind, frame: TextFrame): unknown {
  if (isCountdownLeft(bind)) {
    // Per frame: `until` is an epoch moment past the small-integer range, so it is read straight
    // into the subtraction. Joined with `undefined` first (`get(…)?.until`) it is boxed, 16 B.
    const countdown = ctx.deps.world.ecs.get(entity, Countdown);

    if (countdown === undefined || typeof countdown.until !== "number") return undefined;

    if (Number.isNaN(frame.now)) frame.now = ctx.deps.clock.now();

    return Math.max(0, countdown.until - frame.now);
  }

  const type = bindTypeOf(ctx, bind.component);

  return type === undefined ? undefined : ctx.deps.world.ecs.get(entity, type)?.[bind.field];
}

/**
 * Reads the bound number off the entity. A value that is not a number is reported once per
 * entity; an unknown component was already reported by its name.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity the label sits on.
 * @param bind - Which component field it shows.
 * @param frame - What this run of the system shares.
 * @returns The number, or `undefined` when there is none to show.
 */
function boundValue(
  ctx: TextCtx,
  entity: Entity,
  bind: TextBind,
  frame: TextFrame
): number | undefined {
  const value = readBound(ctx, entity, bind, frame);

  if (typeof value === "number") return value;

  if (isCountdownLeft(bind) || ctx.state.bindTypes.get(bind.component) !== undefined) {
    warnOnce(ctx, `bind-field:${entity}`, "text: bound field is not a number", {
      component: bind.component,
      field: bind.field
    });
  }

  return undefined;
}

/**
 * The format a bound value is shown in. An unknown format (a hand-built bind) or a value that is
 * not finite is reported once per entity and shown as `"int"`.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity the label sits on.
 * @param bind - What the label carries.
 * @param value - The bound number.
 * @returns The format to show the value in.
 */
function formatOf(ctx: TextCtx, entity: Entity, bind: TextBind, value: number): TextFormat {
  if (isTextFormat(bind.format) && Number.isFinite(value)) return bind.format;

  warnBadFormat(ctx, entity, bind);

  return "int";
}

/**
 * Reports a bind that names no format, or a value that is not finite, once per entity.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity the label sits on.
 * @param bind - What the label carries.
 */
function warnBadFormat(ctx: TextCtx, entity: Entity, bind: TextBind): void {
  warnOnce(ctx, `bind-format:${entity}`, "text: bad bind format", {
    component: bind.component,
    field: bind.field,
    format: bind.format
  });
}

/**
 * Asks a format a feature registered. A format that throws is reported once per name.
 *
 * @param ctx - Domain context of the text plugin.
 * @param name - The name it was registered under.
 * @param format - The function.
 * @param value - The whole value.
 * @returns What it answered, or `undefined` when it threw.
 */
function askFormat(
  ctx: TextCtx,
  name: string,
  format: TextFormatFunction,
  value: number
): TextFormatAnswer | undefined {
  try {
    return format(value);
  } catch (error) {
    warnOnce(ctx, `bind-format-threw:${name}`, "text: bind format threw", { format: name, error });

    return undefined;
  }
}

/**
 * What a format a feature registered answers for a number, before any label shows it.
 *
 * @param ctx - Domain context of the text plugin.
 * @param name - The format name.
 * @param value - The number; rounded as `"int"` rounds it.
 * @returns The string and the style, or `undefined` for a name no feature registered and for a
 *   format that threw.
 */
export function formattedBy(
  ctx: TextCtx,
  name: string,
  value: number
): FormattedNumber | undefined {
  const format = ctx.state.formats.get(name);
  const answer = format === undefined ? undefined : askFormat(ctx, name, format, wholeValue(value));

  return answer === undefined
    ? undefined
    : { text: sourceOf(ctx, answer.content), style: answer.style };
}

/**
 * The key of a bind, so a changed binding or format is seen as a change. Built once per attached
 * bind object, never per frame: `isSameBind` compares the object first.
 *
 * @param bind - What the component carries.
 * @returns The key, or `undefined` for a label with no bind.
 */
function bindKeyOf(bind: TextBind | undefined): string | undefined {
  return bind === undefined ? undefined : `${bind.component}.${bind.field}:${bind.format}`;
}

/**
 * Tells whether a label carries the bind it was seen with. The same object, or no bind on both
 * sides, is one compare. A new object is keyed once; an equal one is kept as the seen object, so
 * its key is not built again on the next frame.
 *
 * @param seen - What was resolved for the label last.
 * @param bind - What the label carries now.
 * @returns True when the binding and its format stand.
 */
function isSameBind(seen: SeenText, bind: TextBind | undefined): boolean {
  if (seen.bindRef === bind) return true;

  if (seen.bind !== bindKeyOf(bind)) return false;

  seen.bindRef = bind;

  return true;
}

/**
 * Writes down what was resolved for an entity, so the next frame knows whether anything moved.
 * The entry of a label is made once and then overwritten in place.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 * @param frame - What this run of the system shares.
 * @param unit - What a bound label's string was built from; `undefined` for any other label.
 * @param style - The style the label shows: the one a format answered may be newer than `text`.
 */
function remember(
  ctx: TextCtx,
  entity: Entity,
  text: Readonly<TextValue>,
  frame: TextFrame,
  unit?: number,
  style: string = text.style
): void {
  const seen = ctx.state.seen.get(entity);

  if (seen === undefined) {
    ctx.state.seen.set(entity, {
      content: text.content,
      style,
      bindRef: text.bind,
      bind: bindKeyOf(text.bind),
      locale: frame.locale,
      unit,
      box: text.box
    });

    return;
  }

  if (!isSameBind(seen, text.bind)) {
    seen.bindRef = text.bind;
    seen.bind = bindKeyOf(text.bind);
  }

  seen.content = text.content;
  seen.style = style;
  seen.locale = frame.locale;
  seen.unit = unit;
  seen.box = text.box;
}

/**
 * Tells whether a label of a `"box"` style was laid out at another box than it carries now. The
 * box of a label of any other style is only noted: it draws the same at every width, so a resize
 * resolves nothing. A label whose box stands costs one compare.
 *
 * @param ctx - Domain context of the text plugin.
 * @param seen - What was resolved for the label last.
 * @param text - Its component value.
 * @returns True when the label has to be laid out at its new box.
 */
function boxMoved(ctx: TextCtx, seen: SeenText, text: Readonly<TextValue>): boolean {
  if (seen.box === text.box) return false;
  if (wrapsAtBox(ctx, text.style)) return true;

  seen.box = text.box;

  return false;
}

/**
 * Keeps the measured size of a label: made once, then overwritten in place.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param layout - The layout of what the label shows now.
 */
function keepSize(ctx: TextCtx, entity: Entity, layout: TextLayout): void {
  const size = ctx.state.measured.get(entity);

  if (size === undefined) {
    ctx.state.measured.set(entity, sizeOf(layout));

    return;
  }

  size.width = layout.width;
  size.height = layout.height;
}

/**
 * Tells whether a bound label already shows what its value would build: the same unit, style and
 * binding, and for a format whose words depend on the language, the same locale. Reads and
 * compares: no key is built, nothing is kept, no format is called.
 *
 * @param seen - What was resolved for the label last.
 * @param text - Its component value.
 * @param unit - The unit of the value this frame.
 * @param worded - Whether the shown string depends on the locale: a `"duration"` or a named format.
 * @param frame - What this run of the system shares.
 * @returns True when nothing has to be formatted or written.
 */
function isShown(
  seen: SeenText,
  text: Readonly<TextValue>,
  unit: number | undefined,
  worded: boolean,
  frame: TextFrame
): boolean {
  return (
    seen.unit === unit &&
    seen.style === text.style &&
    isSameBind(seen, text.bind) &&
    (!worded || seen.locale === frame.locale)
  );
}

/**
 * Writes the new string of a bound label, its measured size, and for a countdown the time left,
 * in the same step: `changed(Countdown)` fires once per shown change, never per frame.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 * @param next - The string the label shows now.
 * @param value - The bound number, the time left for a countdown.
 * @param style - The style it shows it in: another one only for what a named format answered.
 */
function showBound(
  ctx: TextCtx,
  entity: Entity,
  text: Readonly<TextValue>,
  next: string,
  value: number | undefined,
  style: string = text.style
): void {
  const restyled = style !== text.style;
  const changed = restyled || next !== text.resolved;

  if (changed) {
    ctx.deps.world.ecs.set(entity, Text, restyled ? { resolved: next, style } : { resolved: next });

    if (value !== undefined && text.bind !== undefined && isCountdownLeft(text.bind)) {
      ctx.deps.world.ecs.set(entity, Countdown, { left: value });
    }
  }

  if (changed || !ctx.state.measured.has(entity)) {
    keepSize(ctx, entity, layoutFor(ctx, next, style, text.box));
  }
}

/**
 * Writes the string a bound label already shows once more, and measures it again. A mark on a
 * label whose number stands still means the picture under it moved: its font arrived or was
 * replaced, or its style was swapped. The display adapter rebuilds only what `changed(Text)`
 * names, so the same string is written.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 */
function showAgain(ctx: TextCtx, entity: Entity, text: Readonly<TextValue>): void {
  ctx.deps.world.ecs.set(entity, Text, { resolved: text.resolved });
  keepSize(ctx, entity, layoutFor(ctx, text.resolved, text.style, text.box));
}

/**
 * Reports a bound label whose style is not a digits style, once per style. An unknown style name
 * is not reported here: `styleOf` reports it by its name.
 *
 * @param ctx - Domain context of the text plugin.
 * @param styleName - The style name of the bound label.
 */
function warnWithoutDigits(ctx: TextCtx, styleName: string): void {
  const style = ctx.state.styles.get(styleName);

  if (style === undefined || style.digits) return;

  warnOnce(ctx, `bind-style:${styleName}`, "text: bind on a style without digits", {
    style: styleName
  });
}

/**
 * One frame of a bound label: the value read every frame, the string built and written only
 * when its unit moved. A label that stands still costs a read and a few compares and keeps
 * nothing: no tag is parsed, no key is built. A marked label that stands still is written once
 * with the string it shows; one of a `"box"` style that ui laid out at another box is measured at
 * it. The style is checked for digits only when the label is written, so a label on a wrong style
 * builds no warning key per frame. A bind that names a format a feature registered goes its own
 * way; the name is looked up only after it proved none of the four built-in ones.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 * @param bind - Which component field it shows.
 * @param frame - What this run of the system shares.
 */
function stepBound(
  ctx: TextCtx,
  entity: Entity,
  text: Readonly<TextValue>,
  bind: TextBind,
  frame: TextFrame
): void {
  // The number of this frame, and the unit its string is built from.
  const value = boundValue(ctx, entity, bind, frame);
  const named = isTextFormat(bind.format) ? undefined : ctx.state.formats.get(bind.format);

  if (named !== undefined) {
    stepNamed(ctx, entity, text, bind, named, value, frame);

    return;
  }

  const format = value === undefined ? "int" : formatOf(ctx, entity, bind, value);
  const unit = value === undefined ? undefined : unitOf(value, format);

  // The mark comes off here, whichever way the frame goes.
  const marked = ctx.state.dirty.delete(entity);
  const seen = ctx.state.seen.get(entity);

  // The unit stands still: no string is built. A label that was marked is written once as it is;
  // a label of a `"box"` style that ui laid out at another box is measured at it.
  if (seen !== undefined && isShown(seen, text, unit, format === "duration", frame)) {
    if (marked) warnWithoutDigits(ctx, text.style);

    standStill(ctx, entity, text, seen, marked);

    return;
  }

  // The unit moved: build the string, write it with its size, and remember what it was built from.
  warnWithoutDigits(ctx, text.style);
  const next = value === undefined ? "" : formatBound(value, format, frame.duration);

  showBound(ctx, entity, text, next, value);
  remember(ctx, entity, text, frame, unit);
}

/**
 * One frame of a label whose bind names a format a feature registered. Its unit is the whole value.
 * While that, the locale, the bind and the style stand the frame is reads and compares: the format
 * is not called, a mark included, and nothing is kept. Else it is asked once, and its answer is
 * written only when it differs. The format picks the style, so no style is checked for digits. A
 * bound field that holds no number shows nothing, as under a built-in format.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 * @param bind - What it carries: the name of the format.
 * @param format - The function of the format.
 * @param value - The number of this frame, when there is one.
 * @param frame - What this run of the system shares.
 */
function stepNamed(
  ctx: TextCtx,
  entity: Entity,
  text: Readonly<TextValue>,
  bind: TextBind,
  format: TextFormatFunction,
  value: number | undefined,
  frame: TextFrame
): void {
  if (value !== undefined && !Number.isFinite(value)) warnBadFormat(ctx, entity, bind);

  const unit = value === undefined ? undefined : wholeValue(value);
  const marked = ctx.state.dirty.delete(entity);
  const seen = ctx.state.seen.get(entity);

  if (seen !== undefined && isShown(seen, text, unit, true, frame)) {
    standStill(ctx, entity, text, seen, marked);

    return;
  }

  const answer = unit === undefined ? undefined : askFormat(ctx, bind.format, format, unit);

  if (answer === undefined) {
    // Nothing to ask, or a format that threw: digits, and `Text.style` stays.
    showBound(ctx, entity, text, unit === undefined ? "" : String(unit), value);
    remember(ctx, entity, text, frame, unit);

    return;
  }

  showBound(ctx, entity, text, sourceOf(ctx, answer.content), value, answer.style);
  remember(ctx, entity, text, frame, unit, answer.style);
}

/**
 * One frame of a bound label whose unit stands still: a marked one is written once as it is, one of
 * a `"box"` style that ui laid out at another box is measured at it. Either way the box is noted.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 * @param seen - What was resolved for the label last.
 * @param marked - Whether the label was marked this frame.
 */
function standStill(
  ctx: TextCtx,
  entity: Entity,
  text: Readonly<TextValue>,
  seen: SeenText,
  marked: boolean
): void {
  if (marked) {
    showAgain(ctx, entity, text);
  } else if (boxMoved(ctx, seen, text)) {
    keepSize(ctx, entity, layoutFor(ctx, text.resolved, text.style, text.box));
  } else {
    return;
  }

  seen.box = text.box;
}

/**
 * Tells whether a label has to be resolved again: its content, style, bind or locale moved, or
 * ui laid a label of a `"box"` style out at another box. Change sets are cleared every frame and
 * `ui` writes `Text` after this system, so the comparison is against what was seen, not `changed`.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 * @param frame - What this run of the system shares.
 * @returns True when the string has to be built again.
 */
function isStale(
  ctx: TextCtx,
  entity: Entity,
  text: Readonly<TextValue>,
  frame: TextFrame
): boolean {
  if (ctx.state.dirty.has(entity)) return true;

  const seen = ctx.state.seen.get(entity);

  if (seen === undefined) return true;

  return (
    seen.content !== text.content ||
    seen.style !== text.style ||
    !isSameBind(seen, text.bind) ||
    seen.locale !== frame.locale ||
    boxMoved(ctx, seen, text)
  );
}

/**
 * One frame of one label.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 * @param frame - What this run of the system shares.
 */
function stepText(ctx: TextCtx, entity: Entity, text: Readonly<TextValue>, frame: TextFrame): void {
  if (text.bind !== undefined) {
    stepBound(ctx, entity, text, text.bind, frame);

    return;
  }

  if (!isStale(ctx, entity, text, frame)) return;

  const resolved = resolveContent(ctx, entity, text);

  keepSize(ctx, entity, layoutFor(ctx, resolved, text.style, text.box));
  ctx.state.dirty.delete(entity);
  remember(ctx, entity, text, frame);
}

/**
 * Resolves the content of one label and writes it back when it differs, so `changed(Text)` of
 * this frame reaches the display adapter in phase `sync`.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity the label sits on.
 * @param text - Its component value.
 * @returns The resolved string.
 */
export function resolveContent(ctx: TextCtx, entity: Entity, text: Readonly<TextValue>): string {
  const resolved = sourceOf(ctx, text.content);

  // A dirty label is written even when its string stands still: a font that arrived changes the
  // picture, and the display adapter rebuilds only what `changed(Text)` names.
  if (resolved !== text.resolved || ctx.state.dirty.has(entity)) {
    ctx.deps.world.ecs.set(entity, Text, { resolved });
  }

  return resolved;
}

/**
 * The frame the system and the step after the layout flush share, made once per plugin.
 *
 * @param ctx - Domain context of the text plugin.
 * @returns A frame with no locale and no moment read yet.
 */
export function createTextFrame(ctx: TextCtx): TextFrame {
  // Made once: a formatter made per label would be a closure, and its context, per call.
  return {
    now: Number.NaN,
    locale: "",
    duration: (ms: number): string => ctx.deps.i18n.duration(ms)
  };
}

/**
 * Empties a list of labels in place: popped, so it keeps its store for the next batch.
 *
 * @param labels - The list.
 */
function forgetAdded(labels: Entity[]): void {
  while (labels.length > 0) labels.pop();
}

/** A patch with no field: the write marks `Text` changed and changes nothing. Frozen, so no caller fills it. */
const NO_FIELDS: Partial<TextValue> = Object.freeze({});

/**
 * Writes `Text` once more, with no field, for the labels the step after the last layout flush
 * resolved. `ui` measured them in its solve, before they were resolved, and the change of that
 * frame is gone; this one reaches its remeasure in the same layout phase, so a label whose string
 * measures otherwise than what `ui` measured gets its size. A label whose `Text` left is skipped.
 *
 * @param ctx - Domain context of the text plugin.
 */
function writeOnceMore(ctx: TextCtx): void {
  const ecs = ctx.deps.world.ecs;

  for (const entity of ctx.state.rewrite) {
    if (ecs.get(entity, Text) !== undefined) ecs.set(entity, Text, NO_FIELDS);
  }

  forgetAdded(ctx.state.rewrite);
}

/**
 * Notes a label whose `Text` came, as the world's `onAdded` hook calls it: it is marked for the
 * next layout phase, and while the world is live it is listed for the step after the layout
 * flush. In another mode no layout phase runs and the list would only grow: the label waits for
 * the next live run of the system, which resolves every marked label.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity that got a `Text`.
 */
export function noteAdded(ctx: TextCtx, entity: Entity): void {
  ctx.state.dirty.add(entity);

  if (ctx.deps.world.ecs.mode() === "live") ctx.state.added.push(entity);
}

/**
 * The one system of the plugin: phase `layout`, before the two of `ui`, over every label. Every
 * label is visited every frame: `ui` writes `Text` after this system and change sets clear in
 * phase `signals`, so `changed(Text)` cannot tell which moved. The locale is read once per run,
 * the clock at most once and only when a countdown label asks. The labels that came before the run
 * are in its walk, so the list of the labels that came starts again empty: the step after the
 * layout flush takes only the ones the flush brings. The labels that step resolved last get their
 * `Text` written once more first, so `ui` measures the string they show.
 *
 * @param ctx - Domain context of the text plugin.
 * @param frame - What the runs share with the step after the layout flush.
 * @returns The system definition `world.ecs.system` takes.
 */
export function createTextSystem(ctx: TextCtx, frame: TextFrame): AnySystem {
  return system({
    name: TEXT_SYSTEM_NAME,
    phase: "layout",
    query: [Text],
    run: (entities): void => {
      frame.now = Number.NaN;
      frame.locale = ctx.deps.i18n.locale();
      forgetAdded(ctx.state.added);

      // Per frame: one length read while no label was resolved after the last flush.
      if (ctx.state.rewrite.length > 0) writeOnceMore(ctx);

      // Per frame: the rows are the world's one reused row, read by index, never destructured
      // (a destructuring pattern walks an array iterator) and never kept.
      for (const row of entities) stepText(ctx, row[0], row[1], frame);
    }
  });
}

/**
 * Resolves the labels whose `Text` came or changed after the layout system ran. `ui` adds a label in
 * its solve, and the flush at the end of phase `layout` attaches it with the rest of its batch, a
 * bound component included; this runs right after that flush and before phase `sync`, so the
 * renderer builds the label with its string, and lists it, so the next system run writes its `Text`
 * once more for the remeasure of `ui`. A label whose content or style `ui` changed in its reconcile
 * is resolved here too, in the frame of the change (F45): `ui` measured its content itself, so it is
 * not listed. While the world is not live its layout phase did not run: the list is dropped, and the
 * labels, marked, wait for the next live run, as every label does.
 *
 * @param ctx - Domain context of the text plugin.
 * @param frame - What the system's runs share.
 */
export function resolveAdded(ctx: TextCtx, frame: TextFrame): void {
  const added = ctx.state.added;

  // Per frame: one length read while no label came with the flush. The mode is read only when a
  // label waits: `world` asks the flow for it, which builds its state.
  if (added.length > 0) {
    // The layout phase did not run: the labels are marked, and the next live run resolves them.
    if (ctx.deps.world.ecs.mode() !== "live") {
      added.length = 0;

      return;
    }

    resolveCame(ctx, frame, added);
  }

  resolveChanged(ctx, frame);
}

/**
 * Resolves the labels whose `Text` came with the layout flush, and lists them for the remeasure.
 *
 * @param ctx - Domain context of the text plugin.
 * @param frame - What the system's runs share.
 * @param added - The labels that came.
 */
function resolveCame(ctx: TextCtx, frame: TextFrame, added: Entity[]): void {
  frame.now = Number.NaN;
  frame.locale = ctx.deps.i18n.locale();

  // A label whose `Text` left again in the same flush is skipped.
  for (const entity of added) {
    const text = ctx.deps.world.ecs.get(entity, Text);

    if (text === undefined) continue;

    stepText(ctx, entity, text, frame);
    ctx.state.rewrite.push(entity);
  }

  forgetAdded(added);
}

/**
 * Resolves the labels of this frame's `changed(Text)` whose content or style moved since they were
 * resolved: `ui` writes `Text` after the layout system. The labels this frame resolved already
 * stand on what they show; a bound label shows its value, as in the system.
 *
 * @param ctx - Domain context of the text plugin.
 * @param frame - What the system's runs share; the locale of this frame is already in it.
 */
function resolveChanged(ctx: TextCtx, frame: TextFrame): void {
  const ecs = ctx.deps.world.ecs;
  let live = false;

  // Per frame: the world's own change list, walked in place; empty on a still frame.
  for (const entity of ecs.changed(Text)) {
    const text = ecs.get(entity, Text);

    if (text === undefined || !isStale(ctx, entity, text, frame)) continue;

    // A world that is not live ran no layout phase: the next live run of the system resolves it.
    if (!live && ecs.mode() !== "live") return;

    live = true;
    stepText(ctx, entity, text, frame);
  }
}

/**
 * Marks labels for the next layout phase: every one of them, or only the ones `keep` names. A
 * locale change names the labels whose content is a message; a dev hot swap names the labels
 * drawn with a replaced font or icon.
 *
 * @param ctx - Domain context of the text plugin.
 * @param keep - Tells whether a label is marked. Left out, every label is.
 * @returns How many labels were marked.
 */
export function markDirty(
  ctx: TextCtx,
  keep: (text: Readonly<TextValue>) => boolean = () => true
): number {
  let marked = 0;

  for (const [entity, text] of ctx.deps.world.ecs.query(Text)) {
    if (!keep(text)) continue;

    ctx.state.dirty.add(entity);
    marked += 1;
  }

  return marked;
}

/**
 * Tells whether a label is drawn with one of the asset keys: a font its style names, or an inline
 * icon of its resolved text. The text is read through the tag grammar, the way it is drawn, so an
 * escaped `\<icon=…>` is text and not an icon. A text that holds no `<icon=` at all is not read:
 * most labels have no icon, and this runs for every label of a swap.
 *
 * @param ctx - Domain context of the text plugin.
 * @param text - The component value of the label.
 * @param keys - The asset keys to look for.
 * @returns True when a glyph font or an icon of the label is one of `keys`.
 */
export function drawsWith(
  ctx: TextCtx,
  text: Readonly<TextValue>,
  keys: readonly string[]
): boolean {
  const style = styleOf(ctx, text.style);
  const fonts = [style.font, style.bold, style.italic];

  if (fonts.some(font => font !== undefined && keys.includes(font))) return true;

  // Every icon tag holds these characters, so the guard hides no icon. An escaped `\<icon=…>`
  // holds them too and goes on to the grammar, which reads it as text.
  if (!text.resolved.includes(ICON_OPEN)) return false;

  return parseTags(text.resolved, warnFor(ctx)).some(
    run => run.kind === "icon" && keys.includes(run.key)
  );
}

/**
 * Forgets an entity whose `Text` left. Works on the state alone, because it is also what the
 * world hook of `onRemoved` calls.
 *
 * @param state - The plugin state.
 * @param entity - The entity that lost its label.
 */
export function forgetText(state: State, entity: Entity): void {
  state.seen.delete(entity);
  state.measured.delete(entity);
  state.dirty.delete(entity);
}
