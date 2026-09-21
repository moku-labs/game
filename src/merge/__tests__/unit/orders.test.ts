import { describe, expect, it } from "vitest";
import { giveToOrder, isLegalOrderMatch } from "../../orders";
import type { MergeState, Order } from "../../types";
import { deepFreeze, midGameState, scriptedRng, tables } from "./fixtures";

const woodOrder = (given: number[]): Order => ({
  id: 7,
  needs: [
    { chain: "wood", level: 2 },
    { chain: "wood", level: 3 }
  ],
  given,
  rewardId: "coins-small"
});

const stateWith = (patch: Partial<MergeState>): MergeState =>
  deepFreeze({ ...midGameState(), ...patch });

const frozenState = (): MergeState => deepFreeze(midGameState());

const readyToComplete = (): MergeState => stateWith({ orders: [woodOrder([0])] });

describe("isLegalOrderMatch", () => {
  it("accepts an item that fills an open need", () => {
    expect(isLegalOrderMatch(frozenState(), "i3", 7)).toBe(true);
    expect(isLegalOrderMatch(frozenState(), "i4", 7)).toBe(true);
  });

  it("rejects an item no need asks for", () => {
    expect(isLegalOrderMatch(frozenState(), "i1", 7)).toBe(false);
  });

  it("rejects an item that is not on the board", () => {
    expect(isLegalOrderMatch(frozenState(), "i99", 7)).toBe(false);
  });

  it("rejects an order slot that does not exist", () => {
    expect(isLegalOrderMatch(frozenState(), "i3", 99)).toBe(false);
  });

  it("rejects a need that is already given", () => {
    const state = stateWith({ orders: [woodOrder([0])] });

    expect(isLegalOrderMatch(state, "i3", 7)).toBe(false);
    expect(isLegalOrderMatch(state, "i4", 7)).toBe(true);
  });
});

describe("giveToOrder", () => {
  it("marks the need and takes the item off the board", () => {
    const result = giveToOrder(frozenState(), { item: "i3", order: 7 }, tables, scriptedRng([0]));

    if (!result.ok) throw new Error(`give should succeed, got ${result.reason}`);
    expect(result.completed).toBe(false);
    expect(result.state.orders[0]?.given).toEqual([0]);
    expect(result.state.board.items.map(item => item.id)).toEqual(["i1", "i2", "i4", "i5"]);
  });

  it("marks the need the item actually fits", () => {
    const result = giveToOrder(frozenState(), { item: "i4", order: 7 }, tables, scriptedRng([0]));

    if (!result.ok) throw new Error("give should succeed");
    expect(result.state.orders[0]?.given).toEqual([1]);
  });

  it("pays nothing while the order is still open", () => {
    const result = giveToOrder(frozenState(), { item: "i3", order: 7 }, tables, scriptedRng([0]));

    if (!result.ok) throw new Error("give should succeed");
    expect(result.state.wallet.coins).toBe(100);
    expect(result.rewardId).toBeUndefined();
  });

  it("leaves the frozen input state untouched", () => {
    const state = frozenState();

    giveToOrder(state, { item: "i3", order: 7 }, tables, scriptedRng([0]));
    expect(state.orders[0]?.given).toEqual([]);
    expect(state.board.items).toHaveLength(5);
  });

  it("reports missing for an item that is not on the board", () => {
    expect(giveToOrder(frozenState(), { item: "i99", order: 7 }, tables, scriptedRng([0]))).toEqual(
      {
        ok: false,
        reason: "missing"
      }
    );
  });

  it("reports missing for an order slot that does not exist", () => {
    expect(giveToOrder(frozenState(), { item: "i3", order: 99 }, tables, scriptedRng([0]))).toEqual(
      {
        ok: false,
        reason: "missing"
      }
    );
  });

  it("reports no-match for an item no open need asks for", () => {
    expect(giveToOrder(frozenState(), { item: "i1", order: 7 }, tables, scriptedRng([0]))).toEqual({
      ok: false,
      reason: "no-match"
    });
  });

  it("reports no-match when the only fitting need is already given", () => {
    const state = stateWith({ orders: [woodOrder([0])] });

    expect(giveToOrder(state, { item: "i3", order: 7 }, tables, scriptedRng([0]))).toMatchObject({
      reason: "no-match"
    });
  });
});

describe("giveToOrder on the last need", () => {
  it("reports the reward it paid", () => {
    const result = giveToOrder(
      readyToComplete(),
      { item: "i4", order: 7 },
      tables,
      scriptedRng([0])
    );

    expect(result).toMatchObject({ ok: true, completed: true, rewardId: "coins-small" });
  });

  it("pays the reward into the wallet of the same result", () => {
    const result = giveToOrder(
      readyToComplete(),
      { item: "i4", order: 7 },
      tables,
      scriptedRng([0])
    );

    if (!result.ok) throw new Error("give should succeed");
    expect(result.state.wallet).toEqual({ coins: 125 });
  });

  it("pays every counter of a reward", () => {
    const state = stateWith({
      board: {
        cols: 5,
        rows: 5,
        items: [{ id: "s1", chain: "stone", level: 2, cell: "c0_0" }]
      },
      orders: [{ id: 7, needs: [{ chain: "stone", level: 2 }], given: [], rewardId: "coins-large" }]
    });
    const result = giveToOrder(state, { item: "s1", order: 7 }, tables, scriptedRng([0]));

    if (!result.ok) throw new Error("give should succeed");
    expect(result.state.wallet).toEqual({ coins: 200, gems: 1 });
  });

  it("puts a freshly drawn order into the same slot", () => {
    const result = giveToOrder(
      readyToComplete(),
      { item: "i4", order: 7 },
      tables,
      scriptedRng([0])
    );

    if (!result.ok) throw new Error("give should succeed");
    expect(result.state.orders).toHaveLength(1);
    expect(result.state.orders[0]).toEqual({
      id: 8,
      needs: [
        { chain: "wood", level: 2 },
        { chain: "wood", level: 3 }
      ],
      given: [],
      rewardId: "coins-small"
    });
  });

  it("draws the next order by weight", () => {
    const result = giveToOrder(
      readyToComplete(),
      { item: "i4", order: 7 },
      tables,
      scriptedRng([3])
    );

    if (!result.ok) throw new Error("give should succeed");
    expect(result.state.orders[0]?.rewardId).toBe("coins-large");
  });

  it("gives the new order one more than the highest id in play", () => {
    const state = stateWith({
      orders: [woodOrder([0]), { id: 12, needs: [], given: [], rewardId: "coins-small" }]
    });
    const result = giveToOrder(state, { item: "i4", order: 7 }, tables, scriptedRng([0]));

    if (!result.ok) throw new Error("give should succeed");
    expect(result.state.orders[0]?.id).toBe(13);
    expect(result.state.orders[1]?.id).toBe(12);
  });

  it("throws a two-sentence [merge] error for a reward the order table does not know", () => {
    const state = stateWith({
      orders: [{ ...woodOrder([0]), rewardId: "coins-huge" }]
    });

    expect(() => giveToOrder(state, { item: "i4", order: 7 }, tables, scriptedRng([0]))).toThrow(
      '[merge] The reward "coins-huge" is not in the order table.\n  Add an entry with this rewardId to tables.orders.'
    );
  });
});
