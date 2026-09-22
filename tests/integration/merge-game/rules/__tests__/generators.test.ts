import { describe, expect, it } from "vitest";
import { drawWeighted, pickDrop, tapGenerator } from "../generators";
import type { GeneratorTable, MergeState, Tables } from "../types";
import {
  countedAt,
  deepFreeze,
  fullBoardState,
  midGameState,
  scriptedRng,
  seededRng,
  tables
} from "./fixtures";

type Drops = GeneratorTable[string]["drops"];

const dropsOf = (...weights: number[]): Drops =>
  deepFreeze(weights.map((weight, index) => ({ chain: "wood", level: index + 1, weight })));

const stateWith = (patch: Partial<MergeState>): MergeState =>
  deepFreeze({ ...midGameState(), ...patch });

const tablesWith = (generator: GeneratorTable[string]): Tables =>
  deepFreeze({ ...tables, generators: { sawmill: generator } });

describe("pickDrop", () => {
  it("returns the only drop of a one-entry table", () => {
    expect(pickDrop(dropsOf(1), scriptedRng([0]))).toEqual({ chain: "wood", level: 1 });
  });

  it("draws against the total weight", () => {
    const seen: number[] = [];
    const rng = {
      int(maxExclusive: number) {
        seen.push(maxExclusive);
        return 0;
      }
    };

    pickDrop(dropsOf(3, 1), rng);
    expect(seen).toEqual([4]);
  });

  it("walks the table so a heavier entry covers more draws", () => {
    const drops = dropsOf(3, 1);
    const levels = [0, 1, 2, 3].map(roll => pickDrop(drops, scriptedRng([roll])).level);

    expect(levels).toEqual([1, 1, 1, 2]);
  });

  it("never picks an entry of weight zero", () => {
    const drops = dropsOf(0, 2);
    const levels = [0, 1].map(roll => pickDrop(drops, scriptedRng([roll])).level);

    expect(levels).toEqual([2, 2]);
  });

  it("throws a two-sentence [merge] error for an empty table", () => {
    expect(() => pickDrop(dropsOf(), scriptedRng([0]))).toThrow(
      "[merge] The drop table has no entry with a positive weight.\n  Give at least one entry of the drop table a weight above zero."
    );
  });

  it("throws for a table whose weights add up to zero", () => {
    expect(() => pickDrop(dropsOf(0, 0), scriptedRng([0]))).toThrow(/^\[merge] /);
  });

  it("throws when the draw falls outside the table", () => {
    expect(() => pickDrop(dropsOf(1, 1), scriptedRng([9]))).toThrow(
      "[merge] The draw 9 fell outside the drop table of total weight 2.\n  Make rng.int(maxExclusive) return a value below maxExclusive."
    );
  });

  it("repeats the same draws for the same seed", () => {
    const drops = dropsOf(5, 3, 1);
    const draw = (seed: number) => {
      const rng = seededRng(seed);
      return Array.from({ length: 20 }, () => pickDrop(drops, rng).level);
    };

    expect(draw(7)).toEqual(draw(7));
    expect(draw(7)).not.toEqual(draw(8));
  });
});

describe("drawWeighted", () => {
  it("returns the entry the roll lands on", () => {
    const entries = deepFreeze([
      { name: "a", weight: 1 },
      { name: "b", weight: 1 }
    ]);

    expect(drawWeighted(entries, entry => entry.weight, scriptedRng([1]), "order table").name).toBe(
      "b"
    );
  });

  it("names the table it could not draw from", () => {
    expect(() => drawWeighted([], () => 1, scriptedRng([0]), "order table")).toThrow(/order table/);
  });
});

