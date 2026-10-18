/**
 * @file world plugin — lifecycle functions: dependency resolution, the `onStart` wiring and the
 * teardown that empties the world.
 */
import { clockPlugin } from "../clock";
import { flowPlugin } from "../flow";
import type { FeatureDescription } from "../flow/types";
import { modelPlugin } from "../model";
import { timePlugin } from "../time";
import { createModules } from "./api";
import { Now } from "./ecs/define";
import { recordFrame, resetHistory } from "./ecs/history";
import { openScope, reportNeverActive, resetScope, scopeOf } from "./ecs/scope";
import { registerType } from "./ecs/storage";
import { registerSystem, startTiming } from "./ecs/systems";
import type { AnyComponentType, AnySystem } from "./ecs/types";
import type { AnyProjectionSpec } from "./projection/types";
import type { Deps, KernelSlice, ProjectionModule, State, WorldCtx } from "./types";

/**
 * Resolves the dependency APIs `time`, `model`, `flow` and `clock` with `ctx.require`.
 *
 * @param ctx - Kernel context of the world plugin.
 * @returns The four dependency APIs.
 */
export function resolveDeps(ctx: KernelSlice): Deps {
  return {
    time: ctx.require(timePlugin),
    model: ctx.require(modelPlugin),
    flow: ctx.require(flowPlugin),
    clock: ctx.require(clockPlugin)
  };
}

/**
 * Builds the domain context the two modules share.
 *
 * @param ctx - Kernel context of the world plugin.
 * @returns The domain context of the world plugin.
 */
export function withDeps(ctx: KernelSlice): WorldCtx {
  return { ...ctx, deps: resolveDeps(ctx) };
}

/**
 * Reads one list out of a feature description. A key a feature did not bring is an empty list.
 *
 * @param description - What the feature registered.
 * @param key - Which list to read.
 * @returns The entries, or an empty list.
 */
function listOf(description: FeatureDescription, key: string): readonly unknown[] {
  const value = description[key];

  return Array.isArray(value) ? value : [];
}

/**
 * Reads one own property of a value that may be anything. A component type is a function, a
 * system and a projection are plain objects, so both shapes are accepted.
 *
 * @param entry - What the feature put in the list.
 * @param key - The property to read.
 * @returns The value, or `undefined` when the entry cannot carry it.
 * @example
 * ```ts
 * fieldOf({ name: "drift" }, "name"); // "drift"
 * fieldOf(7, "name"); // undefined
 * ```
 */
function fieldOf(entry: unknown, key: string): unknown {
  if (entry === null) return undefined;
  if (typeof entry !== "object" && typeof entry !== "function") return undefined;

  return Object.getOwnPropertyDescriptor(entry, key)?.value;
}

/**
 * Tells whether an entry is a component type made by `component()` or `tag()`.
 *
 * @param entry - What the feature put in the `components` list.
 * @returns True when it carries a storage name.
 */
function isComponentEntry(entry: unknown): entry is AnyComponentType {
  return typeof fieldOf(entry, "componentName") === "string";
}

/**
 * Tells whether an entry is a system definition.
 *
 * @param entry - What the feature put in the `systems` list.
 * @returns True when it carries a name and a `run`.
 */
function isSystemEntry(entry: unknown): entry is AnySystem {
  return typeof fieldOf(entry, "name") === "string" && typeof fieldOf(entry, "run") === "function";
}

/**
 * Tells whether an entry is a projection spec.
 *
 * @param entry - What the feature put in the `projections` list.
 * @returns True when it carries a name and a `view`.
 */
function isProjectionEntry(entry: unknown): entry is AnyProjectionSpec {
  return typeof fieldOf(entry, "name") === "string" && typeof fieldOf(entry, "view") === "function";
}

/**
 * Registers one list of one feature. An entry of the wrong shape is reported and skipped, so a
 * typo in a feature description costs that entry and not the whole start.
 *
 * @param ctx - Domain context of the world plugin.
 * @param feature - The feature and what it registered.
 * @param feature.name - Feature name, for the log entry.
 * @param feature.description - What the feature brought.
 * @param key - Which list to read.
 * @param accepts - The shape guard of this list.
 * @param register - What to do with an accepted entry.
 */
function registerEach<Entry>(
  ctx: WorldCtx,
  feature: { name: string; description: FeatureDescription },
  key: string,
  accepts: (entry: unknown) => entry is Entry,
  register: (entry: Entry) => void
): void {
  for (const entry of listOf(feature.description, key)) {
    if (accepts(entry)) register(entry);
    else ctx.log.warn("world:bad-feature-entry", { feature: feature.name, key });
  }
}

/**
 * Registers what every feature brought, in feature order: components first, so their schema is
 * known, then systems, then projections. A feature's index is its place in the list: the systems
 * of a feature with `systemsRun: "active"` carry it as their scope, and each projection is counted
 * for it (rule V). A dev build warns about a feature nothing can make active.
 *
 * @param ctx - Domain context of the world plugin.
 * @param projection - The projection module.
 */
