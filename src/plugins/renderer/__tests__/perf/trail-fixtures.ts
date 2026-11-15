/**
 * @file renderer — the fixtures of the trail's perf files (F175): a `localStorage` over a map, and a started renderer
 * of 20 sprites with or without a storage, so with or without a started trail. Not a test file.
 */
import { vi } from "vitest";
import { type SpriteStage, startSprites } from "./fixtures";

/* eslint-disable unicorn/no-null -- `Storage` answers a missing key with null. */

/**
 * A `localStorage` over a map.
 *
 * @returns The storage.
 */
export function memoryStorage(): Storage {
  const items = new Map<string, string>();

  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
    clear: () => items.clear(),
    key: () => null,
    get length() {
      return items.size;
    }
  };
}

/**
 * Starts 20 sprites on a page with a storage, so the trail runs, or without one, so it does not. The caller stops the
 * renderer, which stops the trail's timer.
 *
 * @param withTrail - True to put a storage on the page first.
 * @returns The started stage.
 */
export async function trailStage(withTrail: boolean): Promise<SpriteStage> {
  vi.stubGlobal("localStorage", withTrail ? memoryStorage() : undefined);

  const stage = await startSprites(20);

  if (withTrail !== (stage.mock.ctx.state.trail.stop !== undefined)) {
    throw new Error("perf fixture: the trail did not start as asked");
  }

  return stage;
}
