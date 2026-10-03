/**
 * @file effects plugin — the binder `defineGame` spreads: the helpers whose arguments are asset
 * keys or emitter ids, typed with the ones of one game. Type-only work: the same function and the
 * same component objects the plugin exports.
 */
import type { Narrowed } from "../world/types";
import { Displacement } from "./filters/builtins";
import type { DisplacementValue } from "./filters/types";
import { Emitter } from "./particles/component";
import { defineEmitter } from "./particles/define";
import type { EmitterConfig, EmitterDefinition, EmitterValue } from "./particles/types";

/**
 * The effects helpers bound to one game: `textures` and `Displacement.map` take only the game's
 * asset keys, `defineEmitter` and `Emitter.effect` only its emitter ids.
 *
 * @example
 * ```ts
 * const kit: EffectsKit<"fx.puff", "fx.steam"> = effectsFor<"fx.puff", "fx.steam">();
 * kit.Emitter({ effect: "fx.steam" }).value; // { effect: "fx.steam", active: true }
 * ```
 */
export type EffectsKit<Asset extends string, EmitterId extends string> = {
  defineEmitter: (
    id: EmitterId,
    config: Omit<EmitterConfig, "textures"> & { readonly textures: readonly Asset[] }
  ) => EmitterDefinition;
  Emitter: Narrowed<EmitterValue, { effect?: EmitterId; active?: boolean }>;
  Displacement: Narrowed<
    DisplacementValue,
    Partial<Omit<DisplacementValue, "map">> & { map?: Asset }
  >;
};

/**
 * Binds `defineEmitter`, `Emitter` and `Displacement` to one game's asset keys and emitter ids.
 * Type-only: the same function and component objects.
 *
 * @returns The three helpers, narrowed.
 * @example
 * ```ts
 * const { defineEmitter } = effectsFor<"fx.puff", "fx.steam">();
 * defineEmitter("fx.steam", { textures: ["fx.puff"], rate: 12 }).config.rate; // 12
 * ```
 */
export function effectsFor<Asset extends string, EmitterId extends string>(): EffectsKit<
  Asset,
  EmitterId
> {
  return { defineEmitter, Emitter, Displacement };
}