function registerFeatures(ctx: WorldCtx, projection: ProjectionModule): void {
  const projections = ctx.state.ecs.scope.projections;

  for (const [at, feature] of ctx.deps.flow.features.all().entries()) {
    const scope = scopeOf(ctx, at, feature);

    registerEach(ctx, feature, "components", isComponentEntry, entry => registerType(ctx, entry));
    registerEach(ctx, feature, "systems", isSystemEntry, entry =>
      registerSystem(ctx, entry, scope)
    );
    registerEach(ctx, feature, "projections", isProjectionEntry, entry => {
      projection.register(entry);
      projections.set(entry.name, at);
    });

    // Inline and positive, as the frame history below: a production `define` drops the check.
    if (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) {
      reportNeverActive(ctx, feature);
    }
  }
}

/**
 * Connects the world in `onStart`: it sizes the scope to the features, reads every feature
 * description, registers the five frame
 * callbacks of the phases and listens to the released hints. In a dev build the `signals`
 * callback records the frame history before it clears the change sets; in an agent build the
 * timing table starts with the page clock of `time` and the `input` callback zeroes it each
 * frame. The resource `Now` gets `clock.now()` once here and first thing in every `input`
 * callback, so every system of a frame reads one moment. `onStart` has no access to the
 * plugin's own API, so it builds its own module objects — they are views on `ctx.state`, which is
 * the one place the modules keep their data.
 *
 * Nothing is mounted here: `scenes` or a test mounts.
 *
 * @param ctx - Kernel context of the world plugin.
 */
export function connectWorld(ctx: KernelSlice): void {
  const worldCtx = withDeps(ctx);
  const { ecs, projection } = createModules(worldCtx);
  const { time, clock } = worldCtx.deps;

  // Inline and positive, as the frame history below: Bun folds the guard under a production
  // `define`, so a release bundle times no system.
  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
    const clock = time.agentClock();

    if (clock !== undefined) startTiming(worldCtx.state.ecs, clock);
  }

  openScope(worldCtx);
  registerFeatures(worldCtx, projection);
  ecs.resource(Now).now = clock.now();

  worldCtx.state.ecs.offFrame.push(
    ecs.onOwnerLeft(owner => projection.ownerLeft(owner)),
    time.onFrame("input", frame => {
      // Read each frame, never kept: after `ecs.clear()` the resource is a new object.
      ecs.resource(Now).now = clock.now();
      // The time per system of the frame starts from 0, in place: no allocation.
      worldCtx.state.ecs.timing?.ms.fill(0);
      projection.reconcileIfDirty();
      ecs.runPhase("input", frame);
    }),
    time.onFrame("animate", frame => {
      projection.sweep();
      ecs.runPhase("animate", frame);
    }),
    time.onFrame("layout", frame => ecs.runPhase("layout", frame)),
    time.onFrame("sync", frame => ecs.runPhase("sync", frame)),
    time.onFrame("signals", frame => {
      // Inline and positive, as renderer's capture: Bun folds this guard under a production
      // `define` and drops the recorder; `flow/doors/dev.ts` declares the global.
      if (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) {
        recordFrame(worldCtx, frame.frame);
      }

      ecs.clearChanges();
    })
  );

  worldCtx.state.projection.offHints.push(
    worldCtx.deps.flow.fx.onHint(hint => projection.pushHint(hint))
  );
}

/**
 * Empties the world in `onStop`: the frame callbacks and the hint listener are removed, then
 * every track, view, queued view, entity and resource is dropped, the scope and the frame history
 * are reset.
 * No `onRemoved` fires, because `renderer` stopped earlier and destroyed its own objects.
 *
 * @param state - The plugin state, the only thing a teardown context carries.
 */
export function clearWorld(state: State): void {
  for (const off of state.ecs.offFrame) off();
  state.ecs.offFrame.length = 0;

  for (const off of state.projection.offHints) off();
  state.projection.offHints.length = 0;
  state.projection.converged.length = 0;

  state.projection.specs.clear();
  state.projection.mounted.clear();
  state.projection.byEntity.clear();
  state.projection.mutes.clear();
  state.projection.rests.clear();
  state.projection.keys.clear();
  state.projection.keysByEntity.clear();
  state.projection.tracks.length = 0;
  state.projection.driver = undefined;
  state.projection.hints.length = 0;
  state.projection.dirty = undefined;
  state.projection.layers = Object.freeze([]);
  state.projection.membershipVersion += 1;
  state.projection.moving = false;
  state.projection.owedLoops = 0;

  state.ecs.generations.length = 0;
  state.ecs.free.length = 0;
  state.ecs.owners.clear();
  state.ecs.byOwner.clear();
  state.ecs.types.clear();
  state.ecs.stores.clear();
  state.ecs.typeStores.clear();
  state.ecs.queryPlans.clear();
  state.ecs.resources.clear();
  state.ecs.resourceSlots.clear();
  state.ecs.engineResources.clear();
  state.ecs.systems.input.length = 0;
  state.ecs.systems.animate.length = 0;
  state.ecs.systems.layout.length = 0;
  state.ecs.systems.sync.length = 0;
  state.ecs.commands.length = 0;
  state.ecs.changed.clear();
  state.ecs.added.clear();
  state.ecs.removed.clear();
  state.ecs.ownerLeft.length = 0;
  state.ecs.running = undefined;
  state.ecs.frameSnapshot = undefined;
  state.ecs.mode = "live";
  state.ecs.timing = undefined;
  state.ecs.timingSlots.clear();
  resetScope(state.ecs.scope);
  resetHistory(state.ecs);
}
