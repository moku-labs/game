/**
 * @file ui plugin — the dev hot swap. The footer `@moku-labs/game/hot` appends to a view module
 * hands the module's new exports to `globalThis.__moku_hot`. In a dev build `ui` installs that
 * handler: it swaps components, projections, animations, strings and text styles in their
 * registries, so the screen repaints on the next frame and every component keeps its local
 * state; emitters reach `effects` through the global `ui:hot-swap` event. A module that brings
 * something registered at start is refused with a throw, which Bun turns into a full reload that
 * restores the state.
 */
import type { AnyAnimationDefinition } from "../anim/types";
import type { CompiledMessages } from "../i18n/types";
import type { TextStyles } from "../text/types";
import type { AnyProjectionSpec } from "../world/projection/types";
import { isComponentDefinition } from "./jsx/component";
import type { AnyComponentDefinition, JsxModule } from "./jsx/types";
import type { UiCtx } from "./types";

/** The global the footer of `@moku-labs/game/hot` calls. */
const HOT_GLOBAL = "__moku_hot";

/** A strings module `assets:keys` generates; the group is its locale. */
const STRINGS_FILE = /\/generated\/strings\.([\w-]+)\.ts$/;

/**
 * The `kind` of every value a game registers by value at start: ECS component and tag types
 * (filters too), nodes, slots, flows, asset bundles and plugin owners. Any other `kind` marks
 * data, an effect descriptor or a timeline step, which a node reads through the live binding.
 */
const REGISTERED_KINDS: Readonly<Record<string, true>> = {
  component: true,
  tag: true,
  node: true,
  slot: true,
  flow: true,
  bundles: true,
  plugin: true
};

/** The handler on the global: the new module namespace and the path of the saved module. */
type HotSwap = (next: unknown, file: string) => void;

/** The strings of one locale a regenerated `generated/strings.<locale>.ts` brings. */
type Strings = { locale: string; messages: CompiledMessages };

/**
 * What one saved module swaps, in export order, and its exports for the `ui:hot-swap` event.
 * `emitters` holds ids only: `effects` takes the emitters from the event.
 */
type Swaps = {
  module: Readonly<Record<string, unknown>>;
  components: AnyComponentDefinition[];
  projections: AnyProjectionSpec[];
  animations: AnyAnimationDefinition[];
  emitters: string[];
  strings: Strings[];
  textStyles: TextStyles[];
};

/** Why a saved module cannot be swapped in place. */
type Refusal = { reason: string };

/** The data of the `ui:hot-swap` log line: the file and the names of what was swapped. */
type Summary = {
  file: string;
  components: string[];
  projections: string[];
  animations: string[];
  emitters: string[];
  strings: string[];
  textStyles: string[];
};

/**
 * Tells whether a value carries own members a definition could sit on.
 *
 * @param value - One export of the module.
 * @returns True for an object or a function.
 * @example
 * ```ts
 * hasMembers({ id: "home" }); // true
 * ```
 */
