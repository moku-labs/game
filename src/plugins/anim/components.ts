/**
 * @file anim plugin — the two components `anim` owns, `Animation` and `Frames`, the `AnimPlayer`
 * resource a system plays through, and the two helpers that write `Animation`. Pure: no ctx and
 * no state, only the injected `ecs` API. Made with the `component()` and `resource()` helpers of
 * `world`, so nothing has to be registered.
 */
import { component, resource } from "../world/ecs/define";
import type { AnyComponent } from "../world/ecs/types";
import type { AnyComponentType, EcsApi, Entity } from "../world/types";
import type { AnimPlayerValue, FramesValue } from "./types";

/** Typed, so `keys` is a list of strings and not `never[]`. */
const framesDefaults: FramesValue = { keys: [], fps: 12, loop: true, playing: true };

/** The sentence a system gets when it plays before `anim` started. */
const NOT_READY =
  "[game] AnimPlayer is not ready: anim has not started.\n" +
  "  Add animPlugin to the app before a system plays an animation.";

/**
 * The `play` of a world `anim` has not started in.
 *
 * @throws {Error} Always, with the not-ready sentence.
 */
function playBeforeStart(): never {
  throw new Error(NOT_READY);
}

/**
 * Makes the value a fresh world holds until `anim` starts and writes the real `play` onto it.
 *
 * @returns A player whose `play` throws the not-ready sentence.
 */
function notStarted(): AnimPlayerValue {
  return { play: playBeforeStart };
}

/**
 * How many tracks and running timelines name this entity. Written by `anim` while something
 * moves and removed at zero; the inspector and `ui.lint` read it, `anim` itself never does.
 */
export const Animation = /*#__PURE__*/ component("Animation", { playing: 0 });

/**
 * A frame loop on an entity, for as long as the entity carries it: every `1000 / fps` ms
 * `Sprite.texture` becomes the next key of `keys`, after the last key it wraps to the first. No
 * timeline around it, not counted by `Animation` or `app.anim.active()`. A running `frames` step on
 * the same entity owns the sprite until it ends; the loop goes on from where its clock stands.
 * Paused and fast world modes and reduced motion stop the clock on the frame it shows.
 *
 * @example
 * ```ts
 * // A coin spins on the board for its whole life: a projection view returns both components.
 * const coinSpin = ["items.coin-0", "items.coin-1", "items.coin-2", "items.coin-3"] as const;
 * const coin = [Sprite({ texture: "items.coin-0" }), Frames({ keys: coinSpin, fps: 12 })];
 * Frames({ keys: coinSpin, fps: 12 }).value.loop; // true: the default
 * ```
 */
export const Frames = /*#__PURE__*/ component("Frames", framesDefaults);

/**
 * The resource through which a system plays animations. Written by `anim` in its `onStart`;
 * before that its `play` throws. Dropped with every other resource when the world stops.
 *
 * @example
 * ```ts
 * // A test plays through the same resource the systems read; lift is a 100 ms tween.
 * app.world.ecs.resource(AnimPlayer).play(lift, { thing: 1_048_576 }).active(); // true
 * ```
 */
export const AnimPlayer = /*#__PURE__*/ resource("AnimPlayer", notStarted);

/**
 * Reads a component type as the erased record shape a writer that knows the component only by
 * its fields can drive. The object is the same; only its value type is widened.
 *
 * @param componentType - The type made by `component()`.
 * @returns The same object, typed for a record write.
 */
export function asComponent(componentType: AnyComponentType): AnyComponent {
  // The object is the callable type `component()` built; only its value shape is erased here.
  return componentType as AnyComponent;
}

/**
 * Counts one track or timeline of an entity up or down. The component appears at the first
 * writer and is removed again at zero, so an entity at rest carries nothing.
 *
 * @param ecs - The ecs API of `world`.
 * @param entity - The entity that is animated.
 * @param delta - `1` when something started, `-1` when it ended.
 */
export function countPlaying(ecs: EcsApi, entity: Entity, delta: number): void {
  const current = ecs.get(entity, Animation);

  if (current === undefined) {
    if (delta > 0) ecs.add(entity, Animation({ playing: delta }));

    return;
  }

  const next = current.playing + delta;

  if (next > 0) ecs.set(entity, Animation, { playing: next });
  else ecs.remove(entity, Animation);
}
