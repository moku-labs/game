/**
 * @file The saves of the page: `localSave` over `localStorage`, with its memory fallback and its
 * write failures, and `pageSave`, which picks the memory, local or store save from `config.save`.
 * The store save itself is `storeSave` of `src/app/system.ts`, tested in `store-save.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { localSave, pageSave } from "../../../src/app/save";
import type { SystemShell } from "../../../src/app/types";
import type { Model, Platform } from "../../../src/index";
import { memory } from "../../../src/plugins/model/store/providers/memory";
import { fakeStorage } from "./fake-browser";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The key of a game with no native identifier. */
const key = "moku-game:save";

/** The whole document of a new player, as the store hands it over at load. */
const newPlayer: Model.Patch[] = [
  {
    op: "replace",
    path: [],
    value: { player: { count: 0 }, rng: { seed: 42, streams: {} } }
  }
];

/**
 * A commit of one counter value.
 *
 * @param count - The new value of `player.count`.
 * @returns The patches of the commit.
 */
function countTo(count: number): Model.Patch[] {
  return [{ op: "replace", path: ["player", "count"], value: count }];
}

/**
 * Reads what the storage holds under the key, parsed.
 *
 * @param items - The map of the fake storage.
 * @returns The stored value.
 */
function stored(items: Map<string, string>): unknown {
  return JSON.parse(items.get(key) ?? "null");
}

/** Removes nothing: the remover of a subscription that holds nothing. */
const removeNothing = (): void => undefined;

/** A platform provider that does nothing: the store test reads only the shell's save. */
const inertPlatform: Platform.PlatformProvider = {
  onPause: () => removeNothing,
  onResume: () => removeNothing,
  onBack: () => removeNothing,
  haptic: removeNothing,
  keepAwake: removeNothing,
  exit: removeNothing
};

/** What a failed write reports, and what `commitDurable` rejects with. */
const notWritten =
  "[game] The local save was not written: quota exceeded.\n  Free browser storage; progress since the last write is lost on close.";