function hasMembers(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/**
 * Tells whether a value is an object, not `null` and not a function.
 *
 * @param value - One export, or one member of it.
 * @returns True for an object.
 * @example
 * ```ts
 * isObject({ rate: 12 }); // true
 * ```
 */
function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * Tells whether a value has an own string member of that name.
 *
 * @param value - One export of the module.
 * @param name - The member asked for.
 * @returns True when the value itself holds a string there.
 * @example
 * ```ts
 * hasOwnString({ kind: "flow" }, "kind"); // true
 * ```
 */
function hasOwnString(value: object, name: string): boolean {
  return Object.hasOwn(value, name) && typeof Reflect.get(value, name) === "string";
}

/**
 * Tells a projection spec from any other export: a string `name` and `layer`, a `from` and a
 * `view`, and a `key` unless `from` returns one plain object.
 *
 * @param value - One export of the module.
 * @returns True when `projection()` built it.
 * @example
 * ```ts
 * isProjectionSpec({ name: "hud", layer: "ui", from: () => ({}), view: () => [] }); // true
 * ```
 */
function isProjectionSpec(value: unknown): value is AnyProjectionSpec {
  if (!isObject(value)) return false;

  const typeOf = (name: keyof AnyProjectionSpec): string => typeof Reflect.get(value, name);
  const hasKeyOrNone = typeOf("key") === "undefined" || typeOf("key") === "function";

  return (
    typeOf("name") === "string" &&
    typeOf("layer") === "string" &&
    typeOf("from") === "function" &&
    typeOf("view") === "function" &&
    hasKeyOrNone
  );
}

/**
 * Tells an animation from any other export: an own string `id`, a `build` function and `slots`.
 *
 * @param value - One export of the module.
 * @returns True when `defineAnimation` built it.
 * @example
 * ```ts
 * isAnimationDefinition({ id: "hud.coinsFly", slots: {}, build: () => [] }); // true
 * ```
 */
function isAnimationDefinition(value: unknown): value is AnyAnimationDefinition {
  return (
    isObject(value) &&
    hasOwnString(value, "id") &&
    typeof Reflect.get(value, "build") === "function" &&
    Object.hasOwn(value, "slots")
  );
}

/**
 * Tells an emitter from any other export: an own string `id` and a `config` object.
 *
 * @param value - One export of the module.
 * @returns True when `defineEmitter` built it.
 * @example
 * ```ts
 * isEmitterDefinition({ id: "fx.steam", config: { rate: 12 } }); // true
 * ```
 */
function isEmitterDefinition(value: unknown): value is { id: string; config: object } {
  return isObject(value) && hasOwnString(value, "id") && isObject(Reflect.get(value, "config"));
}

/**
 * Tells compiled messages from any other export: a record whose values are all functions.
 *
 * @param value - The `default` export of a strings file.
 * @returns True when `assets:keys` wrote it.
 * @example
 * ```ts
 * isCompiledMessages({ "hud.orders": () => [] }); // true
 * ```
 */
function isCompiledMessages(value: unknown): value is CompiledMessages {
  return isObject(value) && Object.values(value).every(message => typeof message === "function");
}

/**
 * Tells text styles from any other export: `kind` `"textStyles"` and a `map`.
 *
 * @param value - One export of the module.
 * @returns True when `defineTextStyles` built it.
 * @example
 * ```ts
 * isTextStyles({ kind: "textStyles", map: {} }); // true
 * ```
 */
function isTextStyles(value: unknown): value is TextStyles {
  return (
    isObject(value) &&
    Reflect.get(value, "kind") === "textStyles" &&
    isObject(Reflect.get(value, "map"))
  );
}

/**
 * Tells whether an export is something the game registers by value at start. An own string
 * `kind` decides alone: a flow, a node, a slot, an ECS component or tag, a filter, bundles or a
 * plugin owner refuse, a descriptor such as `sfx(...)` or a step such as `mark(...)` passes.
 * Without a `kind`, an object with an own string `id` or `name` refuses: a scene, a system, a
 * feature or a plugin. A function without a `kind` passes, since every function has an own `name`.
 *
 * @param value - One export of the module.
 * @returns True when swapping the binding would not reach the running game.
 * @example
 * ```ts
 * isRegisteredAtStart({ kind: "sfx", payload: { key: "ui.pop" } }); // false
 * ```
 */
function isRegisteredAtStart(value: unknown): boolean {
  if (!hasMembers(value)) return false;

  // A kind says what the value is: only the kinds registered at start refuse.
  const kind: unknown = Object.hasOwn(value, "kind") ? Reflect.get(value, "kind") : undefined;

  if (typeof kind === "string") return Object.hasOwn(REGISTERED_KINDS, kind);
  if (typeof value === "function") return false;

  return hasOwnString(value, "id") || hasOwnString(value, "name");
}

/**
 * The locale of a strings file `assets:keys` generates, read from its path with `/` separators.
 *
 * @param file - The path of the saved module.
 * @returns The locale, or `undefined` for any other file.
 * @example
 * ```ts
 * localeOf("/game/generated/strings.ru.ts"); // "ru"
 * ```
 */
function localeOf(file: string): string | undefined {
  return STRINGS_FILE.exec(file.replaceAll("\\", "/"))?.[1];
}

/**
 * Files one export under the kind it is, in the order component, projection, animation, emitter,
 * strings, text styles. The `default` export of a strings file counts as strings.
 *
 * @param swaps - What the module swaps so far.
 * @param entry - The export name and its value.
 * @param locale - The locale of the file when it is a strings file.
 * @returns Why the module is refused when the export is registered at start, else `undefined`.
 */
function fileExport(
  swaps: Swaps,
  entry: [string, unknown],
  locale: string | undefined
): string | undefined {
  const [name, value] = entry;
  const isStrings = name === "default" && locale !== undefined && isCompiledMessages(value);

  // First match wins: component, projection, animation, emitter, strings, text styles, then
  // anything registered at start is refused; any other value swaps nothing.
  if (isComponentDefinition(value)) {
    swaps.components.push(value);
  } else if (isProjectionSpec(value)) {
    swaps.projections.push(value);
  } else if (isAnimationDefinition(value)) {
    swaps.animations.push(value);
  } else if (isEmitterDefinition(value)) {
    swaps.emitters.push(value.id);
  } else if (isStrings) {
    swaps.strings.push({ locale, messages: value });
  } else if (isTextStyles(value)) {
    swaps.textStyles.push(value);
  } else if (isRegisteredAtStart(value)) {
    return `exports "${name}", registered at start`;
  }

  return undefined;
}

/**
 * Sorts the exports of a saved module into what it swaps. Anything else, a style, a token, a
 * number, a plain function, is left alone: Bun already gave the importers the new binding.
 *
 * @param next - The new module namespace, `undefined` when the module did not evaluate.
 * @param file - The path of the saved module.
 * @returns The swaps, or why the module is refused.
 * @example
 * ```ts
 * sortExports({}, "/game/features/hud/view.tsx"); // { reason: "no exports" }
 * ```
 */
function sortExports(next: unknown, file: string): Swaps | Refusal {
  // A syntax error leaves no namespace, and a module with no exports has nothing to swap.
  if (!hasMembers(next)) return { reason: "the module did not evaluate" };

  const exports = Object.entries(next);

  if (exports.length === 0) return { reason: "no exports" };

  // Every export is classified before anything is written, so a refusal changes nothing.
  const locale = localeOf(file);
  const swaps: Swaps = {
    module: Object.fromEntries(exports),
    components: [],
    projections: [],
    animations: [],
    emitters: [],
    strings: [],
    textStyles: []
  };

  for (const entry of exports) {
    const reason = fileExport(swaps, entry, locale);

    if (reason !== undefined) return { reason };
  }

  return swaps;
}

/**
 * The reason of a refused replace: the first line of what it threw, without the `[game] ` prefix
 * and the closing period.
 *
 * @param error - What the replace threw.
 * @returns The reason of the refusal.
 * @example
 * ```ts
 * refusalOf(new Error('[game] Strings for "ru" match no single registered module.\n  Reload.')); // 'Strings for "ru" match no single registered module'
 * ```
 */
function refusalOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message
    .replace(/\n.*/s, "")
    .replace(/^\[game\] /, "")
    .replace(/\.$/, "");
}

