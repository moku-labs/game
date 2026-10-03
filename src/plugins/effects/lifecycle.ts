/**
 * @file effects plugin — lifecycle: the dependency resolution, the start that reads every feature,
 * registers the filter kinds and opens the two systems and the world hooks, and the teardown that
 * frees every container, filter and uniform buffer from state.
 */
import { animPlugin } from "../anim";
import { assetsPlugin } from "../assets";
import { flowPlugin } from "../flow";
import { rendererPlugin } from "../renderer";
import { worldPlugin } from "../world";
import type { ComponentHandle } from "../world/types";
import { builtInKinds } from "./filters/builtins";
import { createFilterSystem, forgetFilter, retireAllFilters, trackFilter } from "./filters/system";
import type { FilterDefinition, FilterFields, FilterKind, KindEntry } from "./filters/types";
import { Emitter } from "./particles/component";
import { createParticleSystem, forgetEmitter, retireAllParticles } from "./particles/system";
import type { EmitterDefinition } from "./particles/types";
import type { EffectsCtx, KernelSlice, State } from "./types";

/** The short side, in CSS pixels, at or under which a coarse pointer is a phone. */
const PHONE_SIDE = 820;

/** A feature entry that is a filter component made by `defineFilter`. */
type FilterComponentLike = ComponentHandle<FilterFields> & { readonly filter: FilterDefinition };

/** The valid entry of each feature key `effects` reads. */
type FeatureEntryOf = { emitters: EmitterDefinition; filters: FilterComponentLike };

/**
 * Reads one property of a value a feature brought, whatever its type.
 *
 * @param target - The value.
 * @param name - The property.
 * @returns Its value.
 */
function read(target: object, name: string): unknown {
  return Reflect.get(target, name);
}

/**
 * Tells whether a feature entry is an emitter made by `defineEmitter`.
 *
 * @param entry - What the feature put in its `emitters` list.
 * @returns True when it carries an id and a config with textures.
 */
function isEmitterDefinition(entry: unknown): entry is EmitterDefinition {
  if (typeof entry !== "object" || entry === null) return false;

  const config = read(entry, "config");

  return (
    typeof read(entry, "id") === "string" &&
    typeof config === "object" &&
    config !== null &&
    Array.isArray(read(config, "textures"))
  );
}

/**
 * Tells whether a feature entry is a filter component made by `defineFilter`.
 *
 * @param entry - What the feature put in its `filters` list.
 * @returns True when it is a component type with an assembled filter.
 */
function isFilterComponent(entry: unknown): entry is FilterComponentLike {
  if (typeof entry !== "function") return false;

  const filter = read(entry, "filter");

  return (
    typeof read(entry, "componentName") === "string" &&
    read(entry, "kind") === "component" &&
    typeof filter === "object" &&
    filter !== null &&
    typeof read(filter, "id") === "string" &&
    typeof read(filter, "source") === "string" &&
    Array.isArray(read(filter, "uniforms"))
  );
}

/** The check of each feature key `effects` reads. */
const entryChecks: {
  readonly [Key in keyof FeatureEntryOf]: (entry: unknown) => entry is FeatureEntryOf[Key];
} = { emitters: isEmitterDefinition, filters: isFilterComponent };

/**
 * Yields the valid entries of one key of every feature, in feature order, and logs
 * `effects:bad-feature-entry` for each entry that fails its check. It yields lazily, so a warning
 * and a throw of the caller come in the order of the entries.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param key - The feature key: `emitters` or `filters`.
 * @yields {FeatureEntryOf[Key]} Each valid entry.
 */
function* featureEntries<Key extends keyof FeatureEntryOf>(
  ectx: EffectsCtx,
  key: Key
): Generator<FeatureEntryOf[Key]> {
  const isEntry = entryChecks[key];

  for (const feature of ectx.deps.flow.features.all()) {
    for (const entry of feature.description[key] ?? []) {
      if (isEntry(entry)) yield entry;
      else ectx.log.warn("effects:bad-feature-entry", { feature: feature.name });
    }
  }
}

/**
 * Resolves the dependency APIs `flow`, `world`, `renderer`, `assets` and `anim` onto the kernel
 * context.
 *
 * @param ctx - Kernel context of the effects plugin.
 * @returns The domain context of the effects plugin.
 */
export function withDeps(ctx: KernelSlice): EffectsCtx {
  return {
    ...ctx,
    deps: {
      flow: ctx.require(flowPlugin),
      world: ctx.require(worldPlugin),
      renderer: ctx.require(rendererPlugin),
      assets: ctx.require(assetsPlugin),
      anim: ctx.require(animPlugin)
    }
  };
}

