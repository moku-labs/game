/**
 * @file `storeSave`: the save provider over the system store. It holds the document it loaded,
 * applies each commit's patches to it and queues one write of the whole value per commit, in
 * order. A read the store refuses rejects the load: answering "new player" would overwrite a real
 * save at the first commit.
 */
import type { JsonValue, SystemResult } from "@moku-labs/system";
import { describe, expect, it, vi } from "vitest";
import type { StoreSlice } from "../../../src/app/system";
import { storeSave } from "../../../src/app/system";
import type { Model } from "../../../src/index";

/** What a store answers to a write it took. */
const stored: SystemResult<void> = { ok: true, value: undefined, provider: "web" };

/** What a store answers when the native build lacks the store permission. */
const denied: SystemResult<never> = {
  ok: false,
  provider: "tauri",
  reason: "denied",
  message: "store.set not allowed"
};

/** The patch the model hands a provider with no base: the whole document. */
const newPlayer: Model.Patch[] = [
  { op: "replace", path: [], value: { player: { count: 0 }, rng: { seed: 42, streams: {} } } }
];

/** One roll: the count goes up. */
const counted = (count: number): Model.Patch[] => [
  { op: "replace", path: ["player", "count"], value: count }
];

/** A fake store: the value under the key, every write in order, and a gate per write. */
type FakeStore = {
  store: StoreSlice;
  /** Every value handed to `set`, in order. */
  written: JsonValue[];
  /** Answers the oldest write still open. */
  answer: (result: SystemResult<void>) => void;
};

/**
 * Creates a fake store that answers reads with `read` and holds every write open until the test
 * answers it, so the order of writes is visible.
 *
 * @param read - What `get` answers.
 * @returns The store, the writes, and the control of the open writes.
 */
function gatedStore(read: SystemResult<JsonValue | undefined>): FakeStore {
  const written: JsonValue[] = [];
  const open: ((result: SystemResult<void>) => void)[] = [];
  const store: StoreSlice = {
    get: vi.fn(async () => read) as StoreSlice["get"],
    set: vi.fn(
      (_key: string, value: JsonValue) =>
        new Promise<SystemResult<void>>(resolve => {
          written.push(value);
          open.push(resolve);
        })
    ) as StoreSlice["set"]
  };

  return { store, written, answer: result => open.shift()?.(result) };
}

/**
 * Creates a fake store that answers every write at once with `write`.
 *
 * @param read - What `get` answers.
 * @param write - What `set` answers.
 * @returns The store and its writes.
 */
function plainStore(
  read: SystemResult<JsonValue | undefined>,
  write: SystemResult<void> = stored
): { store: StoreSlice; written: JsonValue[] } {
  const written: JsonValue[] = [];
  const store: StoreSlice = {
    get: vi.fn(async () => read) as StoreSlice["get"],
    set: vi.fn(async (_key: string, value: JsonValue) => {
      written.push(value);

      return write;
    }) as StoreSlice["set"]
  };

  return { store, written };
}

/**
 * Yields the microtask queue, the way a test waits without a timer.
 *
 * @param times - How many microtasks to give up.
 */
async function tick(times = 20): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe("storeSave — load", () => {
  it("loads null for a new player when the key is missing", async () => {
    const { store } = plainStore({ ok: true, value: undefined, provider: "web" });
    const save = storeSave(store, "save", vi.fn());

    await expect(save.load()).resolves.toBeNull();
    expect(store.get).toHaveBeenCalledExactlyOnceWith("save");
  });

  it("loads the stored value and applies the next commit to it", async () => {
    const saved = { state: { player: { count: 3 }, rng: { seed: 7, streams: {} } }, version: 2 };
    const { store, written } = plainStore({ ok: true, value: saved, provider: "tauri" });
    const save = storeSave(store, "save", vi.fn());

    await expect(save.load()).resolves.toEqual(saved);

    save.commit(counted(4), 2);
    await save.flush();

    expect(written).toEqual([
      { state: { player: { count: 4 }, rng: { seed: 7, streams: {} } }, version: 2 }
    ]);
  });

  it("store save rejects a failed read instead of starting a new player", async () => {
    const { store } = plainStore(denied);
    const save = storeSave(store, "save", vi.fn());

    await expect(save.load()).rejects.toMatchObject({
      message:
        "[game] The save could not be read from the system store: denied, store.set not allowed.\n  The game does not start over it; check the store permission of the native build."
    });
  });

  it("names only the reason when the store gives no message", async () => {
    const { store } = plainStore({ ok: false, provider: "web", reason: "unavailable" });

    await expect(storeSave(store, "save", vi.fn()).load()).rejects.toThrow(
      "from the system store: unavailable.\n"
    );
  });
});