/**
 * Refuses the swap: one info entry, then the throw Bun turns into a full reload.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param file - The path of the saved module.
 * @param reason - Why it cannot be swapped in place.
 * @throws {Error} Always, with the file and the reason.
 */
function refuse(ctx: UiCtx, file: string, reason: string): never {
  ctx.log.info("ui:hot-refused", { file, reason });

  throw new Error(
    `[game] Hot swap refused for ${file}: ${reason}.\n  The page reloads and restores its state.`
  );
}

/**
 * Runs one replace that may throw, and turns its throw into a refusal.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param file - The path of the saved module.
 * @param replace - The replace of `world`, `anim` or `i18n`.
 * @throws {Error} When the replace throws.
 */
function replaceOrRefuse(ctx: UiCtx, file: string, replace: () => void): void {
  try {
    replace();
  } catch (error) {
    refuse(ctx, file, refusalOf(error));
  }
}

/**
 * Runs the replaces that may throw, before anything else is written: `world` refuses a new
 * projection or an undeclared layer, `anim` a new animation, `i18n` strings that match no single
 * module. A refusal then writes no component and no text style; a replace before it stands until
 * the reload.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param file - The path of the saved module.
 * @param swaps - What the module swaps.
 * @throws {Error} When one of them is refused.
 */
