import { describe, expect, it } from "vitest";
import { applyEnergyRegen, elapse, nextDue } from "../../elapse";
import type { MergeState, Tables } from "../../types";
import { countedAt, deepFreeze, midGameState, tables } from "./fixtures";

const regenMs = tables.energy.regenMs;

const stateWith = (patch: Partial<MergeState>): MergeState =>
  deepFreeze({ ...midGameState(), ...patch });

const cooling = (readyAt: number): MergeState["generators"] => ({
  sawmill: { readyAt, charges: 0 }
});

describe("applyEnergyRegen", () => {
  it("grants one point per period", () => {
    const energy = applyEnergyRegen(
      deepFreeze({ value: 5, max: 10, countedAt }),
      countedAt + 3 * regenMs,
      tables.energy
    );

    expect(energy).toEqual({ value: 8, max: 10, countedAt: countedAt + 3 * regenMs });
  });

  it("keeps the remainder so no time is lost", () => {
    const energy = applyEnergyRegen(
      deepFreeze({ value: 5, max: 10, countedAt }),
      countedAt + 3 * regenMs + 50_000,
      tables.energy
    );

    expect(energy.countedAt).toBe(countedAt + 3 * regenMs);
  });

  it("caps at max and jumps the moment to now", () => {
    const now = countedAt + 20 * regenMs;
    const energy = applyEnergyRegen(
      deepFreeze({ value: 5, max: 10, countedAt }),
      now,
      tables.energy
    );

    expect(energy).toEqual({ value: 10, max: 10, countedAt: now });
  });

  it("jumps the moment to now while the bar is already full", () => {
    const now = countedAt + 500;
    const energy = applyEnergyRegen(
      deepFreeze({ value: 10, max: 10, countedAt }),
      now,
      tables.energy
    );

    expect(energy).toEqual({ value: 10, max: 10, countedAt: now });
  });

  it("keeps a value above the cap instead of trimming it", () => {
    const energy = applyEnergyRegen(
      deepFreeze({ value: 14, max: 10, countedAt }),
      countedAt + regenMs,
      tables.energy
    );

    expect(energy.value).toBe(14);
  });

  it("changes nothing before the first point is earned", () => {
    const energy = applyEnergyRegen(
      deepFreeze({ value: 5, max: 10, countedAt }),
      countedAt + regenMs - 1,
      tables.energy
    );

    expect(energy).toEqual({ value: 5, max: 10, countedAt });
  });

  it("changes nothing when the device clock moved back", () => {
    const energy = applyEnergyRegen(
      deepFreeze({ value: 5, max: 10, countedAt }),
      countedAt - 10 * regenMs,
      tables.energy
    );

    expect(energy).toEqual({ value: 5, max: 10, countedAt });
  });

  it("grants nothing when the rule has no positive period", () => {
    const rule = { regenMs: 0, max: 10 };
    const energy = applyEnergyRegen(deepFreeze({ value: 5, max: 10, countedAt }), 9_000_000, rule);

    expect(energy).toEqual({ value: 5, max: 10, countedAt: 9_000_000 });
  });
});