describe("storeSave — writes", () => {
  it("store save writes in commit order", async () => {
    const fake = gatedStore({ ok: true, value: undefined, provider: "web" });
    const save = storeSave(fake.store, "save", vi.fn());

    await save.load();
    save.commit(newPlayer, 1);
    save.commit(counted(1), 1);
    await tick();

    // The second write waits for the first.
    expect(fake.written).toEqual([
      { state: { player: { count: 0 }, rng: { seed: 42, streams: {} } }, version: 1 }
    ]);

    fake.answer(stored);
    await tick();

    expect(fake.written).toEqual([
      { state: { player: { count: 0 }, rng: { seed: 42, streams: {} } }, version: 1 },
      { state: { player: { count: 1 }, rng: { seed: 42, streams: {} } }, version: 1 }
    ]);
    fake.answer(stored);
  });

  it("store save flush waits for every queued write", async () => {
    const fake = gatedStore({ ok: true, value: undefined, provider: "web" });
    const save = storeSave(fake.store, "save", vi.fn());
    const flushed = vi.fn();

    save.commit(newPlayer, 1);
    save.commit(counted(1), 1);
    const flushing = save.flush().then(flushed);
    await tick();

    fake.answer(stored);
    await tick();

    expect(flushed).not.toHaveBeenCalled();

    fake.answer(stored);
    await tick();

    expect(flushed).toHaveBeenCalledOnce();
    expect(fake.written).toHaveLength(2);
    await flushing;
  });

  it("commitDurable resolves once its write is stored", async () => {
    const fake = gatedStore({ ok: true, value: undefined, provider: "web" });
    const save = storeSave(fake.store, "save", vi.fn());
    const durable = vi.fn();

    const committing = save.commitDurable(newPlayer, "shop/grant#3@1000000", 1).then(durable);
    await tick();

    expect(durable).not.toHaveBeenCalled();

    fake.answer(stored);
    await tick();

    expect(durable).toHaveBeenCalledOnce();
    await committing;
  });

  it("store save rejects commitDurable on a failed write", async () => {
    const { store } = plainStore({ ok: true, value: undefined, provider: "web" }, denied);
    const report = vi.fn();
    const save = storeSave(store, "save", report);

    await expect(save.commitDurable(newPlayer, "shop/grant#3@1000000", 1)).rejects.toMatchObject({
      message:
        "[game] The save was not stored: denied, store.set not allowed.\n  Check the store permission of the native build; progress since the last stored save is lost on close."
    });
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a failed write of commit and goes on with the next one", async () => {
    const { store, written } = plainStore({ ok: true, value: undefined, provider: "web" });
    const report = vi.fn();
    const save = storeSave(store, "save", report);

    vi.mocked(store.set).mockResolvedValueOnce(denied);
    save.commit(newPlayer, 1);
    save.commit(counted(1), 1);
    await save.flush();

    expect(report).toHaveBeenCalledExactlyOnceWith(
      "[game] The save was not stored: denied, store.set not allowed.\n  Check the store permission of the native build; progress since the last stored save is lost on close."
    );
    // The refused write never reached the fake's record; the next one did, with the whole document.
    expect(store.set).toHaveBeenCalledTimes(2);
    expect(written).toEqual([
      { state: { player: { count: 1 }, rng: { seed: 42, streams: {} } }, version: 1 }
    ]);
  });

  it("reports a write that throws and goes on with the next one", async () => {
    const { store, written } = plainStore({ ok: true, value: undefined, provider: "web" });
    const report = vi.fn();
    const save = storeSave(store, "save", report);

    vi.mocked(store.set).mockRejectedValueOnce(new Error("the webview went away"));
    save.commit(newPlayer, 1);
    save.commit(counted(1), 1);
    await save.flush();

    expect(report).toHaveBeenCalledExactlyOnceWith(
      "[game] The save was not stored: the webview went away.\n  Check the store permission of the native build; progress since the last stored save is lost on close."
    );
    expect(written).toHaveLength(1);
  });

  it("names a thrown value that is not an error by its text", async () => {
    const { store } = plainStore({ ok: true, value: undefined, provider: "web" });
    const save = storeSave(store, "save", vi.fn());

    vi.mocked(store.set).mockRejectedValueOnce("offline");

    await expect(save.commitDurable(newPlayer, "shop/grant#3@1000000", 1)).rejects.toThrow(
      "[game] The save was not stored: offline.\n"
    );
  });

  it("throws a patch the held document cannot take from commit, and writes nothing", () => {
    const { store } = plainStore({ ok: true, value: undefined, provider: "web" });
    const save = storeSave(store, "save", vi.fn());

    expect(() => save.commit(counted(1), 1)).toThrow();
    expect(store.set).not.toHaveBeenCalled();
  });

  it("flush resolves at once when nothing was committed", async () => {
    const { store } = plainStore({ ok: true, value: undefined, provider: "web" });

    await expect(storeSave(store, "save", vi.fn()).flush()).resolves.toBeUndefined();
    expect(store.set).not.toHaveBeenCalled();
  });
});
