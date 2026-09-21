import { describe, expect, it } from "vitest";
import { memory, saveOf } from "../../store/providers/memory";
import type { Patch } from "../../store/types";

const patches: Patch[] = [{ op: "replace", path: ["player", "coins"], value: 3 }];

/** A fresh provider with a save at version 1, the base the patches above apply to. */
const stored = () => memory({ state: saveOf({ coins: 0 }), version: 1 });

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
    const provider = stored();

    provider.commit(patches, 1);

    expect(provider.calls).toEqual([{ method: "commit", patches, version: 1 }]);
  });

  it("records a durable commit with its transaction id", async () => {
    const provider = stored();

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
    const provider = stored();

    await provider.load();
    provider.commit(patches, 1);
    await provider.flush();

    expect(provider.calls.map(call => call.method)).toEqual(["load", "commit", "flush"]);
  });

  it("keeps two providers apart", () => {
    const first = stored();
    const second = stored();

    first.commit(patches, 1);

    expect(second.calls).toEqual([]);
  });

  it("keeps what it committed: a second load returns the patched document", async () => {
    const provider = stored();

    provider.commit(patches, 1);
    const reloaded = await provider.load();

    expect(reloaded).toEqual({ state: saveOf({ coins: 3 }), version: 1 });
  });

  it("takes a whole-document replace from a provider that stored nothing", async () => {
    const provider = memory();
    const document = saveOf({ coins: 9 }, 42);

    provider.commit([{ op: "replace", path: [], value: document }], 2);

    await expect(provider.load()).resolves.toEqual({ state: document, version: 2 });
  });

  it("applies a durable commit as well", async () => {
    const provider = stored();

    await provider.commitDurable(patches, "tx-1", 1);
    const reloaded = await provider.load();

    expect(reloaded?.state).toEqual(saveOf({ coins: 3 }));
  });

  it("shares no document between two instances", async () => {
    const first = memory();
    const second = memory();

    first.commit([{ op: "replace", path: [], value: saveOf({ coins: 9 }) }], 1);

    await expect(second.load()).resolves.toBeNull();
  });

  it("leaves the fixture it was given untouched", async () => {
    const document = saveOf({ coins: 5 }, 42);
    const provider = memory({ state: document, version: 1 });

    provider.commit(patches, 1);

    expect(document.player).toEqual({ coins: 5 });
    await expect(provider.load()).resolves.toEqual({ state: saveOf({ coins: 3 }, 42), version: 1 });
  });
});
