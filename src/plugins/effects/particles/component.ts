/**
 * @file effects/particles — the `Emitter` component. Pure: made with the `component()` helper of
 * `world`, so nothing has to be registered.
 */
import { component } from "../../world/ecs/define";
import type { EmitterValue } from "./types";

/** Typed, so `effect` is a string and not the literal `""`. */
const emitterDefaults: EmitterValue = { effect: "", active: true };

/**
 * A particle effect on an entity. A `burst` effect emits when the component appears or its
 * `effect` changes; a `rate` effect emits while `active` is true and the entity lives. An effect in
 * `"world"` space outlives the entity, one in `"local"` space moves and dies with it. `""` draws
 * nothing. Plain JSON: it shows in `snapshot()`.
 *
 * @example
 * ```ts
 * // A merged item bursts stars from its enter hook; the generator steams for its whole life.
 * view.set(Emitter, { effect: "fx.starsBurst" });
 * Emitter({ effect: "fx.steam" }).value; // { effect: "fx.steam", active: true }
 * ```
 */
export const Emitter = /*#__PURE__*/ component("Emitter", emitterDefaults);
