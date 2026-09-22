/**
 * @file world plugin — lifecycle functions: dependency resolution, the `onStart` wiring and the
 * teardown that empties the world.
 */
import { flowPlugin } from "../flow";
import type { FeatureDescription } from "../flow/features/types";
import { modelPlugin } from "../model";
import { timePlugin } from "../time";
import { createModules } from "./api";
import { registerType } from "./ecs/storage";
import type { AnyComponentType, AnySystem } from "./ecs/types";
import type { AnyProjectionSpec } from "./projection/types";
import type {
  Deps,
  EcsModule,
  KernelInput,
  KernelSlice,
  ProjectionModule,
  State,
  WorldCtx
} from "./types";

/**
 * Narrows what the kernel hands a factory to the slice the domain files read.
 *
 * @param ctx - The context the kernel hands a plugin factory.
 * @returns The same object, typed with this plugin's own `emit`.
 */
export function kernelSlice(ctx: KernelInput): KernelSlice {
  // The only narrowing in the plugin: see the note on `KernelInput`. Everything below is typed.
  return ctx as unknown as KernelSlice;
}

/**
 * Resolves the dependency APIs `time`, `model` and `flow` with `ctx.require`.
 *
 * @param ctx - Kernel context of the world plugin.
 * @returns The three dependency APIs.
 */
export function resolveDeps(ctx: KernelSlice): Deps {
  return {
    time: ctx.require(timePlugin),
    model: ctx.require(modelPlugin),
    flow: ctx.require(flowPlugin)
  };
}

/**
 * Builds the domain context the two modules share.
 *
 * @param ctx - Kernel context of the world plugin.
 * @returns The domain context of the world plugin.
 */
export function withDeps(ctx: KernelInput): WorldCtx {
  const slice = kernelSlice(ctx);

  return { ...slice, deps: resolveDeps(slice) };
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
 * Registers what every feature brought, in feature order: components first, so their schema is
 * known, then systems, then projections.
 *
 * @param ctx - Domain context of the world plugin.
 * @param ecs - The ecs module.
 * @param projection - The projection module.
 */
function registerFeatures(ctx: WorldCtx, ecs: EcsModule, projection: ProjectionModule): void {
  for (const feature of ctx.deps.flow.features.all()) {
    for (const entry of listOf(feature.description, "components")) {
      registerType(ctx, entry as AnyComponentType);
    }

    for (const entry of listOf(feature.description, "systems")) {
      ecs.system(entry as AnySystem);
    }

    for (const entry of listOf(feature.description, "projections")) {
      projection.register(entry as AnyProjectionSpec);
    }
  }
}

/**
 * Connects the world in `onStart`: it reads every feature description, registers the five frame
 * callbacks of the phases and listens to the released hints. `onStart` has no access to the
 * plugin's own API, so it builds its own module objects — they are views on `ctx.state`, which is
 * the one place the modules keep their data.
 *
 * Nothing is mounted here: `scenes` or a test mounts.
 *
 * @param ctx - Kernel context of the world plugin.
 */
export function connectWorld(ctx: KernelInput): void {
  const worldCtx = withDeps(ctx);
  const { ecs, projection } = createModules(worldCtx);
  const time = worldCtx.deps.time;

  registerFeatures(worldCtx, ecs, projection);

  worldCtx.state.ecs.offFrame.push(
    ecs.onOwnerLeft(owner => projection.ownerLeft(owner)),
    time.onFrame("input", frame => {
      projection.reconcileIfDirty();
      ecs.runPhase("input", frame);
    }),
    time.onFrame("animate", frame => {
      projection.advance(frame.delta);
      ecs.runPhase("animate", frame);
    }),
    time.onFrame("layout", frame => ecs.runPhase("layout", frame)),
    time.onFrame("sync", frame => ecs.runPhase("sync", frame)),
    time.onFrame("signals", () => ecs.clearChanges())
  );

  worldCtx.state.projection.offHints.push(
    worldCtx.deps.flow.fx.onHint(hint => projection.pushHint(hint))
  );
}

/**
 * Empties the world in `onStop`: the frame callbacks and the hint listener are removed, then
 * every track, view, queued view, entity and resource is dropped. No `onRemoved` fires, because
 * `renderer` stopped earlier and destroyed its own objects.
 *
 * @param state - The plugin state, the only thing a teardown context carries.
 */
export function clearWorld(state: State): void {
  for (const off of state.ecs.offFrame) off();
  state.ecs.offFrame.length = 0;

  for (const off of state.projection.offHints) off();
  state.projection.offHints.length = 0;

  state.projection.specs.clear();
  state.projection.mounted.clear();
  state.projection.byEntity.clear();
  state.projection.mutes.clear();
  state.projection.tracks.length = 0;
  state.projection.hints.length = 0;
  state.projection.dirty = undefined;
  state.projection.layers = Object.freeze([]);

  state.ecs.generations.length = 0;
  state.ecs.free.length = 0;
  state.ecs.owners.clear();
  state.ecs.byOwner.clear();
  state.ecs.types.clear();
  state.ecs.stores.clear();
  state.ecs.resources.clear();
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
}