/**
 * Whether this device is a phone. `"auto"` reads a coarse pointer and a short side of at most
 * 820 CSS px, once; where there is no window it is false.
 *
 * @param setting - `config.phone`.
 * @returns True on a phone.
 * @example
 * ```ts
 * resolvePhone("auto"); // false under plain Bun: there is no window
 * ```
 */
export function resolvePhone(setting: boolean | "auto"): boolean {
  if (typeof setting === "boolean") return setting;

  if (typeof globalThis.window === "undefined" || typeof globalThis.matchMedia !== "function") {
    return false;
  }

  return (
    globalThis.matchMedia("(pointer: coarse)").matches &&
    Math.min(globalThis.innerWidth, globalThis.innerHeight) <= PHONE_SIDE
  );
}

/**
 * Reads the `emitters` of every feature, in feature order.
 *
 * @param ectx - Domain context of the effects plugin.
 * @throws {Error} When two features register the same emitter id.
 */
function registerEmitters(ectx: EffectsCtx): void {
  for (const entry of featureEntries(ectx, "emitters")) {
    // One emitter per id over every feature.
    if (ectx.state.emitters.has(entry.id)) {
      throw new Error(
        `[game] Emitter "${entry.id}" is registered twice.\n  Keep one defineEmitter per id.`
      );
    }

    ectx.state.emitters.set(entry.id, entry);
  }
}

/**
 * Registers the filter kinds: the built-ins first, then the `filters` of every feature in
 * feature order. The order is each kind's `index`, the tie-break of the filters on a view.
 *
 * @param ectx - Domain context of the effects plugin.
 * @throws {Error} When a filter id is registered twice or is the id of a built-in.
 */
function registerKinds(ectx: EffectsCtx): void {
  const builtIns = builtInKinds();
  const entries: KindEntry[] = [...builtIns];

  for (const entry of featureEntries(ectx, "filters")) {
    const id = entry.filter.id;

    // A game's filter takes neither the id of a built-in nor an id another filter took.
    if (builtIns.some(kind => kind.id === id)) {
      throw new Error(`[game] Filter "${id}" is built in.\n  Choose another id.`);
    }

    if (entries.some(kind => kind.id === id)) {
      throw new Error(
        `[game] Filter "${id}" is registered twice.\n  Keep one defineFilter per id.`
      );
    }

    entries.push({ id, component: entry, source: "wgsl", definition: entry.filter });
  }

  // The registration order is each kind's index.
  for (const [index, entry] of entries.entries())
    ectx.state.kinds.set(entry.id, { ...entry, index });
}

/**
 * Opens the world side: the two systems, the hook that retires an emitter's instance, and the two
 * hooks per filter kind; then records the filter components that are on entities already.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param kinds - The registered kinds.
 */
function openWorld(ectx: EffectsCtx, kinds: readonly FilterKind[]): void {
  const ecs = ectx.deps.world.ecs;

  ectx.state.removers.push(
    ecs.system(createParticleSystem(ectx)),
    ecs.system(createFilterSystem(ectx)),
    ecs.onRemoved(Emitter, entity => forgetEmitter(ectx, entity)),
    ...kinds.map(kind => ecs.onRemoved(kind.component, entity => forgetFilter(ectx, kind, entity))),
    ...kinds.map(kind => ecs.onAdded(kind.component, entity => trackFilter(ectx, kind, entity)))
  );

  for (const kind of kinds) {
    for (const [entity] of ecs.query(kind.component)) trackFilter(ectx, kind, entity);
  }
}

/**
 * Starts the plugin in `onStart`. The teardown closure goes first into `state.removers`, because
 * a teardown context carries no `ctx`: it captures the world and the renderer here. Then the
 * phone, the kinds, the emitters and the world side. Every definition is checked even headless.
 *
 * @param ctx - Kernel context of the effects plugin.
 */
export function startEffects(ctx: KernelSlice): void {
  const ectx = withDeps(ctx);
  const { state } = ectx;

  state.removers.push(() => {
    retireAllParticles(ectx);
    retireAllFilters(ectx);
  });
  state.phone = resolvePhone(ctx.config.phone);
  registerKinds(ectx);
  registerEmitters(ectx);
  openWorld(ectx, [...state.kinds.values()]);
}

/**
 * Frees what `onStart` opened, from state alone: the teardown closure destroys every container,
 * orphan, filter and uniform buffer while `world` and `renderer` still run (they stop after
 * `effects`), then the systems and the hooks are removed and every table is emptied.
 *
 * @param state - The plugin state, all a teardown context carries.
 */
export function stopEffects(state: State): void {
  for (const remove of state.removers.splice(0)) remove();

  state.emitters.clear();
  state.baked.clear();
  state.instances.clear();
  state.orphans.clear();
  state.broken.clear();
  state.kinds.clear();
  state.checks.clear();
  state.views.clear();
  state.warned.clear();
  state.particles = 0;
  state.over = { particles: false, passes: false, fullScreen: false };
}
