import type { Log } from "@moku-labs/common/browser";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createRngView } from "../../rng/api";
import { createModelState } from "../../state";
import { createStoreApi } from "../../store/api";
import { memory, saveOf } from "../../store/providers/memory";
import type { Migration, Snapshot } from "../../store/types";
import { SaveUnreadableError } from "../../store/types";
import type { Config, Json, ModelCtx } from "../../types";

type MemoryProvider = ReturnType<typeof memory>;

const record = (value: Json): Record<string, Json> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The test expected a record.");
  }
  return value;
};

const createMockLog = (): Log.LogApi => ({
  addSink: vi.fn(),
  clearSinks: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  expect: vi.fn(),
  info: vi.fn(),
  reset: vi.fn(),
  trace: vi.fn(() => []),
  warn: vi.fn()
});

const setup = (options: { provider?: MemoryProvider; config?: Partial<Config> } = {}) => {
  const provider = options.provider ?? memory();
  const config: Config = {
    playerProvider: provider,
    initialPlayer: { coins: 0 },
    initialSession: { screen: "boot" },
    seed: 7,
    schemaVersion: 1,
    migrations: [],
    ...options.config
  };
  const state = createModelState({ global: {}, config });
  const emit = vi.fn();
  const log = createMockLog();
  const ctx: ModelCtx = { config, emit, global: {}, log, state };

  return { api: createStoreApi(ctx, { createRngView }), config, emit, log, provider, state };
};

const addStage: Migration = {
  from: 1,
  up: state => ({ ...record(state), stage: 1 })
};

// ─── load ────────────────────────────────────────────────────

describe("load", () => {
  it("builds the document of a new player from the initial player", async () => {
    const { api } = setup();

    await api.load();

    expect(api.snapshot().player).toEqual({ coins: 0 });
    expect(api.snapshot().rng).toEqual({ seed: 7, streams: {} });
  });

  it("marks the state as loaded and emits the load cause", async () => {
    const { api, emit, state } = setup();

    await api.load();

    expect(state.store.loaded).toBe(true);
    expect(emit).toHaveBeenCalledWith("model:committed", {
      roots: ["player", "session", "rng"],
      cause: "load"
    });
  });

  it("queues the whole document for a new player", async () => {
    const { api, state } = setup();

    await api.load();

    expect(state.store.pending).toEqual([{ op: "replace", path: [], value: state.store.doc }]);
  });

  it("draws a seed once for a brand-new player", async () => {
    const draw = vi.spyOn(globalThis.crypto, "getRandomValues");
    const { api } = setup({ config: { seed: "from-save" } });

    await api.load();

    expect(draw).toHaveBeenCalledTimes(1);
    expect(Number.isInteger(api.snapshot().rng.seed)).toBe(true);
    draw.mockRestore();
  });

  it("never draws a seed for a player that has a save", async () => {
    const draw = vi.spyOn(globalThis.crypto, "getRandomValues");
    const provider = memory({ state: saveOf({ coins: 5 }, 42), version: 1 });
    const { api } = setup({ provider, config: { seed: "from-save" } });

    await api.load();

    expect(draw).not.toHaveBeenCalled();
    expect(api.snapshot().rng.seed).toBe(42);
    draw.mockRestore();
  });

  it("takes the saved document as it is and queues nothing", async () => {
    const provider = memory({ state: saveOf({ coins: 5 }, 42), version: 1 });
    const { api, state } = setup({ provider });

    await api.load();

    expect(api.snapshot().player).toEqual({ coins: 5 });
    expect(state.store.pending).toEqual([]);
  });

  it("does not freeze the document the provider handed over", async () => {
    const state = saveOf({ coins: 5 }, 42);
    const provider = memory({ state, version: 1 });
    const { api } = setup({ provider });

    await api.load();

    expect(Object.isFrozen(state.player)).toBe(false);
    expect(api.snapshot().player).not.toBe(state.player);
  });

  it("sets the rest point to the loaded trees", async () => {
    const { api, state } = setup();

    await api.load();

    expect(state.store.restPoint?.doc).toBe(state.store.doc);
    expect(state.store.restPoint?.session).toBe(state.store.session);
  });

  it("runs the migration chain and queues the whole document", async () => {
    const provider = memory({ state: saveOf({ coins: 5 }, 42), version: 1 });
    const { api, state } = setup({
      provider,
      config: { schemaVersion: 2, migrations: [addStage] }
    });

    await api.load();

    expect(record(api.snapshot().player).coins).toBe(5);
    expect(state.store.pending).toHaveLength(1);
    expect(state.store.pending[0]?.path).toEqual([]);
  });

  it("logs every migration step", async () => {
    const provider = memory({ state: saveOf({ coins: 5 }, 42), version: 1 });
    const { api, log } = setup({
      provider,
      config: { schemaVersion: 2, migrations: [addStage] }
    });

    await api.load();

    expect(log.info).toHaveBeenCalledWith("model:migrated", { from: 1, to: 2 });
  });

  it("rejects a save newer than the schema and leaves the state untouched", async () => {
    const provider = memory({ state: saveOf({ coins: 5 }, 42), version: 4 });
    const { api, state } = setup({ provider });
    const before = state.store.doc;

    await expect(api.load()).rejects.toBeInstanceOf(SaveUnreadableError);
    expect(state.store.doc).toBe(before);
    expect(state.store.loaded).toBe(false);
    expect(state.store.pending).toEqual([]);
  });

  it("rejects when a migration step is missing", async () => {
    const provider = memory({ state: saveOf({ coins: 5 }, 42), version: 1 });
    const { api } = setup({ provider, config: { schemaVersion: 3, migrations: [addStage] } });

    await expect(api.load()).rejects.toBeInstanceOf(SaveUnreadableError);
  });

  it("reports a failing provider and leaves the state untouched", async () => {
    const failure = new Error("disk gone");
    const provider: MemoryProvider = {
      ...memory(),
      load: async () => {
        throw failure;
      }
    };
    const { api, log, state } = setup({ provider });

    await expect(api.load()).rejects.toBe(failure);
    expect(state.store.loaded).toBe(false);
    expect(log.error).toHaveBeenCalledWith("model:provider-failed", {
      method: "load",
      error: failure
    });
  });
});

