/**
 * @file anim plugin — lifecycle functions: the dependency resolution, the
 * runtime the timelines reach the engine through, the one frame step registered in `onInit`, the
 * driver and the `play` handler opened in `onStart`, and the teardown that closes exactly what
 * was opened.
 */
import { flowPlugin } from "../flow";
import type { Descriptor, FxHandler } from "../flow/types";
import type { Json } from "../model/types";
import { timePlugin } from "../time";
import type { Time } from "../time/types";
import { worldPlugin } from "../world";
import type { AnyComponent, AnyComponentValue } from "../world/ecs/types";
import type { Entity, Owner, TrackOptions } from "../world/types";
import {
  advanceTimelines,
  finishAllTimelines,
  resolveTarget,
  startTimeline
} from "./timeline/play";
import type { FxStep, TimelineRuntime } from "./timeline/types";
import { advanceTracks, beginFrame, finishAllTracks } from "./tween/advance";
import { createDriver, startStepTrack } from "./tween/driver";
import type {
  AnimCtx,
  AnyAnimationDefinition,
  KernelSlice,
  SlotRecord,
  State,
  Target
} from "./types";

/** The owner of every entity a `spawn` step makes. */
const ANIM_OWNER: Owner = Object.freeze({ kind: "plugin", name: "anim" });

/** Message of the throw a descriptor that was not built by `play` gets. */
const NO_ANIMATION_ID =
  "[game] A play effect carries no animation id.\n  Build it with play(animation, slots).";

/**
 * Tells whether a value is a plain object, so its fields can be read one by one.
 *
 * @param value - Anything that came out of a payload or a feature description.
 * @returns True for a plain object.
 * @example
 * ```ts
 * isRecord({ key: "a" }); // true
 * isRecord([1, 2]); // false
 * ```
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalises a caught value into an `Error`, so the log always gets one.
 *
 * @param error - What was thrown.
 * @returns The error, or one built from the thrown value.
 * @example
 * ```ts
 * asError("boom").message; // "boom"
 * ```
 */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Resolves the dependency APIs `time`, `flow` and `world` onto the kernel context.
 *
 * @param ctx - Kernel context of the anim plugin.
 * @returns The domain context of the anim plugin.
 */
export function withDeps(ctx: KernelSlice): AnimCtx {
  return {
    ...ctx,
    deps: {
      time: ctx.require(timePlugin),
      flow: ctx.require(flowPlugin),
      world: ctx.require(worldPlugin)
    }
  };
}

/**
 * Reports one mark: the event first, then every `onMark` listener. A listener that throws is
 * logged with its animation and the listeners after it still run.
 *
 * @param actx - Domain context of the anim plugin.
 * @param animation - Id of the animation the mark belongs to.
 * @param mark - Name of the mark.
 */
function reportMark(actx: AnimCtx, animation: string, mark: string): void {
  actx.emit("anim:mark", { animation, mark });

  // eslint-disable-next-line unicorn/no-useless-spread -- a listener may remove itself
  for (const listener of [...actx.state.markListeners]) {
    try {
      listener(animation, mark);
    } catch (error) {
      actx.log.error("anim:mark-listener-failed", { animation, mark }, asError(error));
    }
  }
}

/**
 * Builds what a running timeline reaches the engine through, so `timeline` never imports the
 * run-time code of `tween` or of another plugin.
 *
 * @param actx - Domain context of the anim plugin.
 * @returns The timeline runtime.
 */
