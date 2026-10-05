/**
 * @file ui plugin — the dev hot swap. The footer `@moku-labs/game/hot` appends to a view module
 * hands the module's new exports to `globalThis.__moku_hot`. In a dev build `ui` installs that
 * handler: it swaps the component definitions and the projection specs in place, so the screen
 * repaints on the next frame and every component keeps its local state. A module that brings
 * something registered at start is refused with a throw, which Bun turns into a full reload that
 * restores the state.
 */
import type { AnyProjectionSpec } from "../world/projection/types";
import { isComponentDefinition } from "./jsx/component";
import type { AnyComponentDefinition, JsxModule } from "./jsx/types";
import type { UiCtx } from "./types";

/** The global the footer of `@moku-labs/game/hot` calls. */
const HOT_GLOBAL = "__moku_hot";

/** The world message of a replace whose projection no feature registered. */
const NOT_REGISTERED = "is not registered";

/** The handler on the global: the new module namespace and the path of the saved module. */
type HotSwap = (next: unknown, file: string) => void;

/** What one saved module swaps, in export order. */
type Swaps = { components: AnyComponentDefinition[]; projections: AnyProjectionSpec[] };

/** Why a saved module cannot be swapped in place. */
type Refusal = { reason: string };

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
  if (typeof value !== "object" || value === null) return false;

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
 * Tells whether an export is something the game registers by value at start: a scene, an
 * animation, an emitter, a flow, a node, a system, an ECS component, a filter, text styles or a
 * plugin. A function counts by its `kind` only, since every function has an own `name`.
 *
 * @param value - One export of the module.
 * @returns True when swapping the binding would not reach the running game.
 * @example
 * ```ts
 * isRegisteredAtStart({ id: "home", layers: [] }); // true
 * ```
 */
function isRegisteredAtStart(value: unknown): boolean {
  if (!hasMembers(value)) return false;
  if (typeof value === "function") return hasOwnString(value, "kind");

  return hasOwnString(value, "kind") || hasOwnString(value, "id") || hasOwnString(value, "name");
}

/**
 * Sorts the exports of a saved module into what it swaps. Anything else, a style, a token, a
 * number, a plain function, is left alone: Bun already gave the importers the new binding.
 *
 * @param next - The new module namespace, `undefined` when the module did not evaluate.
 * @returns The swaps, or why the module is refused.
 * @example
 * ```ts
 * sortExports({}); // { reason: "no exports" }
 * ```
 */
function sortExports(next: unknown): Swaps | Refusal {
  // A syntax error leaves no namespace, and a module with no exports has nothing to swap.
  if (!hasMembers(next)) return { reason: "the module did not evaluate" };

  const exports = Object.entries(next);

  if (exports.length === 0) return { reason: "no exports" };

  // Every export is classified before anything is written, so a refusal changes nothing.
  const swaps: Swaps = { components: [], projections: [] };

  for (const [name, value] of exports) {
    if (isComponentDefinition(value)) {
      swaps.components.push(value);
    } else if (isProjectionSpec(value)) {
      swaps.projections.push(value);
    } else if (isRegisteredAtStart(value)) {
      return { reason: `exports "${name}", registered at start` };
    }
  }

  return swaps;
}

/**
 * The refusal of a projection `world` would not replace: a new name needs a scene to mount it,
 * anything else keeps the first line of the world's message.
 *
 * @param name - The name of the projection the module exports.
 * @param error - What `world.projection.replace` threw.
 * @returns The reason of the refusal.
 * @example
 * ```ts
 * projectionRefusal("shop", new Error('[game] Projection "shop" is not registered.')); // '"shop" is a new projection, a scene mounts it'
 * ```
 */
function projectionRefusal(name: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes(NOT_REGISTERED)) return `"${name}" is a new projection, a scene mounts it`;

  const [headline = message] = message.split("\n");

  return headline.replace(/^\[game\] /, "").replace(/\.$/, "");
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
 * Hands every projection of the module to `world`, which re-runs a mounted one. Runs before any
 * component is written: `world` refuses a new name or an undeclared layer, and the module is
 * refused whole.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param file - The path of the saved module.
 * @param projections - The projection specs the module exports.
 * @throws {Error} When `world` refuses one of them.
 */
function replaceProjections(
  ctx: UiCtx,
  file: string,
  projections: readonly AnyProjectionSpec[]
): void {
  for (const spec of projections) {
    try {
      ctx.deps.world.projection.replace(spec);
    } catch (error) {
      refuse(ctx, file, projectionRefusal(spec.name, error));
    }
  }
}

/**
 * Builds the handler of one app: sort the exports, replace the projections, then the components,
 * and repaint every view. The repaint runs for every module that is not refused, so a module of
 * styles only, whose bindings Bun already patched, shows on the next frame too.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param jsx - The jsx module, which owns the component registry and the roots.
 * @returns The handler the footer calls.
 */
function createSwap(ctx: UiCtx, jsx: JsxModule): HotSwap {
  return (next: unknown, file: string): void => {
    // Refuse a module that brings nothing to swap or something registered at start.
    const sorted = sortExports(next);

    if ("reason" in sorted) refuse(ctx, file, sorted.reason);

    // Projections first: a refusal from world comes before any component is written.
    replaceProjections(ctx, file, sorted.projections);

    for (const definition of sorted.components) jsx.replace(definition);

    // Every root and every projection runs its view again on the next frame, same instances.
    jsx.refreshAll();
    ctx.deps.world.projection.rerunAll();
    ctx.deps.time.wake();

    ctx.log.info("ui:hot-swap", {
      file,
      components: sorted.components.map(definition => definition.name),
      projections: sorted.projections.map(spec => spec.name)
    });
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