describe("localSave", () => {
  it("local save loads null for a new player and the stored value after a commit", async () => {
    const { storage, items } = fakeStorage();
    const report = vi.fn<(problem: string) => void>();

    vi.stubGlobal("localStorage", storage);

    const first = localSave(key, report);

    await expect(first.load()).resolves.toBeNull();
    first.commit(newPlayer, 1);
    first.commit(countTo(2), 1);

    const value = { state: { player: { count: 2 }, rng: { seed: 42, streams: {} } }, version: 1 };

    expect(stored(items)).toEqual(value);
    expect([...items.keys()]).toEqual([key]);
    await expect(localSave(key, report).load()).resolves.toEqual(value);
    expect(report).not.toHaveBeenCalled();
  });

  it("local save applies later commits to the document it loaded", async () => {
    const value = { state: { player: { count: 4 }, rng: { seed: 7, streams: {} } }, version: 1 };
    const { storage, items } = fakeStorage({ [key]: JSON.stringify(value) });

    vi.stubGlobal("localStorage", storage);

    const save = localSave(key, () => undefined);

    await save.load();
    await save.commitDurable(countTo(5), "tx-1", 2);
    await save.flush();

    expect(stored(items)).toEqual({
      state: { player: { count: 5 }, rng: { seed: 7, streams: {} } },
      version: 2
    });
  });

  it("local save falls back to memory and reports when localStorage throws", async () => {
    const { storage, items, refuseWrites } = fakeStorage();
    const report = vi.fn<(problem: string) => void>();

    refuseWrites("blocked");
    vi.stubGlobal("localStorage", storage);

    const save = localSave(key, report);

    expect(save).toHaveProperty("calls", []);
    expect(report).toHaveBeenCalledWith(
      "[game] localStorage is not available, so the save lives in memory.\n  Progress is lost when the page closes."
    );
    save.commit(newPlayer, 1);
    expect(items.size).toBe(0);
  });

  it("local save falls back to memory when the page has no localStorage", () => {
    const report = vi.fn<(problem: string) => void>();

    vi.stubGlobal("localStorage", undefined);

    expect(localSave(key, report)).toHaveProperty("calls", []);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("local save rejects a value that is not JSON", async () => {
    const message = `[game] The local save is not JSON.\n  Clear the site data or the key "${key}".`;

    for (const text of ["{oops", "[1, 2]", '{ "state": 1, "version": 1 }', '{ "state": {} }']) {
      vi.stubGlobal("localStorage", fakeStorage({ [key]: text }).storage);

      await expect(localSave(key, () => undefined).load()).rejects.toThrow(message);
    }
  });

  it("local save reports a failed write on commit and rejects it on commitDurable", async () => {
    const { storage, items, refuseWrites } = fakeStorage();
    const report = vi.fn<(problem: string) => void>();

    vi.stubGlobal("localStorage", storage);

    const save = localSave(key, report);

    await save.load();
    save.commit(newPlayer, 1);
    refuseWrites("quota exceeded.");
    save.commit(countTo(1), 1);
    expect(report).toHaveBeenCalledWith(notWritten);
    await expect(save.commitDurable(countTo(2), "tx-1", 1)).rejects.toThrow(notWritten);

    // The next write that goes through carries every change since the last one.
    refuseWrites(undefined);
    save.commit(countTo(3), 1);
    expect(stored(items)).toEqual({
      state: { player: { count: 3 }, rng: { seed: 42, streams: {} } },
      version: 1
    });
  });

  it("local save writes a non-Error refusal as its text", () => {
    const { storage } = fakeStorage();
    const report = vi.fn<(problem: string) => void>();

    vi.stubGlobal("localStorage", {
      ...storage,
      getItem: storage.getItem,
      removeItem: storage.removeItem,
      setItem: (name: string, value: string) => {
        if (name === key) throw "full";

        storage.setItem(name, value);
      }
    });

    localSave(key, report).commit(newPlayer, 1);

    expect(report).toHaveBeenCalledWith(
      "[game] The local save was not written: full.\n  Free browser storage; progress since the last write is lost on close."
    );
  });
});

describe("pageSave", () => {
  it("pageSave gives a fresh memory save for memory", () => {
    const where = { namespace: "moku-game", shell: undefined, report: () => undefined };
    const first = pageSave("memory", where);

    expect(first).toHaveProperty("calls", []);
    expect(pageSave("memory", where)).not.toBe(first);
  });

  it("pageSave keeps a local save under the namespace", () => {
    const { storage, items } = fakeStorage();

    vi.stubGlobal("localStorage", storage);

    const save = pageSave("local", {
      namespace: "com.mokulabs.timber",
      shell: undefined,
      report: () => undefined
    });

    save.commit(newPlayer, 1);

    expect([...items.keys()]).toEqual(["com.mokulabs.timber:save"]);
  });

  it("pageSave hands over the shell's store save for store", () => {
    const save = memory();
    const shell: SystemShell = {
      handle: {},
      platform: inertPlatform,
      save,
      start: () => Promise.resolve(),
      stop: () => Promise.resolve()
    };

    expect(pageSave("store", { namespace: "moku-game", shell, report: () => undefined })).toBe(
      save
    );
    expect(() =>
      pageSave("store", {
        namespace: "moku-game",
        shell: { ...shell, save: undefined },
        report: () => undefined
      })
    ).toThrow('[game] config.save is "store", but the page has no system shell.');
  });

  it("pageSave throws the store message without a shell", () => {
    expect(() =>
      pageSave("store", { namespace: "moku-game", shell: undefined, report: () => undefined })
    ).toThrow(
      '[game] config.save is "store", but the page has no system shell.\n  Run moku-game dev or build again: it passes the shell when config.ts names save "store".'
    );
  });
});