export function createRuntime(actx: AnimCtx): TimelineRuntime {
  return {
    entityOf: (target: Target, spawned?: ReadonlyMap<string, Entity>): Entity | undefined =>
      resolveTarget(actx, target, spawned),

    spawn: (components: readonly AnyComponentValue[]): Entity =>
      actx.deps.world.ecs.spawn(ANIM_OWNER, components),

    read: (
      entity: Entity,
      component: AnyComponent
    ): Readonly<Record<string, unknown>> | undefined => actx.deps.world.ecs.get(entity, component),

    write: (entity: Entity, component: AnyComponent, patch: Record<string, unknown>): void => {
      actx.deps.world.ecs.set(entity, component, patch);
    },

    start: (
      entity: Entity,
      component: AnyComponent,
      to: Record<string, number>,
      options: TrackOptions
    ) => startStepTrack(actx, entity, component, to, options),

    dispatch: (descriptor: FxStep): void => {
      actx.deps.flow.fx.dispatch(descriptor);
    },

    mark: (animation: string, name: string): void => reportMark(actx, animation, name),

    wake: (): void => actx.deps.time.wake()
  };
}

/**
 * Ends everything that moves: every timeline at its own end, then every track on its exact
 * target. The frame step calls it in fast mode, the API exposes it, the teardown runs it last.
 *
 * @param actx - Domain context of the anim plugin.
 * @param rt - The timeline runtime.
 */
export function finishAllAnim(actx: AnimCtx, rt: TimelineRuntime): void {
  finishAllTimelines(actx, rt);
  finishAllTracks(actx);
}

/**
 * The one frame step: the timelines consume the delta first, so a track a step just started is
 * advanced by the remainder at once, then every other track advances. A paused world moves
 * nothing; a fast world ends everything.
 *
 * @param actx - Domain context of the anim plugin.
 * @param rt - The timeline runtime.
 * @param time - The frame's `Time`.
 */
export function stepAnim(actx: AnimCtx, rt: TimelineRuntime, time: Readonly<Time>): void {
  const mode = actx.deps.world.ecs.mode();

  if (mode === "paused") return;

  if (mode === "fast") {
    finishAllAnim(actx, rt);

    return;
  }

  beginFrame(actx);
  advanceTimelines(actx, rt, time.delta);
  advanceTracks(actx, time.delta);
}

/**
 * Tells whether a feature entry is an animation `anim` can play.
 *
 * @param entry - What the feature put in its `animations` list.
 * @returns True when it carries an id and a build function.
 */
function isAnimation(entry: unknown): entry is AnyAnimationDefinition {
  return isRecord(entry) && typeof entry.id === "string" && typeof entry.build === "function";
}

/**
 * Reads the `animations` of every feature into the registry, in feature order.
 *
 * @param actx - Domain context of the anim plugin.
 * @throws {Error} When two features register the same animation id.
 */
function registerAnimations(actx: AnimCtx): void {
  for (const feature of actx.deps.flow.features.all()) {
    for (const entry of feature.description.animations ?? []) {
      if (!isAnimation(entry)) {
        actx.log.warn("anim:bad-feature-entry", { feature: feature.name });

        continue;
      }

      if (actx.state.registry.has(entry.id)) {
        throw new Error(
          `[game] Animation "${entry.id}" is registered twice.\n` +
            "  Keep one defineAnimation per id."
        );
      }

      actx.state.registry.set(entry.id, entry);
    }
  }
}

/**
 * Reads one target out of a `play` payload.
 *
 * @param entry - What the payload held under a slot name.
 * @returns The target, or `undefined` when it is neither an entity, a projection key nor a
 *   spawned id.
 */
function readTarget(entry: unknown): Target | undefined {
  if (typeof entry === "number") return entry;

  if (!isRecord(entry)) return undefined;

  if (typeof entry.projection === "string" && typeof entry.key === "string") {
    return { projection: entry.projection, key: entry.key };
  }

  return typeof entry.spawned === "string" ? { spawned: entry.spawned } : undefined;
}

/**
 * Reads the slots out of a `play` payload. A slot the payload cannot answer is left out, and the
 * step that names it ends silently when it is reached.
 *
 * @param value - What the payload held under `slots`.
 * @returns One target, or a list of targets, per slot name.
 */
