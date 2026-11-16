/**
 * @file renderer perf — the bind groups of the F194 release cases: real Pixi batch groups, made as a drawn batch
 * makes them.
 */
import * as pixi from "pixi.js";

/** A batch group of two textures, the first about to go, the second live. */
export type LiveCase = {
  readonly gone: pixi.TextureSource;
  readonly group: pixi.BindGroup;
};

/**
 * A texture source of its own, as the renderer loads one.
 *
 * @returns The source.
 */
function source(): pixi.TextureSource {
  return new pixi.TextureSource({ width: 4, height: 4 });
}

/**
 * A batch group of two textures over 16 slots, the first about to go.
 *
 * @returns The case.
 */
export function liveCase(): LiveCase {
  const gone = source();
  const group = pixi.getTextureBatchBindGroup([gone, source()], 2, 16);

  return { gone, group };
}

/**
 * Puts the first texture of a live case back in its slots, as before its release: two writes.
 *
 * @param live - The case.
 */
export function rebind(live: LiveCase): void {
  live.group.resources[0] = live.gone;
  live.group.resources[1] = live.gone.style;
}

/**
 * Sources each bound alone by a batch group over two slots: one padding slot on EMPTY, so EMPTY's lists hold one
 * listener of each group.
 *
 * @param count - How many.
 * @returns The sources.
 */
export function deadCases(count: number): pixi.TextureSource[] {
  return Array.from({ length: count }, () => {
    const alone = source();
    const group = pixi.getTextureBatchBindGroup([alone], 1, 2);

    // A drawn group read its key list at its first draw (`BindGroup._touch`): Pixi builds it once, lazily.
    if (
      (group as unknown as { readonly _resourceKeys: readonly number[] })._resourceKeys.length === 0
    ) {
      throw new Error("a batch group binds its slots");
    }

    return alone;
  });
}