describe("tapGenerator", () => {
  it("spends energy and a charge and places the drop next to the generator", () => {
    const state = stateWith({});
    const result = tapGenerator(state, "sawmill", countedAt, tables, scriptedRng([0]));

    if (!result.ok) throw new Error(`tap should succeed, got ${result.reason}`);
    // The generator stands on c2_2; the drop lands on the nearest free ring cell, never on it.
    expect(result.item).toEqual({ id: "i6", chain: "wood", level: 1, cell: "c1_1" });
    expect(result.state.energy.value).toBe(3);
    expect(result.state.generators.sawmill).toEqual({ readyAt: 0, charges: 2 });
    expect(result.state.nextItemId).toBe(7);
    expect(result.state.board.items).toHaveLength(6);
  });

  it("never drops onto the generator's own cell, so the next tap still reaches it", () => {
    const state = stateWith({ board: { ...midGameState().board, items: [] } });
    const result = tapGenerator(state, "sawmill", countedAt, tables, scriptedRng([0]));

    if (!result.ok) throw new Error(`tap should succeed, got ${result.reason}`);
    expect(result.item.cell).not.toBe(tables.generators.sawmill?.cell);
  });

  it("leaves the frozen input state untouched", () => {
    const state = stateWith({});

    tapGenerator(state, "sawmill", countedAt, tables, scriptedRng([0]));
    expect(state.board.items).toHaveLength(5);
    expect(state.energy.value).toBe(5);
    expect(state.nextItemId).toBe(6);
  });

  it("starts the cooldown when the last charge is spent", () => {
    const state = stateWith({ generators: { sawmill: { readyAt: 0, charges: 1 } } });
    const result = tapGenerator(state, "sawmill", countedAt, tables, scriptedRng([0]));

    if (!result.ok) throw new Error("tap should succeed");
    expect(result.state.generators.sawmill).toEqual({ readyAt: countedAt + 60_000, charges: 0 });
  });

  it("reports cooling while a spent generator is still on cooldown", () => {
    const state = stateWith({ generators: { sawmill: { readyAt: countedAt + 1000, charges: 0 } } });

    expect(tapGenerator(state, "sawmill", countedAt, tables, scriptedRng([0]))).toEqual({
      ok: false,
      reason: "cooling"
    });
  });

  it("refills the charges once the cooldown has ended", () => {
    const state = stateWith({ generators: { sawmill: { readyAt: countedAt, charges: 0 } } });
    const result = tapGenerator(state, "sawmill", countedAt, tables, scriptedRng([0]));

    if (!result.ok) throw new Error("tap should succeed");
    expect(result.state.generators.sawmill?.charges).toBe(2);
  });

  it("reports noEnergy when the bar is below the cost", () => {
    const state = stateWith({ energy: { value: 1, max: 10, countedAt } });

    expect(tapGenerator(state, "sawmill", countedAt, tables, scriptedRng([0]))).toEqual({
      ok: false,
      reason: "noEnergy"
    });
  });

  it("collects the energy earned while away before spending", () => {
    const state = stateWith({ energy: { value: 1, max: 10, countedAt } });
    const now = countedAt + tables.energy.regenMs;
    const result = tapGenerator(state, "sawmill", now, tables, scriptedRng([0]));

    if (!result.ok) throw new Error(`tap should succeed, got ${result.reason}`);
    expect(result.state.energy).toEqual({ value: 0, max: 10, countedAt: now });
  });

  it("reports boardFull when no cell is left", () => {
    const state = deepFreeze(fullBoardState());

    expect(tapGenerator(state, "sawmill", countedAt, tables, scriptedRng([0]))).toEqual({
      ok: false,
      reason: "boardFull"
    });
  });

  it("checks cooling before energy", () => {
    const state = stateWith({
      energy: { value: 0, max: 10, countedAt },
      generators: { sawmill: { readyAt: countedAt + 1000, charges: 0 } }
    });

    expect(tapGenerator(state, "sawmill", countedAt, tables, scriptedRng([0]))).toMatchObject({
      reason: "cooling"
    });
  });

  it("checks energy before board room", () => {
    const state = deepFreeze({
      ...fullBoardState(),
      energy: { value: 0, max: 10, countedAt }
    });

    expect(tapGenerator(state, "sawmill", countedAt, tables, scriptedRng([0]))).toMatchObject({
      reason: "noEnergy"
    });
  });

  it("drops the item on the nearest free ring when the generator cell is taken", () => {
    const state = stateWith({
      board: {
        cols: 5,
        rows: 5,
        items: [{ id: "g", chain: "wood", level: 1, cell: "c2_2" }]
      }
    });
    const result = tapGenerator(state, "sawmill", countedAt, tables, scriptedRng([0]));

    if (!result.ok) throw new Error("tap should succeed");
    expect(result.item.cell).toBe("c1_1");
  });

  it("keeps a generator with charges left at its stored wake-up moment", () => {
    const state = stateWith({ generators: { sawmill: { readyAt: 42, charges: 3 } } });
    const result = tapGenerator(state, "sawmill", countedAt, tables, scriptedRng([0]));

    if (!result.ok) throw new Error("tap should succeed");
    expect(result.state.generators.sawmill?.readyAt).toBe(42);
  });

  it("throws for a generator the table does not know", () => {
    expect(() => tapGenerator(stateWith({}), "ghost", countedAt, tables, scriptedRng([0]))).toThrow(
      '[merge] The generator "ghost" is not in the generator table.\n  Add it to tables.generators or fix the generator id.'
    );
  });

  it("throws for a generator whose table entry has no positive maxCharges", () => {
    // Otherwise charges would go to -1 and the generator would hand out items for energy only, forever.
    const broken: Tables = {
      ...tables,
      generators: {
        sawmill: {
          ...tables.generators.sawmill,
          cell: "c2_2",
          energyCost: 2,
          cooldownMs: 60_000,
          drops: [{ chain: "wood", level: 1, weight: 1 }],
          maxCharges: 0
        }
      }
    };
    const state = stateWith({ generators: { sawmill: { readyAt: 0, charges: 0 } } });

    expect(() => tapGenerator(state, "sawmill", countedAt, broken, scriptedRng([0]))).toThrow(
      '[merge] The generator "sawmill" has no positive maxCharges.\n  Set maxCharges to 1 or more in tables.generators.'
    );
  });

  it("throws for a generator the save does not hold", () => {
    const state = stateWith({ generators: {} });

    expect(() => tapGenerator(state, "sawmill", countedAt, tables, scriptedRng([0]))).toThrow(
      '[merge] The generator "sawmill" has no entry in the saved generators.\n  Add it to state.generators before tapping it.'
    );
  });

  it("reads the cost and the drops from the table", () => {
    const custom = tablesWith({
      cell: "c0_1",
      energyCost: 5,
      cooldownMs: 1000,
      maxCharges: 3,
      drops: [{ chain: "stone", level: 2, weight: 1 }]
    });
    const result = tapGenerator(stateWith({}), "sawmill", countedAt, custom, scriptedRng([0]));

    if (!result.ok) throw new Error("tap should succeed");
    expect(result.state.energy.value).toBe(0);
    expect(result.item).toEqual({ id: "i6", chain: "stone", level: 2, cell: "c1_1" });
  });
});