// ─── snapshot ────────────────────────────────────────────────

describe("snapshot", () => {
  it("returns frozen trees", async () => {
    const { api } = setup();
    await api.load();

    const snapshot = api.snapshot();

    expect(Object.isFrozen(snapshot.player)).toBe(true);
    expect(Object.isFrozen(snapshot.session)).toBe(true);
    expect(Object.isFrozen(snapshot.rng)).toBe(true);
  });

  it("shows the session of the configuration", () => {
    const { api } = setup();

    expect(api.snapshot().session).toEqual({ screen: "boot" });
  });

  it("is typed as a read-only snapshot", () => {
    const { api } = setup();

    expectTypeOf(api.snapshot()).toEqualTypeOf<Snapshot>();
    expectTypeOf(api.snapshot().rng.seed).toEqualTypeOf<number>();
  });
});

// ─── transactions ────────────────────────────────────────────

describe("begin", () => {
  it("throws when a transaction is already open", async () => {
    const { api } = setup();
    await api.load();
    api.begin();

    expect(() => api.begin()).toThrow(/^\[game] /);
    expect(() => api.begin()).toThrow(/\n {2}.*\.$/);
  });

  it("hands out mutable drafts of the player and the session", async () => {
    const { api } = setup();
    await api.load();

    const transaction = api.begin();
    record(transaction.player).coins = 5;
    record(transaction.session).screen = "board";

    expect(record(transaction.player).coins).toBe(5);
    transaction.discard();
  });
});

