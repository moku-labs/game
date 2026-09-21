import { describe, expect, it } from "vitest";
import { memory, saveOf } from "../../store/providers/memory";
import type { Patch } from "../../store/types";

const patches: Patch[] = [{ op: "replace", path: ["player", "coins"], value: 3 }];

describe("saveOf", () => {
  it("builds a save document with no streams drawn yet", () => {
    expect(saveOf({ coins: 5 })).toEqual({ player: { coins: 5 }, rng: { seed: 1, streams: {} } });
  });

  it("takes the seed of the save", () => {
    expect(saveOf({ coins: 5 }, 42).rng.seed).toBe(42);
  });
});

describe("memory provider", () => {
  it("reports a new player when it has no fixture", async () => {
    const provider = memory();

    await expect(provider.load()).resolves.toBeNull();
  });

  it("returns the fixture it was built with", async () => {
    const state = saveOf({ coins: 5 }, 42);
    const provider = memory({ state, version: 2 });

    await expect(provider.load()).resolves.toEqual({ state, version: 2 });
  });

  it("records a load", async () => {
    const provider = memory();

    await provider.load();

    expect(provider.calls).toEqual([{ method: "load" }]);
  });

  it("records a commit with its patches and version", () => {
    const provider = memory();

    provider.commit(patches, 1);

    expect(provider.calls).toEqual([{ method: "commit", patches, version: 1 }]);
  });

  it("records a durable commit with its transaction id", async () => {
    const provider = memory();

    await provider.commitDurable(patches, "tx-1", 1);

    expect(provider.calls).toEqual([
      { method: "commitDurable", patches, txId: "tx-1", version: 1 }
    ]);
  });

  it("records a flush", async () => {
    const provider = memory();

    await provider.flush();

    expect(provider.calls).toEqual([{ method: "flush" }]);
  });

  it("records the calls in order", async () => {
    const provider = memory();

    await provider.load();
    provider.commit(patches, 1);
    await provider.flush();

    expect(provider.calls.map(call => call.method)).toEqual(["load", "commit", "flush"]);
  });

  it("keeps two providers apart", () => {
    const first = memory();
    const second = memory();

    first.commit(patches, 1);

    expect(second.calls).toEqual([]);
  });

  it("persists nothing: a second load still reports the fixture", async () => {
    const provider = memory({ state: saveOf({ coins: 5 }, 42), version: 1 });

    provider.commit(patches, 1);
    const reloaded = await provider.load();

    expect(reloaded?.state).toEqual(saveOf({ coins: 5 }, 42));
  });
});
