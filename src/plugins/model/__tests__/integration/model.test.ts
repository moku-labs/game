import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { coreConfig, createCore, createPlugin } from "../../../../config";
import { modelPlugin } from "../../index";
import { memory } from "../../store/providers/memory";
import type { Snapshot, Transaction } from "../../store/types";
import type { Events, Json, Root } from "../../types";

/** Typed no-op `emit`: the type-level test below only checks what the compiler accepts. */
const emit = <Name extends keyof Events>(_name: Name, _payload: Events[Name]): void => {};

type Committed = Events["model:committed"];

const record = (value: Json): Record<string, Json> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The test expected a record.");
  }
  return value;
};

// A bare framework: `lifecycle` and `flow` of the default set are still stubs.
const createTestApp = () => {
  const seen: Committed[] = [];
  const provider = memory();
  const listenerPlugin = createPlugin("listener", {
    depends: [modelPlugin],
    hooks: () => ({
      "model:committed": payload => {
        expectTypeOf(payload).toEqualTypeOf<Committed>();
        seen.push(payload);
      }
    })
  });
  const { createApp } = createCore(coreConfig, { plugins: [] });
  const app = createApp({
    plugins: [modelPlugin, listenerPlugin],
    pluginConfigs: {
      model: {
        playerProvider: provider,
        seed: 7,
        initialPlayer: { coins: 0 },
        initialSession: { screen: "boot" }
      }
    }
  });

  return { app, provider, seen };
};

describe("model plugin", () => {
  it("groups its API by module", () => {
    const { app } = createTestApp();

    expect(app.model.store).toBeDefined();
    expect(app.model.rng).toBeDefined();
  });

  it("runs the cycle of one node: load, begin, mutate, commit, rest", async () => {
    const { app, provider } = createTestApp();
    await app.start();

    await app.model.store.load();
    const transaction = app.model.store.begin();
    record(transaction.player).coins = 5;
    transaction.rng.stream("chest:42").int(6);
    transaction.commit();
    app.model.store.markRest();
    await app.stop();

    expect(record(app.model.store.snapshot().player).coins).toBe(5);
    expect(provider.calls.map(call => call.method)).toEqual(["load", "commit", "commit", "flush"]);
  });

  it("delivers the committed event to a listener plugin", async () => {
    const { app, seen } = createTestApp();
    await app.start();

    await app.model.store.load();
    const transaction = app.model.store.begin();
    record(transaction.player).coins = 5;
    transaction.commit();
    await app.stop();

    expect(seen).toEqual([
      { roots: ["player", "session", "rng"], cause: "load" },
      { roots: ["player"], cause: "edge" }
    ]);
  });

  it("flushes the provider when the app stops", async () => {
    const { app, provider } = createTestApp();
    await app.start();

    await app.stop();

    expect(provider.calls).toEqual([{ method: "flush" }]);
  });

  it("rejects app.stop() with the error of a failing provider flush", async () => {
    const { app, provider } = createTestApp();
    const failure = new Error("disk full");

    vi.spyOn(provider, "flush").mockRejectedValue(failure);
    await app.start();

    await expect(app.stop()).rejects.toBe(failure);
  });

  it("keeps the drawn stream in the save document", async () => {
    const { app } = createTestApp();
    await app.start();

    await app.model.store.load();
    const transaction = app.model.store.begin();
    const rolled = transaction.rng.stream("chest:42").int(6);
    transaction.commit();
    await app.stop();

    expect(rolled).toBeGreaterThanOrEqual(0);
    expect(app.model.rng.peek("chest:42")).toBeDefined();
  });

  it("falls back to an in-memory provider when none is configured", async () => {
    const { createApp } = createCore(coreConfig, { plugins: [] });
    const app = createApp({
      plugins: [modelPlugin],
      pluginConfigs: { model: { seed: 7, initialPlayer: { coins: 0 } } }
    });
    await app.start();

    await app.model.store.load();
    await app.stop();

    expect(app.model.store.snapshot().player).toEqual({ coins: 0 });
  });

  it("rolls the state back to the last rest point", async () => {
    const { app } = createTestApp();
    await app.start();

    await app.model.store.load();
    app.model.store.markRest();
    const transaction = app.model.store.begin();
    record(transaction.player).coins = 5;
    transaction.commit();
    app.model.store.rollback();
    await app.stop();

    expect(record(app.model.store.snapshot().player).coins).toBe(0);
  });
});

describe("model types", () => {
  it("types the snapshot as read-only and the drafts as mutable", () => {
    const { app } = createTestApp();

    expectTypeOf(app.model.store.snapshot()).toEqualTypeOf<Snapshot>();
    expectTypeOf(app.model.store.begin).returns.toEqualTypeOf<Transaction>();
    expectTypeOf<Transaction["player"]>().toEqualTypeOf<Json>();
    expectTypeOf(app.model.rng.peek).returns.toEqualTypeOf<number | undefined>();
  });

  it("rejects a payload that is not a root", () => {
    // @ts-expect-error — "x" is not a Root
    emit("model:committed", { roots: ["x"], cause: "edge" });

    expectTypeOf<Committed["roots"]>().toEqualTypeOf<readonly Root[]>();
    expectTypeOf<Committed["cause"]>().toEqualTypeOf<"edge" | "rollback" | "restore" | "load">();
  });
});