function replaceRefusable(ctx: UiCtx, file: string, swaps: Swaps): void {
  const { world, anim, i18n } = ctx.deps;

  for (const spec of swaps.projections) {
    replaceOrRefuse(ctx, file, () => world.projection.replace(spec));
  }

  for (const definition of swaps.animations) {
    replaceOrRefuse(ctx, file, () => anim.replace(definition));
  }

  for (const { locale, messages } of swaps.strings) {
    replaceOrRefuse(ctx, file, () => i18n.replace(locale, messages));
  }
}

/**
 * The data of the `ui:hot-swap` log line: the file and the names of what was swapped, the
 * locales of the strings and the names of the text styles.
 *
 * @param file - The path of the saved module.
 * @param swaps - What the module swapped.
 * @returns One list of names per kind.
 */
function summaryOf(file: string, swaps: Swaps): Summary {
  return {
    file,
    components: swaps.components.map(definition => definition.name),
    projections: swaps.projections.map(spec => spec.name),
    animations: swaps.animations.map(definition => definition.id),
    emitters: swaps.emitters,
    strings: swaps.strings.map(strings => strings.locale),
    textStyles: swaps.textStyles.flatMap(styles => Object.keys(styles.map))
  };
}

/**
 * Builds the handler of one app: sort the exports, run the replaces that may throw, write the
 * components and the text styles, and repaint every view. The repaint runs for every module that
 * is not refused, so a module of styles only, whose bindings Bun already patched, shows on the
 * next frame too.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param jsx - The jsx module, which owns the component registry and the roots.
 * @returns The handler the footer calls.
 */
function createSwap(ctx: UiCtx, jsx: JsxModule): HotSwap {
  return (next: unknown, file: string): void => {
    // Refuse a module that brings nothing to swap or something registered at start.
    const sorted = sortExports(next, file);

    if ("reason" in sorted) refuse(ctx, file, sorted.reason);

    // The replaces that may throw come first, so a refusal writes no component.
    replaceRefusable(ctx, file, sorted);

    for (const definition of sorted.components) jsx.replace(definition);
    for (const styles of sorted.textStyles) ctx.deps.text.replaceStyles(styles);

    // Every root and every projection runs its view again on the next frame, same instances.
    jsx.refreshAll();
    ctx.deps.world.projection.rerunAll();
    ctx.deps.time.wake();

    // effects takes its emitters from the event; the editor listens to the log line.
    ctx.emit("ui:hot-swap", { file, module: sorted.module });
    ctx.log.info("ui:hot-swap", summaryOf(file, sorted));
  };
}

/**
 * Installs the hot swap handler of this app on `globalThis.__moku_hot`. `startUi` calls it in a
 * dev build only. A second app on the page takes the global over; the remover deletes it only
 * while it is still this app's handler.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param jsx - The jsx module, which owns the component registry and the roots.
 * @returns The remover, for the cleanups of the plugin state.
 */
export function installHot(ctx: UiCtx, jsx: JsxModule): () => void {
  const swap = createSwap(ctx, jsx);

  Reflect.set(globalThis, HOT_GLOBAL, swap);

  return (): void => {
    if (Reflect.get(globalThis, HOT_GLOBAL) === swap)
      Reflect.deleteProperty(globalThis, HOT_GLOBAL);
  };
}
