/**
 * @file anim/timeline — type definitions: the step tree a choreography is, the cursor that walks
 * it and the runtime the cursor reaches the world through.
 */
import type { Json } from "../../model/types";
import type { AnyComponent } from "../../world/ecs/types";
import type { Ease, Entity, TrackOptions } from "../../world/types";
import type { StepMotion } from "../tween/types";
import type { Target } from "../types";

/**
 * A sound, owned by `anim` and handled by `audio`. It is a `flow` descriptor and a timeline step
 * at once: `fx(sfx("board.merge"))` in a node, or `sfx("board.merge")` inside a `sequence`.
 *
 * @example
 * ```ts
 * const descriptor: SfxDescriptor = {
 *   kind: "sfx", payload: { key: "board.merge", bus: "sfx" }, cosmetic: true
 * };
 * ```
 */
export type SfxDescriptor = {
  readonly kind: "sfx";
  readonly payload: { readonly key: string; readonly bus: string };
  readonly cosmetic: true;
};

/**
 * A haptic tick, owned by `anim` and handled by `platform`. Like `sfx` it is a descriptor and a
 * timeline step at once.
 *
 * @example
 * ```ts
 * const descriptor: HapticDescriptor = {
 *   kind: "haptic", payload: { kind: "light" }, cosmetic: true
 * };
 * ```
 */
export type HapticDescriptor = {
  readonly kind: "haptic";
  readonly payload: { readonly kind: string };
  readonly cosmetic: true;
};

/**
 * The two descriptors `anim` owns. As a step, the descriptor is dispatched through
 * `flow.fx.dispatch` when the step is reached; a kind nobody handles is silent.
 *
 * @example
 * ```ts
 * const step: FxStep = { kind: "haptic", payload: { kind: "light" }, cosmetic: true };
 * ```
 */
export type FxStep = SfxDescriptor | HapticDescriptor;

/**
 * The descriptor `play(animation, slots)` builds. The payload names the animation, so the
 * handler resolves the definition from the registry instead of carrying a function.
 *
 * @example
 * ```ts
 * const descriptor: PlayDescriptor = {
 *   kind: "play",
 *   payload: { animation: "hud.coinsFly", slots: { from: { projection: "hud", key: "coins" } } },
 *   cosmetic: true
 * };
 * ```
 */
export type PlayDescriptor = {
  readonly kind: "play";
  readonly payload: { readonly animation: string; readonly slots: Json };
  readonly cosmetic: true;
};

/**
 * One step of a choreography: plain frozen data with no callback inside, so a step tree can be
 * read, logged and compared.
 *
 * @example
 * ```ts
 * const step: Step = { kind: "wait", ms: 120 };
 * ```
 */
export type Step =
  | { readonly kind: "sequence"; readonly steps: readonly Step[] }
  | { readonly kind: "parallel"; readonly steps: readonly Step[] }
  | { readonly kind: "wait"; readonly ms: number }
  | { readonly kind: "mark"; readonly name: string }
  | {
      readonly kind: "tween";
      readonly target: Target;
      readonly component: AnyComponent;
      readonly to: Readonly<Record<string, number>>;
      readonly ms: number;
      readonly ease: Ease;
      readonly delayMs: number;
      readonly additive: boolean;
    }
  | {
      readonly kind: "set";
      readonly target: Target;
      readonly component: AnyComponent;
      readonly patch: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "frames";
      readonly target: Target;
      readonly keys: readonly string[];
      readonly fps: number;
      readonly loop: boolean;
    }
  | FxStep
  | { readonly kind: "use"; readonly id: string; readonly step: Step };

/**
 * Reserved for Spine and the other external players: `external` throws, and this is the shape it
 * would take. Exported as a type only.
 *
 * @example
 * ```ts
 * const player: ExternalPlayer = { name: "spine", play: () => undefined };
 * ```
 */
export type ExternalPlayer = { readonly name: string; play(clip: string): unknown };

/**
 * Where one step of a running timeline stands. One mutable record per step of the tree, built
 * when the timeline starts.
 *
 * @example
 * ```ts
 * const cursor: Cursor = {
 *   step: { kind: "wait", ms: 120 }, children: [], index: 0, elapsed: 0,
 *   motion: undefined, started: false, ended: false
 * };
 * ```
 */
export type Cursor = {
  readonly step: Step;
  readonly children: readonly Cursor[];
  /** Position in a `sequence`, and the last written key of a `frames` step. */
  index: number;
  /** Consumed milliseconds of a `wait` or a `frames` step. */
  elapsed: number;
  motion: StepMotion | undefined;
  started: boolean;
  ended: boolean;
};

/**
 * What the cursor reaches the rest of the engine through. Injected, so `timeline` never imports
 * the run-time code of `tween` or of another plugin.
 */
export type TimelineRuntime = {
  /**
   * Resolves a target to an entity.
   *
   * @param target - The projection key or the entity a step names.
   * @returns The entity, or `undefined` when no live view or element holds that key.
   */
  entityOf(target: Target): Entity | undefined;

  /**
   * Reads a component of an entity, which is also the liveness check of a step.
   *
   * @param entity - The entity to read.
   * @param component - The component to read.
   * @returns The stored value, or `undefined`.
   */
  read(entity: Entity, component: AnyComponent): Readonly<Record<string, unknown>> | undefined;

  /**
   * Writes a patch through `ecs.set`, so `changed()` sees it.
   *
   * @param entity - The entity to write.
   * @param component - The component to write.
   * @param patch - The fields to overwrite.
   */
  write(entity: Entity, component: AnyComponent, patch: Record<string, unknown>): void;

  /**
   * Starts one track on the tween core.
   *
   * @param entity - The entity to animate.
   * @param component - The component to animate.
   * @param to - The numeric target fields.
   * @param options - Duration, easing, delay and the additive flag.
   * @returns The motion of the track, advanceable by hand.
   */
  start(
    entity: Entity,
    component: AnyComponent,
    to: Record<string, number>,
    options: TrackOptions
  ): StepMotion;

  /**
   * Hands a descriptor step to `flow.fx.dispatch`.
   *
   * @param descriptor - The `sfx` or `haptic` step that was reached.
   */
  dispatch(descriptor: FxStep): void;

  /**
   * Reports a mark: the event, the `onMark` listeners and the timeline's own list.
   *
   * @param animation - Id of the animation the mark belongs to.
   * @param name - Name of the mark.
   */
  mark(animation: string, name: string): void;

  /**
   * Lifts the idle frame rate, because something started to move.
   */
  wake(): void;
};

/**
 * What the cursor functions carry down the tree: the runtime, the animation id marks are
 * reported under, and the list of marks reached so far.
 */
export type CursorCtx = {
  readonly rt: TimelineRuntime;
  readonly animation: string;
  readonly marks: string[];
};

/**
 * One running timeline: its cursor, the marks it reached, the entities it counts on and the
 * resolver of its `done` promise.
 */
export type RunningTimeline = {
  readonly id: number;
  readonly animation: string;
  readonly cursor: Cursor;
  readonly marks: string[];
  readonly entities: readonly Entity[];
  readonly resolve: () => void;
  ended: boolean;
};
