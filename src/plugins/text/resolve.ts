/**
 * @file text plugin — resolution: a `content` becomes one tagged string, a tagged string becomes
 * a cached layout, and the one world system of phase `layout` keeps `Text.resolved`, the measured
 * sizes and `Countdown.left` true. This is also where every dev warning is written once.
 */
import type { ElementNode, Message } from "../i18n/types";
import { system } from "../world/ecs/define";
import type { AnyComponent, AnySystem, Entity } from "../world/ecs/types";
import { builtInStyles, Countdown, Text } from "./components";
import { formatBound, isTextFormat, unitOf } from "./format";
import { layoutRuns } from "./measure";
import { parseTags } from "./tags";
import type {
  Size,
  State,
  TextBind,
  TextCtx,
  TextFormat,
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
 * The layout of one resolved string in one style, from the cache or freshly laid out. The cache
 * is what makes `measure` cheap enough for `ui` to ask per invalidation.
 *
 * @param ctx - Domain context of the text plugin.
 * @param resolved - The tagged string.
 * @param styleName - The style name.
 * @returns The lines and the size of the block.
 */
export function layoutFor(ctx: TextCtx, resolved: string, styleName: string): TextLayout {
  const key = `${styleName}${CACHE_SEPARATOR}${resolved}`;
  const hit = ctx.state.cache.get(key);

  if (hit !== undefined) return hit;

  const warn = warnFor(ctx);
  const layout = layoutRuns(parseTags(resolved, warn), styleOf(ctx, styleName), ctx.state.tables, {
    warn
  });

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
 * What one run of the system shares between its labels: the trusted time, read on the first
 * countdown that asks and reset at the top of every run, so the clock is read at most once a frame.
 */
type Frame = { now: number | undefined };

/**
 * The trusted time of this frame, read from `clock` on the first call of the run.
 *
 * @param ctx - Domain context of the text plugin.
 * @param frame - What this run of the system shares.
 * @returns The current moment in epoch milliseconds.
 */
function frameNow(ctx: TextCtx, frame: Frame): number {
  frame.now ??= ctx.deps.clock.now();

  return frame.now;
}

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
function readBound(ctx: TextCtx, entity: Entity, bind: TextBind, frame: Frame): unknown {
  if (isCountdownLeft(bind)) {
    const until = ctx.deps.world.ecs.get(entity, Countdown)?.until;

    return typeof until === "number" ? Math.max(0, until - frameNow(ctx, frame)) : undefined;
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
  frame: Frame
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

  warnOnce(ctx, `bind-format:${entity}`, "text: bad bind format", {
    component: bind.component,
    field: bind.field,
    format: bind.format
  });

  return "int";
}

/**
 * The key of a bind, so a changed binding or format is seen as a change.
 *
 * @param bind - What the component carries.
 * @returns The key, or `undefined` for a label with no bind.
 */
function bindKeyOf(bind: TextBind | undefined): string | undefined {
  return bind === undefined ? undefined : `${bind.component}.${bind.field}:${bind.format}`;
}

/**
 * Writes down what was resolved for an entity, so the next frame knows whether anything moved.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 * @param unit - What a bound label's string was built from; `undefined` for any other label.
 */
function remember(ctx: TextCtx, entity: Entity, text: Readonly<TextValue>, unit?: number): void {
  ctx.state.seen.set(entity, {
    content: text.content,
    style: text.style,
    bind: bindKeyOf(text.bind),
    locale: ctx.deps.i18n.locale(),
    unit
  });
}

/**
 * Tells whether a bound label already shows what its value would build: the same unit, style and
 * binding, and for a `"duration"` the same locale.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 * @param unit - The unit of the value this frame.
 * @param format - The format it is shown in.
 * @returns True when nothing has to be formatted or written.
 */
function isShown(
  ctx: TextCtx,
  entity: Entity,
  text: Readonly<TextValue>,
  unit: number | undefined,
  format: TextFormat
): boolean {
  const seen = ctx.state.seen.get(entity);

  return (
    seen !== undefined &&
    seen.unit === unit &&
    seen.style === text.style &&
    seen.bind === bindKeyOf(text.bind) &&
    (format !== "duration" || seen.locale === ctx.deps.i18n.locale())
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
 */
function showBound(
  ctx: TextCtx,
  entity: Entity,
  text: Readonly<TextValue>,
  next: string,
  value: number | undefined
): void {
  const changed = next !== text.resolved;

  if (changed) {
    ctx.deps.world.ecs.set(entity, Text, { resolved: next });

    if (value !== undefined && text.bind !== undefined && isCountdownLeft(text.bind)) {
      ctx.deps.world.ecs.set(entity, Countdown, { left: value });
    }
  }

  if (changed || !ctx.state.measured.has(entity)) {
    ctx.state.measured.set(entity, sizeOf(layoutFor(ctx, next, text.style)));
  }
}

/**
 * Keeps `seen` of a bound label in step. Nothing is allocated while the binding stands: the
 * entry is updated in place.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 * @param unit - What the shown string was built from.
 */
function rememberBound(
  ctx: TextCtx,
  entity: Entity,
  text: Readonly<TextValue>,
  unit: number | undefined
): void {
  const seen = ctx.state.seen.get(entity);

  if (seen === undefined || seen.style !== text.style || seen.bind !== bindKeyOf(text.bind)) {
    remember(ctx, entity, text, unit);

    return;
  }

  seen.unit = unit;
  seen.locale = ctx.deps.i18n.locale();
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
  ctx.state.measured.set(entity, sizeOf(layoutFor(ctx, text.resolved, text.style)));
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
 * when its unit moved. A label that stands still costs a read and a few compares; no tag is
 * parsed, and the locale is read only for a `"duration"`. A marked label that stands still is
 * written once with the string it shows.
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
  frame: Frame
): void {
  warnWithoutDigits(ctx, text.style);

  // The number of this frame, and the unit its string is built from.
  const value = boundValue(ctx, entity, bind, frame);
  const format = value === undefined ? "int" : formatOf(ctx, entity, bind, value);
  const unit = value === undefined ? undefined : unitOf(value, format);

  // The mark comes off here, whichever way the frame goes.
  const marked = ctx.state.dirty.delete(entity);

  // The unit stands still: no string is built. A label that was marked is written once as it is.
  if (isShown(ctx, entity, text, unit, format)) {
    if (marked) showAgain(ctx, entity, text);

    return;
  }

  // The unit moved: build the string, write it with its size, and remember what it was built from.
  const next =
    value === undefined ? "" : formatBound(value, format, ms => ctx.deps.i18n.duration(ms));

  showBound(ctx, entity, text, next, value);
  rememberBound(ctx, entity, text, unit);
}

/**
 * Tells whether a label has to be resolved again. Change sets are cleared every frame and `ui`
 * writes `Text` after this system, so the comparison is against what was seen, not `changed`.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 * @returns True when the string has to be built again.
 */
function isStale(ctx: TextCtx, entity: Entity, text: Readonly<TextValue>): boolean {
  if (ctx.state.dirty.has(entity)) return true;

  const seen = ctx.state.seen.get(entity);

  if (seen === undefined) return true;

  return (
    seen.content !== text.content ||
    seen.style !== text.style ||
    seen.bind !== bindKeyOf(text.bind) ||
    seen.locale !== ctx.deps.i18n.locale()
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
function stepText(ctx: TextCtx, entity: Entity, text: Readonly<TextValue>, frame: Frame): void {
  if (text.bind !== undefined) {
    stepBound(ctx, entity, text, text.bind, frame);

    return;
  }

  if (!isStale(ctx, entity, text)) return;

  const resolved = resolveContent(ctx, entity, text);

  ctx.state.measured.set(entity, sizeOf(layoutFor(ctx, resolved, text.style)));
  ctx.state.dirty.delete(entity);
  remember(ctx, entity, text);
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
 * The one system of the plugin: phase `layout`, before the two of `ui`, over every label. The
 * clock is read at most once per run, and only when a countdown label asks.
 *
 * @param ctx - Domain context of the text plugin.
 * @returns The system definition `world.ecs.system` takes.
 */
export function createTextSystem(ctx: TextCtx): AnySystem {
  const frame: Frame = { now: undefined };

  return system({
    name: TEXT_SYSTEM_NAME,
    phase: "layout",
    query: [Text],
    run: (entities): void => {
      frame.now = undefined;

      for (const [entity, text] of entities) stepText(ctx, entity, text, frame);
    }
  });
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