describe("elapse", () => {
  it("catches energy up and leaves the frozen input untouched", () => {
    const state = stateWith({});
    const next = elapse(state, countedAt + 2 * regenMs, tables);

    expect(next.energy.value).toBe(7);
    expect(state.energy.value).toBe(5);
  });

  it("refills a generator whose cooldown has ended", () => {
    const state = stateWith({ generators: cooling(countedAt + 60_000) });
    const next = elapse(state, countedAt + 60_000, tables);

    expect(next.generators.sawmill).toEqual({ readyAt: countedAt + 60_000, charges: 3 });
  });

  it("leaves a generator that is still cooling", () => {
    const state = stateWith({ generators: cooling(countedAt + 60_000) });

    expect(elapse(state, countedAt + 59_999, tables).generators.sawmill?.charges).toBe(0);
  });

  it("leaves a generator that still has charges", () => {
    const state = stateWith({ generators: { sawmill: { readyAt: 0, charges: 2 } } });

    expect(elapse(state, 9_000_000, tables).generators.sawmill?.charges).toBe(2);
  });

  it("leaves a saved generator the table does not know", () => {
    const state = stateWith({ generators: { ghost: { readyAt: 0, charges: 0 } } });

    expect(elapse(state, 9_000_000, tables).generators.ghost).toEqual({ readyAt: 0, charges: 0 });
  });

  it("changes nothing when the device clock moved back", () => {
    const state = stateWith({ generators: cooling(countedAt + 60_000) });

    expect(elapse(state, countedAt - 5_000_000, tables)).toEqual(state);
  });

  it("over eight hours equals the same span applied in a hundred steps", () => {
    const span = 8 * 60 * 60 * 1000;
    const start: MergeState = deepFreeze({
      ...midGameState(),
      energy: { value: 0, max: 1000, countedAt: 0 },
      generators: { sawmill: { readyAt: 5_000_000, charges: 0 } }
    });

    const once = elapse(start, span, tables);

    let stepped = start;
    for (let step = 1; step <= 100; step++) stepped = elapse(stepped, (span / 100) * step, tables);

    expect(stepped).toEqual(once);
    expect(once.energy.value).toBe(240);
  });
});

describe("nextDue", () => {
  it("never reports a due moment for a generator the table does not know", () => {
    // `elapse` leaves such a generator alone, so a due moment for it would wake the clock in a loop.
    const state = stateWith({
      energy: { value: 10, max: 10, countedAt },
      generators: { ghost: { readyAt: 0, charges: 0 } }
    });

    expect(nextDue(state, tables)).toBeUndefined();
  });

  it("returns the next energy point while the bar has room", () => {
    expect(nextDue(stateWith({}), tables)).toBe(countedAt + regenMs);
  });

  it("skips energy once the bar is full", () => {
    const state = stateWith({ energy: { value: 10, max: 10, countedAt } });

    expect(nextDue(state, tables)).toBeUndefined();
  });

  it("skips energy when the rule has no positive period", () => {
    const stopped: Tables = { ...tables, energy: { regenMs: 0, max: 10 } };

    expect(nextDue(stateWith({}), stopped)).toBeUndefined();
  });

  it("returns the moment a spent generator wakes up", () => {
    const state = stateWith({
      energy: { value: 10, max: 10, countedAt },
      generators: cooling(countedAt + 60_000)
    });

    expect(nextDue(state, tables)).toBe(countedAt + 60_000);
  });

  it("ignores a generator that still has charges", () => {
    const state = stateWith({
      energy: { value: 10, max: 10, countedAt },
      generators: { sawmill: { readyAt: countedAt + 60_000, charges: 1 } }
    });

    expect(nextDue(state, tables)).toBeUndefined();
  });

  it("returns the nearest of the pending moments", () => {
    const state = stateWith({ generators: cooling(countedAt + 60_000) });

    expect(nextDue(state, tables)).toBe(countedAt + 60_000);
  });
});

// Every timer kind `elapse` handles has to be visible to `nextDue`, otherwise a sleeping
// game never wakes up for it. This table is the enumeration of those kinds.
const timers = {
  energy: {
    state: deepFreeze({ ...midGameState(), energy: { value: 5, max: 10, countedAt } }),
    due: countedAt + regenMs,
    branch: (state: MergeState): unknown => state.energy
  },
  "generator-recharge": {
    state: deepFreeze({
      ...midGameState(),
      energy: { value: 10, max: 10, countedAt },
      generators: { sawmill: { readyAt: countedAt + 60_000, charges: 0 } }
    }),
    due: countedAt + 60_000,
    branch: (state: MergeState): unknown => state.generators
  }
};

describe("nextDue covers every timer kind of elapse", () => {
  for (const [kind, timer] of Object.entries(timers)) {
    it(`reports the ${kind} timer`, () => {
      expect(nextDue(timer.state, tables)).toBe(timer.due);
      expect(branchAfter(timer, timer.due - 1)).toEqual(timer.branch(timer.state));
      expect(branchAfter(timer, timer.due)).not.toEqual(timer.branch(timer.state));
    });
  }
});

function branchAfter(timer: (typeof timers)[keyof typeof timers], now: number): unknown {
  return timer.branch(elapse(timer.state, now, tables));
}
