import { describe, expect, it } from "vitest";
import { place, take } from "../../inventory";
import type { Item, MergeState } from "../../types";
import { deepFreeze, emptySlots, filledItems, midGameState } from "./fixtures";

const stateWith = (patch: Partial<MergeState>): MergeState =>
  deepFreeze({ ...midGameState(), ...patch });

const frozenState = (): MergeState => deepFreeze(midGameState());

const stored = (id: string): Item => ({ id, chain: "wood", level: 1, cell: "" });

describe("place", () => {
  it("moves the item into the first free slot and clears its cell", () => {
    const result = place(frozenState(), "i1");

    if (!result.ok) throw new Error("place should succeed");
    expect(result.slot).toBe(0);
    expect(result.state.inventory[0]).toEqual({ id: "i1", chain: "wood", level: 1, cell: "" });
  });

  it("takes the item off the board", () => {
    const result = place(frozenState(), "i1");

    if (!result.ok) throw new Error("place should succeed");
    expect(result.state.board.items.map(item => item.id)).toEqual(["i2", "i3", "i4", "i5"]);
  });

  it("skips slots that are already taken", () => {
    const state = stateWith({ inventory: [stored("x"), ...emptySlots(2)] });
    const result = place(state, "i1");

    expect(result).toMatchObject({ ok: true, slot: 1 });
  });

  it("reports full when every slot is taken", () => {
    const state = stateWith({ inventory: [stored("x"), stored("y"), stored("z")] });

    expect(place(state, "i1")).toEqual({ ok: false, reason: "full" });
  });

  it("leaves the frozen input state untouched", () => {
    const state = frozenState();

    place(state, "i1");
    expect(state.board.items).toHaveLength(5);
    expect(state.inventory[0]).toBeNull();
  });

  it("reports missing for an item that is not on the board", () => {
    // A double tap places the same item twice: an expected failure, like `sell`, never a throw.
    expect(place(frozenState(), "i99")).toEqual({ ok: false, reason: "missing" });
  });
});

describe("take", () => {
  it("moves the item back to a free cell and empties the slot", () => {
    const state = stateWith({ inventory: [stored("x"), ...emptySlots(2)] });
    const result = take(state, 0);

    if (!result.ok) throw new Error("take should succeed");
    expect(result.item).toEqual({ id: "x", chain: "wood", level: 1, cell: "c0_1" });
    expect(result.state.inventory[0]).toBeNull();
    expect(result.state.board.items.at(-1)?.id).toBe("x");
  });

  it("reports empty for a slot that holds nothing", () => {
    expect(take(frozenState(), 1)).toEqual({ ok: false, reason: "empty" });
  });

  it("reports empty for a slot outside the inventory", () => {
    expect(take(frozenState(), 99)).toEqual({ ok: false, reason: "empty" });
    expect(take(frozenState(), -1)).toEqual({ ok: false, reason: "empty" });
  });

  it("reports boardFull when no cell is left", () => {
    const state = stateWith({
      board: { cols: 5, rows: 5, items: filledItems(5, 5) },
      inventory: [stored("x"), ...emptySlots(2)]
    });

    expect(take(state, 0)).toEqual({ ok: false, reason: "boardFull" });
  });

  it("leaves the frozen input state untouched", () => {
    const state = stateWith({ inventory: [stored("x"), ...emptySlots(2)] });

    take(state, 0);
    expect(state.inventory[0]).toEqual({ id: "x", chain: "wood", level: 1, cell: "" });
    expect(state.board.items).toHaveLength(5);
  });

  it("gives back exactly what place stored", () => {
    const placed = place(frozenState(), "i3");

    if (!placed.ok) throw new Error("place should succeed");
    const taken = take(placed.state, placed.slot);

    if (!taken.ok) throw new Error("take should succeed");
    expect(taken.item).toMatchObject({ id: "i3", chain: "wood", level: 2 });
    expect(taken.state.inventory).toEqual(emptySlots(3));
  });
});