describe("commit", () => {
  it("swaps the frozen trees", async () => {
    const { api } = setup();
    await api.load();

    const transaction = api.begin();
    record(transaction.player).coins = 5;
    transaction.commit();

    expect(record(api.snapshot().player).coins).toBe(5);
    expect(Object.isFrozen(api.snapshot().player)).toBe(true);
  });

  it("returns the patches split by tree and the touched roots", async () => {
    const { api } = setup();
    await api.load();

    const transaction = api.begin();
    record(transaction.player).coins = 5;
    record(transaction.session).screen = "board";
    const result = transaction.commit();

    expect(result.patches.doc).toEqual([{ op: "replace", path: ["player", "coins"], value: 5 }]);
    expect(result.patches.session).toEqual([{ op: "replace", path: ["screen"], value: "board" }]);
    expect(result.roots).toEqual(["player", "session"]);
  });

  it("appends the doc patches to the pending list", async () => {
    const { api, state } = setup({ provider: memory({ state: saveOf({ coins: 0 }), version: 1 }) });
    await api.load();

    const first = api.begin();
    record(first.player).coins = 1;
    first.commit();
    const second = api.begin();
    record(second.player).coins = 2;
    second.commit();

    expect(state.store.pending).toEqual([
      { op: "replace", path: ["player", "coins"], value: 1 },
      { op: "replace", path: ["player", "coins"], value: 2 }
    ]);
  });

  it("emits the edge cause with the touched roots", async () => {
    const { api, emit } = setup();
    await api.load();
    emit.mockClear();

    const transaction = api.begin();
    record(transaction.player).coins = 5;
    transaction.commit();

    expect(emit).toHaveBeenCalledWith("model:committed", { roots: ["player"], cause: "edge" });
  });

  it("revokes the drafts", async () => {
    const { api } = setup();
    await api.load();

    const transaction = api.begin();
    const leaked = record(transaction.player);
    transaction.commit();

    expect(() => {
      leaked.coins = 9;
    }).toThrow();
  });

  it("throws when the same transaction is committed twice", async () => {
    const { api } = setup();
    await api.load();

    const transaction = api.begin();
    transaction.commit();

    expect(() => transaction.commit()).toThrow(/^\[game] /);
  });

  it("opens a new transaction after the commit", async () => {
    const { api } = setup();
    await api.load();

    api.begin().commit();

    expect(() => api.begin()).not.toThrow();
  });
});

describe("discard", () => {
  it("changes nothing and emits nothing", async () => {
    const { api, emit } = setup();
    await api.load();
    const before = api.snapshot().player;
    emit.mockClear();

    const transaction = api.begin();
    record(transaction.player).coins = 5;
    transaction.discard();

    expect(api.snapshot().player).toBe(before);
    expect(emit).not.toHaveBeenCalled();
  });

  it("throws when the transaction is already closed", async () => {
    const { api } = setup();
    await api.load();

    const transaction = api.begin();
    transaction.discard();

    expect(() => transaction.discard()).toThrow(/^\[game] /);
  });
});

describe("transaction rng", () => {
  it("advances the committed stream when the transaction commits", async () => {
    const { api } = setup();
    await api.load();

    const transaction = api.begin();
    transaction.rng.stream("chest:42").int(6);
    const result = transaction.commit();

    expect(api.snapshot().rng.streams["chest:42"]).toBeDefined();
    expect(result.roots).toEqual(["rng"]);
  });

  it("leaves the committed stream alone when the transaction is discarded", async () => {
    const { api } = setup();
    await api.load();

    const transaction = api.begin();
    transaction.rng.stream("chest:42").int(6);
    transaction.discard();

    expect(api.snapshot().rng.streams["chest:42"]).toBeUndefined();
  });

  it("repeats the draw of a discarded transaction", async () => {
    const { api } = setup();
    await api.load();

    const first = api.begin();
    const discarded = first.rng.stream("chest:42").int(1000);
    first.discard();
    const second = api.begin();
    const repeated = second.rng.stream("chest:42").int(1000);
    second.discard();

    expect(repeated).toBe(discarded);
  });
});

// ─── rest points ─────────────────────────────────────────────

