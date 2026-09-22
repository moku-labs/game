/**
 * @file anim plugin — the binder `defineGame` spreads: the authoring helpers whose arguments are
 * asset keys, typed with the keys of one game. Type-only work: the functions are the same ones
 * `timeline/steps.ts` exports.
 */
import { defineAnimation, frames, play, sfx } from "./timeline/steps";
import type { SfxDescriptor, Step } from "./timeline/types";
import type { Target } from "./types";

/**
 * The anim helpers bound to one game's asset keys: a frame sprite and a sound only take a key
 * the scanner generated.
 *
 * @example
 * ```ts
 * const kit: AnimKit<"board.pop-1" | "board.merge"> = animFor<"board.pop-1" | "board.merge">();
 * kit.sfx("board.merge").payload.key; // "board.merge"
 * ```
 */
export type AnimKit<Asset extends string> = {
  defineAnimation: typeof defineAnimation;
  frames: (
    target: Target,
    options: { keys: readonly Asset[]; fps: number; loop?: boolean }
  ) => Step;
  sfx: (key: Asset, options?: { bus?: string }) => SfxDescriptor;
  play: typeof play;
};

/**
 * Binds `frames` and `sfx` to one game's asset keys. Type-only: the same functions.
 *
 * @returns The four helpers, with the asset arguments narrowed to `Asset`.
 * @example
 * ```ts
 * const { sfx } = animFor<"board.merge">();
 * sfx("board.merge"); // { kind: "sfx", payload: { key: "board.merge", bus: "sfx" }, cosmetic: true }
 * ```
 */
export function animFor<Asset extends string>(): AnimKit<Asset> {
  return { defineAnimation, frames, sfx, play };
}
