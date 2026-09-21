import { beforeAll, describe, expect, it } from "vitest";
import {
  deepFreeze,
  dropDrafts,
  enableDraftPatches,
  finishDrafts,
  openDrafts
} from "../../store/drafts";
import type { SaveDoc } from "../../store/types";
import type { Json } from "../../types";

beforeAll(() => {
  enableDraftPatches();
});

const record = (value: Json): Record<string, Json> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The test expected a record.");
  }
  return value;
};

const baseDoc = (): SaveDoc =>
  deepFreeze({ player: { coins: 1, bag: ["key"] }, rng: { seed: 7, streams: {} } });

const baseSession = (): Json => deepFreeze({ screen: "boot" });

describe("deepFreeze", () => {
  it("freezes the tree and every branch of it", () => {
    const tree = deepFreeze({ player: { bag: ["key"] } });

    expect(Object.isFrozen(tree)).toBe(true);
    expect(Object.isFrozen(tree.player)).toBe(true);
    expect(Object.isFrozen(tree.player.bag)).toBe(true);
  });

  it("returns the same reference", () => {
    const tree = { coins: 1 };

    expect(deepFreeze(tree)).toBe(tree);
  });

  it("accepts a primitive", () => {
    expect(deepFreeze(7)).toBe(7);
  });
});

describe("enableDraftPatches", () => {
  it("can be called twice", () => {
    expect(() => {
      enableDraftPatches();
      enableDraftPatches();
    }).not.toThrow();
  });
});

describe("openDrafts", () => {
  it("carries the current values into the drafts", () => {
    const pair = openDrafts(baseDoc(), baseSession());

    expect(record(pair.doc.player).coins).toBe(1);
    expect(record(pair.session).screen).toBe("boot");

    dropDrafts(pair);
  });

  it("opens a mutable draft over a frozen tree", () => {
    const pair = openDrafts(baseDoc(), baseSession());

    record(pair.doc.player).coins = 5;

    expect(record(pair.doc.player).coins).toBe(5);

    dropDrafts(pair);
  });
});

describe("finishDrafts", () => {
  it("returns the patches of the player root", () => {
    const pair = openDrafts(baseDoc(), baseSession());
    record(pair.doc.player).coins = 5;

    const result = finishDrafts(pair);

    expect(result.patches.doc).toEqual([{ op: "replace", path: ["player", "coins"], value: 5 }]);
    expect(result.patches.session).toEqual([]);
    expect(result.roots).toEqual(["player"]);
  });

  it("returns the patches of the session tree without its root segment", () => {
    const pair = openDrafts(baseDoc(), baseSession());
    record(pair.session).screen = "board";

    const result = finishDrafts(pair);

    expect(result.patches.session).toEqual([{ op: "replace", path: ["screen"], value: "board" }]);
    expect(result.patches.doc).toEqual([]);
    expect(result.roots).toEqual(["session"]);
  });

  it("reports the rng root when a stream advances", () => {
    const pair = openDrafts(baseDoc(), baseSession());
    pair.doc.rng.streams["chest:42"] = 99;

    const result = finishDrafts(pair);

    expect(result.patches.doc).toEqual([
      { op: "add", path: ["rng", "streams", "chest:42"], value: 99 }
    ]);
    expect(result.roots).toEqual(["rng"]);
  });

  it("reports the roots in a fixed order", () => {
    const pair = openDrafts(baseDoc(), baseSession());
    pair.doc.rng.streams.a = 1;
    record(pair.doc.player).coins = 2;
    record(pair.session).screen = "board";

    expect(finishDrafts(pair).roots).toEqual(["player", "session", "rng"]);
  });

  it("omits the value of a removal patch", () => {
    const pair = openDrafts(baseDoc(), baseSession());
    const player = record(pair.doc.player);
    delete player.bag;

    const [patch] = finishDrafts(pair).patches.doc;

    expect(patch).toEqual({ op: "remove", path: ["player", "bag"] });
    expect(patch && "value" in patch).toBe(false);
  });

  it("returns frozen trees", () => {
    const pair = openDrafts(baseDoc(), baseSession());
    record(pair.doc.player).coins = 5;
    record(pair.session).screen = "board";

    const result = finishDrafts(pair);

    expect(Object.isFrozen(result.doc)).toBe(true);
    expect(Object.isFrozen(result.doc.player)).toBe(true);
    expect(Object.isFrozen(result.session)).toBe(true);
  });

  it("leaves the base trees untouched", () => {
    const doc = baseDoc();
    const pair = openDrafts(doc, baseSession());
    record(pair.doc.player).coins = 5;

    finishDrafts(pair);

    expect(record(doc.player).coins).toBe(1);
  });

  it("returns no patches and no roots when nothing was touched", () => {
    const result = finishDrafts(openDrafts(baseDoc(), baseSession()));

    expect(result.patches).toEqual({ doc: [], session: [] });
    expect(result.roots).toEqual([]);
  });

  it("revokes the drafts", () => {
    const pair = openDrafts(baseDoc(), baseSession());
    const leaked = record(pair.doc.player);

    finishDrafts(pair);

    expect(() => {
      leaked.coins = 9;
    }).toThrow();
  });
});

describe("dropDrafts", () => {
  it("leaves the base tree untouched", () => {
    const doc = baseDoc();
    const pair = openDrafts(doc, baseSession());
    record(pair.doc.player).coins = 5;

    dropDrafts(pair);

    expect(record(doc.player).coins).toBe(1);
  });

  it("revokes the drafts", () => {
    const pair = openDrafts(baseDoc(), baseSession());
    const leaked = record(pair.doc.player);

    dropDrafts(pair);

    expect(() => {
      leaked.coins = 9;
    }).toThrow();
  });
});