function readSlots(value: unknown): SlotRecord {
  const slots: Record<string, Target | Target[]> = {};

  if (!isRecord(value)) return slots;

  for (const [name, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      slots[name] = entry
        .map(item => readTarget(item))
        .filter((target): target is Target => target !== undefined);

      continue;
    }

    const target = readTarget(entry);

    if (target !== undefined) slots[name] = target;
  }

  return slots;
}

/**
 * Reads the payload `play(animation, slots)` built.
 *
 * @param payload - The payload of the descriptor.
 * @returns The animation id and its slots, or `undefined` for a foreign payload.
 */
function readPlayPayload(
  payload: Json | undefined
): { animation: string; slots: SlotRecord } | undefined {
  if (!isRecord(payload) || typeof payload.animation !== "string") return undefined;

  return { animation: payload.animation, slots: readSlots(payload.slots) };
}

/**
 * The handler of the `play` effect: it builds the tree, starts the timeline and resolves when the
 * timeline ends. An aborted node finishes it, so the picture lands at the end and no track
 * survives the node.
 *
 * @param actx - Domain context of the anim plugin.
 * @param rt - The timeline runtime.
 * @returns The handler, registered with `runInFast: false`.
 */
function createPlayHandler(actx: AnimCtx, rt: TimelineRuntime): FxHandler {
  return (descriptor: Descriptor | { payload?: Json }, { signal }): Promise<void> => {
    const request = readPlayPayload(descriptor.payload);

    if (request === undefined) throw new Error(NO_ANIMATION_ID);

    const definition = actx.state.registry.get(request.animation);

    if (definition === undefined) {
      throw new Error(
        `[game] Animation "${request.animation}" is not registered.\n` +
          "  Add it to the animations key of a feature."
      );
    }

    const handle = startTimeline(actx, rt, definition, request.slots);

    // A node aborted before the handler ran hands over a signal that is already aborted.
    if (signal.aborted) handle.finish();
    else signal.addEventListener("abort", () => handle.finish(), { once: true });

    return handle.done;
  };
}

/**
 * Registers the one frame step in `onInit`, which runs before every `onStart`. `world` registers
 * its own `animate` callback in its `onStart` and `time` runs the callbacks of a phase in
 * registration order, so the tracks advance before the sweep of `world` looks at them.
 *
 * @param ctx - Kernel context of the anim plugin.
 */
export function initAnim(ctx: KernelSlice): void {
  const actx = withDeps(ctx);
  const rt = createRuntime(actx);

  actx.state.finishAll = (): void => finishAllAnim(actx, rt);
  actx.state.offFrame = actx.deps.time.onFrame("animate", time => stepAnim(actx, rt, time));
}

/**
 * Opens what the plugin owns: the animations of every feature, the tween driver of `world` and
 * the handler of the `play` effect.
 *
 * @param ctx - Kernel context of the anim plugin.
 */
export function startAnim(ctx: KernelSlice): void {
  const actx = withDeps(ctx);
  const rt = createRuntime(actx);

  registerAnimations(actx);
  actx.state.removeDriver = actx.deps.world.projection.setDriver(createDriver(actx));
  actx.state.offPlay = actx.deps.flow.fx.handle("play", createPlayHandler(actx, rt), {
    runInFast: false
  });
}

/**
 * Closes what the plugin opened. Everything is finished first, so every pending `done` resolves
 * and no node awaits a plugin that is gone; `world` stops after `anim`, so those writes land.
 *
 * @param state - The plugin state, the only thing a teardown context carries.
 */
export function stopAnim(state: State): void {
  state.finishAll?.();
  state.removeDriver?.();
  state.offFrame?.();
  state.offPlay?.();

  state.finishAll = undefined;
  state.removeDriver = undefined;
  state.offFrame = undefined;
  state.offPlay = undefined;

  state.tracks.clear();
  state.owner.clear();
  state.offsets.clear();
  state.bases.clear();
  state.timelines.clear();
  state.registry.clear();
  state.markListeners.clear();
  state.overMaxTracks = false;
}
