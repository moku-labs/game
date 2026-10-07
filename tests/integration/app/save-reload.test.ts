/**
 * @file A local save across a reload: two screen apps of the mini game, one after the other, over
 * the same stubbed `localStorage`. The second starts from what the first wrote, as a reload of
 * the page does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { localSave } from "../../../src/app/save";
import game from "../../fixtures/mini-game/index";
import { folderIo, readManifest, startOnHome } from "../mini-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Makes a `localStorage` over a map.
 *
 * @returns The storage and its map.
 */
function mapStorage(): { storage: Storage; items: Map<string, string> } {
  const items = new Map<string, string>();
  const storage = {
    get length() {
      return items.size;
    },
    // eslint-disable-next-line unicorn/no-null -- `Storage` answers a missing key with null.
    key: (index: number) => [...items.keys()][index] ?? null,
    // eslint-disable-next-line unicorn/no-null -- `Storage` answers a missing key with null.
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
    clear: () => {
      items.clear();
    }
  } satisfies Storage;

  return { storage, items };
}

describe("a local save across a reload", () => {
  it("a local save survives a second app over the same storage", async () => {
    const { storage, items } = mapStorage();

    vi.stubGlobal("localStorage", storage);

    const report = vi.fn<(problem: string) => void>();
    const first = game.screen({
      manifest: await readManifest(),
      io: folderIo().io,
      provider: localSave("moku-game:save", report),
      player: { count: 5 }
    });

    await startOnHome(first.app);
    await first.app.stop();
    expect(items.has("moku-game:save")).toBe(true);

    // The reload: a new app, a new provider, the starting player of the definition.
    const second = game.screen({
      manifest: await readManifest(),
      io: folderIo().io,
      provider: localSave("moku-game:save", report)
    });

    await startOnHome(second.app);
    expect(second.app.model.store.snapshot().player).toEqual({ count: 5 });
    await second.app.stop();
    expect(report).not.toHaveBeenCalled();
  });
});
