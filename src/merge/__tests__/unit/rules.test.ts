import { describe, expect, it } from "vitest";
import { addToWallet, isLegalMerge, merge, sell } from "../../rules";
import type { MergeState } from "../../types";
import { deepFreeze, midGameState, tables } from "./fixtures";

const frozenState = (): MergeState => deepFreeze(midGameState());

const withItems = (cells: { id: string; chain: string; level: number; cell: string }[]) => {
  const state = midGameState();

  return deepFreeze({ ...state, board: { ...state.board, items: cells } });
};

describe("isLegalMerge", () => {
  it("accepts two items of the same chain and level below the top", () => {
    expect(isLegalMerge(frozenState(), "c0_0", "c1_0", tables)).toBe(true);
  });

  it("rejects a cell merged into itself", () => {
    expect(isLegalMerge(frozenState(), "c0_0", "c0_0", tables)).toBe(false);
  });

  it("rejects an empty source or target", () => {
    expect(isLegalMerge(frozenState(), "c2_2", "c1_0", tables)).toBe(false);
    expect(isLegalMerge(frozenState(), "c0_0", "c2_2", tables)).toBe(false);
  });

  it("rejects two different chains", () => {
    expect(isLegalMerge(frozenState(), "c0_0", "c4_0", tables)).toBe(false);
  });

  it("rejects two different levels", () => {
    expect(isLegalMerge(frozenState(), "c0_0", "c2_0", tables)).toBe(false);
  });

  it("rejects a pair that already sits at the chain's top", () => {
    const state = withItems([
      { id: "a", chain: "wood", level: 3, cell: "c0_0" },
      { id: "b", chain: "wood", level: 3, cell: "c1_0" }
    ]);

    expect(isLegalMerge(state, "c0_0", "c1_0", tables)).toBe(false);
  });

  it("throws for an item whose chain is not in the chain table", () => {
    const state = withItems([
      { id: "a", chain: "glass", level: 1, cell: "c0_0" },
      { id: "b", chain: "glass", level: 1, cell: "c1_0" }
    ]);

    expect(() => isLegalMerge(state, "c0_0", "c1_0", tables)).toThrow(/^\[merge] /);
  });
});

describe("merge", () => {
  it("raises the target by one level and keeps its id and cell", () => {
    const result = merge(frozenState(), "c0_0", "c1_0", tables);

    expect(result).toMatchObject({
      legal: true,
      item: { id: "i2", chain: "wood", level: 2, cell: "c1_0" }
    });
  });

  it("removes the dragged item and keeps every other item", () => {
    const result = merge(frozenState(), "c0_0", "c1_0", tables);

    if (!result.legal) throw new Error("merge should be legal");
    expect(result.state.board.items.map(item => item.id)).toEqual(["i2", "i3", "i4", "i5"]);
  });

  it("mints no new id", () => {
    const result = merge(frozenState(), "c0_0", "c1_0", tables);

    if (!result.legal) throw new Error("merge should be legal");
    expect(result.state.nextItemId).toBe(6);
  });

  it("leaves the frozen input state untouched", () => {
    const state = frozenState();
    const result = merge(state, "c0_0", "c1_0", tables);

    expect(result.legal).toBe(true);
    expect(state.board.items).toHaveLength(5);
    expect(state.board.items[1]?.level).toBe(1);
  });

  it("reports same-cell", () => {
    expect(merge(frozenState(), "c0_0", "c0_0", tables)).toEqual({
      legal: false,
      reason: "same-cell"
    });
  });

  it("reports empty for a source with no item", () => {
    expect(merge(frozenState(), "c2_2", "c1_0", tables)).toEqual({ legal: false, reason: "empty" });
  });

  it("reports empty for a target with no item", () => {
    expect(merge(frozenState(), "c0_0", "c2_2", tables)).toEqual({ legal: false, reason: "empty" });
  });

  it("reports different for another chain", () => {
    expect(merge(frozenState(), "c0_0", "c4_0", tables)).toEqual({
      legal: false,
      reason: "different"
    });
  });

  it("reports different for another level", () => {
    expect(merge(frozenState(), "c0_0", "c2_0", tables)).toEqual({
      legal: false,
      reason: "different"
    });
  });

  it("reports top for a pair at the chain's top", () => {
    const state = withItems([
      { id: "a", chain: "wood", level: 3, cell: "c0_0" },
      { id: "b", chain: "wood", level: 3, cell: "c1_0" }
    ]);

    expect(merge(state, "c0_0", "c1_0", tables)).toEqual({ legal: false, reason: "top" });
  });

  it("throws a two-sentence [merge] error for an unknown chain", () => {
    const state = withItems([
      { id: "a", chain: "glass", level: 1, cell: "c0_0" },
      { id: "b", chain: "glass", level: 1, cell: "c1_0" }
    ]);

    expect(() => merge(state, "c0_0", "c1_0", tables)).toThrow(
      '[merge] The chain "glass" is not in the chain table.\n  Add it to tables.chains or fix the item\'s chain.'
    );
  });
});

describe("sell", () => {
  it("pays the price of the item's level, one-based", () => {
    const result = sell(frozenState(), "i3", tables);

    expect(result).toMatchObject({ ok: true, coins: 3 });
  });

  it("adds the coins to the wallet in the same result", () => {
    const result = sell(frozenState(), "i3", tables);

    if (!result.ok) throw new Error("sell should succeed");
    expect(result.state.wallet.coins).toBe(103);
  });

  it("takes the item off the board", () => {
    const result = sell(frozenState(), "i3", tables);

    if (!result.ok) throw new Error("sell should succeed");
    expect(result.state.board.items.map(item => item.id)).toEqual(["i1", "i2", "i4", "i5"]);
  });

  it("starts from zero when the wallet has no coins yet", () => {
    const state = deepFreeze({ ...midGameState(), wallet: {} });
    const result = sell(state, "i1", tables);

    if (!result.ok) throw new Error("sell should succeed");
    expect(result.state.wallet.coins).toBe(1);
  });

  it("pays nothing for a level the chain has no price for", () => {
    const state = withItems([{ id: "a", chain: "stone", level: 3, cell: "c0_0" }]);
    const result = sell(state, "a", tables);

    expect(result).toMatchObject({ ok: true, coins: 0 });
  });

  it("reports missing for an item that is not on the board", () => {
    expect(sell(frozenState(), "i99", tables)).toEqual({ ok: false, reason: "missing" });
  });

  it("throws for an item whose chain is not in the chain table", () => {
    const state = withItems([{ id: "a", chain: "glass", level: 1, cell: "c0_0" }]);

    expect(() => sell(state, "a", tables)).toThrow(/^\[merge] .+\.\n {2}.+\.$/s);
  });

  it("leaves the frozen input state untouched", () => {
    const state = frozenState();

    expect(sell(state, "i3", tables).ok).toBe(true);
    expect(state.wallet.coins).toBe(100);
    expect(state.board.items).toHaveLength(5);
  });
});

describe("addToWallet", () => {
  it("adds every counter of the gain and keeps the rest", () => {
    const wallet = deepFreeze({ coins: 10, gems: 1 });

    expect(addToWallet(wallet, { coins: 5, stars: 2 })).toEqual({ coins: 15, gems: 1, stars: 2 });
  });

  it("leaves the frozen input wallet untouched", () => {
    const wallet = deepFreeze({ coins: 10 });

    addToWallet(wallet, { coins: 5 });
    expect(wallet.coins).toBe(10);
  });
});