describe("markRest", () => {
  it("hands the pending patches to the provider once and clears them", async () => {
    const { api, provider, state } = setup({
      provider: memory({ state: saveOf({ coins: 0 }), version: 1 })
    });
    await api.load();
    const transaction = api.begin();
    record(transaction.player).coins = 5;
    transaction.commit();

    api.markRest();

    expect(provider.calls).toEqual([
      { method: "load" },
      {
        method: "commit",
        patches: [{ op: "replace", path: ["player", "coins"], value: 5 }],
        version: 1
      }
    ]);
    expect(state.store.pending).toEqual([]);
  });

  it("moves the rest point to the current trees", async () => {
    const { api, state } = setup();
    await api.load();
    const transaction = api.begin();
    record(transaction.player).coins = 5;
    transaction.commit();

    api.markRest();

    expect(state.store.restPoint?.doc).toBe(state.store.doc);
    expect(state.store.restPoint?.session).toBe(state.store.session);
  });

  it("keeps the rest point and the pending patches when the provider throws", async () => {
    const failure = new Error("quota");
    const provider: MemoryProvider = {
      ...memory(),
      commit: () => {
        throw failure;
      }
    };
    const { api, log, state } = setup({ provider });
    await api.load();
    const restPoint = state.store.restPoint;
    const pending = state.store.pending;

    expect(() => api.markRest()).toThrow(failure);
    expect(state.store.restPoint).toBe(restPoint);
    expect(state.store.pending).toBe(pending);
    expect(log.error).toHaveBeenCalledWith("model:provider-failed", {
      method: "commit",
      error: failure
    });
  });
});

describe("markBarrier", () => {
  it("awaits the durable commit and clears the pending patches", async () => {
    const { api, provider, state } = setup({
      provider: memory({ state: saveOf({ coins: 0 }), version: 1 })
    });
    await api.load();
    const transaction = api.begin();
    record(transaction.player).coins = 5;
    transaction.commit();

    await api.markBarrier("tx-1");

    expect(provider.calls).toEqual([
      { method: "load" },
      {
        method: "commitDurable",
        patches: [{ op: "replace", path: ["player", "coins"], value: 5 }],
        txId: "tx-1",
        version: 1
      }
    ]);
    expect(state.store.pending).toEqual([]);
  });

  it("moves the rest point before the durable commit resolves", async () => {
    const durable = Promise.withResolvers<void>();
    const provider: MemoryProvider = {
      ...memory({ state: saveOf({ coins: 0 }), version: 1 }),
      commitDurable: () => durable.promise
    };
    const { api, state } = setup({ provider });
    await api.load();
    const transaction = api.begin();
    record(transaction.player).coins = 5;
    transaction.commit();

    const barrier = api.markBarrier("tx-1");

    expect(state.store.restPoint?.doc).toBe(state.store.doc);
    expect(state.store.pending).toHaveLength(1);
    durable.resolve();
    await barrier;
    expect(state.store.pending).toEqual([]);
  });

  it("keeps the pending patches when the durable commit rejects", async () => {
    const failure = new Error("offline");
    const provider: MemoryProvider = {
      ...memory(),
      commitDurable: async () => {
        throw failure;
      }
    };
    const { api, log, state } = setup({ provider });
    await api.load();
    const pending = state.store.pending;

    await expect(api.markBarrier("tx-1")).rejects.toBe(failure);
    expect(state.store.pending).toBe(pending);
    expect(log.error).toHaveBeenCalledWith("model:provider-failed", {
      method: "commitDurable",
      error: failure
    });
  });
});

// ─── rollback and restore ────────────────────────────────────

describe("rollback", () => {
  it("restores the trees of the last rest point by reference", async () => {
    const { api } = setup();
    await api.load();
    const restPoint = api.snapshot();
    const transaction = api.begin();
    record(transaction.player).coins = 5;
    transaction.commit();

    api.rollback();

    expect(api.snapshot().player).toBe(restPoint.player);
    expect(api.snapshot().session).toBe(restPoint.session);
  });

  it("drops the pending patches of the failed transition", async () => {
    const { api, state } = setup();
    await api.load();
    api.markRest();
    const transaction = api.begin();
    record(transaction.player).coins = 5;
    transaction.commit();

    api.rollback();

    expect(state.store.pending).toEqual([]);
  });

  it("emits the rollback cause with every root", async () => {
    const { api, emit } = setup();
    await api.load();
    emit.mockClear();

    api.rollback();

    expect(emit).toHaveBeenCalledWith("model:committed", {
      roots: ["player", "session", "rng"],
      cause: "rollback"
    });
  });

  it("keeps the trees when there is no rest point yet", () => {
    const { api } = setup();
    const before = api.snapshot().player;

    api.rollback();

    expect(api.snapshot().player).toBe(before);
  });
});

