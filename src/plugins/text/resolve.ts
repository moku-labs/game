/**
 * @file text plugin — resolution: a `content` becomes one tagged string, a tagged string becomes
 * a cached layout, and the one world system of phase `layout` keeps `Text.resolved` and the
 * measured sizes true. This is also where every dev warning is written once.
 */
import type { ElementNode, Message } from "../i18n/types";
import { system } from "../world/ecs/define";
import type { AnyComponent, AnySystem, Entity } from "../world/ecs/types";
import { builtInStyles, Text } from "./components";
import { layoutRuns } from "./measure";
import { parseTags } from "./tags";
import type {
  Size,
  State,
  TextBind,
  TextCtx,
  TextLayout,
  TextStyle,
  TextValue,
  Warn
} from "./types";

/** Separates the style name from the resolved text in a cache key. No style name holds it. */
const CACHE_SEPARATOR = String.fromCodePoint(0);

/** How many laid-out blocks are kept. The oldest goes when a new one does not fit. */
const CACHE_LIMIT = 1024;

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
    missingGlyph: ctx.config.missingGlyph,
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
 * Reads the bound number off the entity.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity the label sits on.
 * @param bind - Which component field it shows.
 * @returns The number, or `undefined` when there is none to show.
 */
function boundValue(ctx: TextCtx, entity: Entity, bind: TextBind): number | undefined {
  const type = bindTypeOf(ctx, bind.component);

  if (type === undefined) return undefined;

  const stored = ctx.deps.world.ecs.get(entity, type);
  const value = stored?.[bind.field];

  if (typeof value !== "number") {
    warnOnce(ctx, `bind-field:${entity}`, "text: bound field is not a number", {
      component: bind.component,
      field: bind.field
    });

    return undefined;
  }

  return value;
}

/**
 * The key of a bind, so a changed binding is seen as a change.
 *
 * @param bind - What the component carries.
 * @returns The key, or `undefined` for a label with no bind.
 */
function bindKeyOf(bind: TextBind | undefined): string | undefined {
  return bind === undefined ? undefined : `${bind.component}.${bind.field}`;
}

/**
 * Writes down what was resolved for an entity, so the next frame knows whether anything moved.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 */
function remember(ctx: TextCtx, entity: Entity, text: Readonly<TextValue>): void {
  ctx.state.seen.set(entity, {
    content: text.content,
    style: text.style,
    bind: bindKeyOf(text.bind),
    locale: ctx.deps.i18n.locale()
  });
}

/**
 * One frame of a bound label: the rounded field, read every frame, written only when it moved.
 * No locale is read and no tag is parsed here.
 *
 * @param ctx - Domain context of the text plugin.
 * @param entity - The entity.
 * @param text - Its component value.
 * @param bind - Which component field it shows.
 */
function stepBound(ctx: TextCtx, entity: Entity, text: Readonly<TextValue>, bind: TextBind): void {
  const style = ctx.state.styles.get(text.style);

  if (style !== undefined && !style.digits) {
    warnOnce(ctx, `bind-style:${text.style}`, "text: bind on a style without digits", {
      style: text.style
    });
  }

  const value = boundValue(ctx, entity, bind);
  const next = value === undefined ? "" : String(Math.round(value));

  if (next !== text.resolved) ctx.deps.world.ecs.set(entity, Text, { resolved: next });
  if (next !== text.resolved || !ctx.state.measured.has(entity)) {
    ctx.state.measured.set(entity, sizeOf(layoutFor(ctx, next, text.style)));
  }

  ctx.state.dirty.delete(entity);

  // A bound label allocates nothing while the number stands still: `seen` moves with the binding.
  const seen = ctx.state.seen.get(entity);

  if (seen === undefined || seen.style !== text.style || seen.bind !== bindKeyOf(bind)) {
    remember(ctx, entity, text);
  }
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
 */
function stepText(ctx: TextCtx, entity: Entity, text: Readonly<TextValue>): void {
  if (text.bind !== undefined) {
    stepBound(ctx, entity, text, text.bind);

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
 * The one system of the plugin: phase `layout`, before the two of `ui`, over every label.
 *
 * @param ctx - Domain context of the text plugin.
 * @returns The system definition `world.ecs.system` takes.
 */
export function createTextSystem(ctx: TextCtx): AnySystem {
  return system({
    name: TEXT_SYSTEM_NAME,
    phase: "layout",
    query: [Text],
    run: (entities): void => {
      for (const [entity, text] of entities) stepText(ctx, entity, text);
    }
  });
}

/**
 * Marks labels for the next layout phase: every one of them, or only the ones whose content is a
 * message, which is what a locale change touches.
 *
 * @param ctx - Domain context of the text plugin.
 * @param onlyMessages - True to leave the plain strings alone.
 */
export function markDirty(ctx: TextCtx, onlyMessages = false): void {
  for (const [entity, text] of ctx.deps.world.ecs.query(Text)) {
    if (onlyMessages && typeof text.content === "string") continue;

    ctx.state.dirty.add(entity);
  }
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
