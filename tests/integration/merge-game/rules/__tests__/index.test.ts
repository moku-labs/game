import { describe, expect, it } from "vitest";
import { elapse, nextDue } from "../elapse";
import { pickDrop, tapGenerator } from "../generators";
import { findFreeCell, itemAt, neighbors } from "../grid";
import { rules } from "../index";
import { place, take } from "../inventory";
import { giveToOrder, isLegalOrderMatch } from "../orders";
import { isLegalMerge, merge, sell } from "../rules";
import { countedAt, deepFreeze, midGameState, scriptedRng, tables } from "./fixtures";

const implementations = {
  neighbors,
  findFreeCell,
  itemAt,
  isLegalMerge,
  merge,
  sell,
  pickDrop,
  tapGenerator,
  isLegalOrderMatch,
  giveToOrder,
  elapse,
  nextDue,
  place,
  take
};

describe("rules", () => {
  it("carries the fourteen rule functions", () => {
    expect(Object.keys(rules)).toHaveLength(14);
  });

  it("points at the implementations themselves", () => {
    expect(rules).toEqual(implementations);
  });

  it("exposes every entry as a function", () => {
    for (const entry of Object.values(rules)) expect(entry).toBeTypeOf("function");
  });
});

describe("the purity harness", () => {
  it("really refuses every mutation of a frozen state", () => {
    const state = deepFreeze(midGameState());

    expect(() =>
      state.board.items.push({ id: "x", chain: "wood", level: 1, cell: "c0_1" })
    ).toThrow();
    expect(() => {
      state.energy.value = 99;
    }).toThrow();
    expect(() => {
      state.wallet.coins = 0;
    }).toThrow();
  });
});

describe("one loop of the template game through the object", () => {
  it("taps, merges, delivers and catches up", () => {
    const start = deepFreeze(midGameState());

    const tapped = rules.tapGenerator(start, "sawmill", countedAt, tables, scriptedRng([0]));
    if (!tapped.ok) throw new Error(`tap should succeed, got ${tapped.reason}`);
    expect(rules.itemAt(tapped.state.board, "c2_2")?.id).toBe("i6");

    expect(rules.isLegalMerge(tapped.state, "c0_0", "c2_2", tables)).toBe(true);
    const merged = rules.merge(tapped.state, "c0_0", "c2_2", tables);
    if (!merged.legal) throw new Error(`merge should be legal, got ${merged.reason}`);
    expect(merged.item).toEqual({ id: "i6", chain: "wood", level: 2, cell: "c2_2" });

    expect(rules.isLegalOrderMatch(merged.state, "i6", 7)).toBe(true);
    const first = rules.giveToOrder(
      merged.state,
      { item: "i6", order: 7 },
      tables,
      scriptedRng([0])
    );
    if (!first.ok) throw new Error(`give should succeed, got ${first.reason}`);
    expect(first.completed).toBe(false);

    const second = rules.giveToOrder(
      first.state,
      { item: "i4", order: 7 },
      tables,
      scriptedRng([0])
    );
    if (!second.ok) throw new Error(`give should succeed, got ${second.reason}`);
    expect(second.completed).toBe(true);
    expect(second.state.wallet.coins).toBe(125);

    const due = rules.nextDue(second.state, tables);
    expect(due).toBe(countedAt + tables.energy.regenMs);

    const caughtUp = rules.elapse(second.state, due ?? 0, tables);
    expect(caughtUp.energy.value).toBe(4);
    expect(start.board.items).toHaveLength(5);
  });

  it("stores an item and sells one out of the same state", () => {
    const stored = rules.place(deepFreeze(midGameState()), "i1");
    if (!stored.ok) throw new Error("place should succeed");

    const sold = rules.sell(stored.state, "i2", tables);
    if (!sold.ok) throw new Error("sell should succeed");
    expect(sold.coins).toBe(1);

    const back = rules.take(sold.state, stored.slot);
    if (!back.ok) throw new Error("take should succeed");
    expect(back.item.cell).toBe("c0_0");
    expect(rules.neighbors(back.state.board, "c0_0")).toContain("c1_0");
    expect(rules.findFreeCell(back.state.board)).toBe("c1_0");
  });
});