describe("restore", () => {
  it("replaces the player tree and queues the whole document", async () => {
    const { api, state } = setup();
    await api.load();
    api.markRest();

    api.restore({ player: { coins: 99 } });

    expect(api.snapshot().player).toEqual({ coins: 99 });
    expect(state.store.pending).toEqual([{ op: "replace", path: [], value: state.store.doc }]);
  });

  it("freezes the restored trees and clones the input", async () => {
    const { api } = setup();
    await api.load();
    const player = { coins: 99 };

    api.restore({ player });

    expect(Object.isFrozen(api.snapshot().player)).toBe(true);
    expect(Object.isFrozen(player)).toBe(false);
  });

  it("keeps the session and the rng branch when they are omitted", async () => {
    const { api } = setup();
    await api.load();
    const before = api.snapshot();

    api.restore({ player: { coins: 99 } });

    expect(api.snapshot().session).toBe(before.session);
    expect(api.snapshot().rng).toEqual(before.rng);
  });

  it("replaces the session and the rng branch when they are given", async () => {
    const { api } = setup();
    await api.load();

    api.restore({
      player: { coins: 99 },
      session: { screen: "board" },
      rng: { seed: 11, streams: { "chest:1": 3 } }
    });

    expect(api.snapshot().session).toEqual({ screen: "board" });
    expect(api.snapshot().rng).toEqual({ seed: 11, streams: { "chest:1": 3 } });
  });

  it("emits the restore cause with every root", async () => {
    const { api, emit } = setup();
    await api.load();
    emit.mockClear();

    api.restore({ player: { coins: 99 } });

    expect(emit).toHaveBeenCalledWith("model:committed", {
      roots: ["player", "session", "rng"],
      cause: "restore"
    });
  });

  it("throws while a transaction is open", async () => {
    const { api } = setup();
    await api.load();
    api.begin();

    expect(() => api.restore({ player: { coins: 99 } })).toThrow(/^\[game] /);
    expect(() => api.restore({ player: { coins: 99 } })).toThrow(/\n {2}.*\.$/);
  });
});

// ─── flush ───────────────────────────────────────────────────

describe("flush", () => {
  it("calls the provider flush and keeps the pending patches", async () => {
    const { api, provider, state } = setup();
    await api.load();

    await api.flush();

    expect(provider.calls.at(-1)).toEqual({ method: "flush" });
    expect(state.store.pending).toHaveLength(1);
  });

  it("reports a failing flush", async () => {
    const failure = new Error("closed");
    const provider: MemoryProvider = {
      ...memory(),
      flush: async () => {
        throw failure;
      }
    };
    const { api, log } = setup({ provider });

    await expect(api.flush()).rejects.toBe(failure);
    expect(log.error).toHaveBeenCalledWith("model:provider-failed", {
      method: "flush",
      error: failure
    });
  });
});

// ─── review findings of build wave 1 ─────────────────────────

describe("rest point after restore", () => {
  it("rolls back to the restored save, not to the state before the restore", async () => {
    const { api } = setup();
    await api.load();
    api.markRest();

    api.restore({ player: { coins: 500 } });
    const transaction = api.begin();
    record(transaction.player).coins = 501;
    transaction.commit();
    api.rollback();

    expect(api.snapshot().player).toEqual({ coins: 500 });
  });
});

describe("rollback with an open transaction", () => {
  it("closes the transaction, so the next node can begin", async () => {
    const { api } = setup();
    await api.load();
    api.markRest();

    const failed = api.begin();
    record(failed.player).coins = 9;
    api.rollback();

    expect(() => api.begin()).not.toThrow();
    expect(api.snapshot().player).toEqual({ coins: 0 });
  });
});

describe("committed payload", () => {
  it("hands out roots that a listener cannot mutate", async () => {
    const { api, emit } = setup();
    await api.load();

    const payload = emit.mock.calls.at(-1)?.[1];

    expect(Object.isFrozen(payload.roots)).toBe(true);
  });
});
