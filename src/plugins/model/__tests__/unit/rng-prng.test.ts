import { describe, expect, it } from "vitest";
import { hash32, nextUint32 } from "../../rng/prng";

// ─── Golden vectors ──────────────────────────────────────────
// The generator and the hash are part of the save format: changing either needs a migration.
// The numbers below were computed once with this implementation and are hard-coded on purpose.
// A diff in this file means every existing save re-rolls its chests.
const goldenHashes = {
  "chest:42": 2_485_943_101,
  merge: 2_423_777_976,
  "": 2_354_441_243
};

const goldenStream = [2_042_392_555, 642_807_968, 2_151_748_187, 520_576_102, 343_529_693];

describe("hash32", () => {
  it("pins the golden vectors of the save format", () => {
    expect(hash32(42, "chest:42")).toBe(goldenHashes["chest:42"]);
    expect(hash32(42, "merge")).toBe(goldenHashes.merge);
    expect(hash32(42, "")).toBe(goldenHashes[""]);
  });

  it("returns the same state for the same seed and id", () => {
    expect(hash32(7, "chest:1")).toBe(hash32(7, "chest:1"));
  });

  it("separates two ids of one seed", () => {
    expect(hash32(7, "chest:1")).not.toBe(hash32(7, "chest:2"));
  });

  it("separates two seeds of one id", () => {
    expect(hash32(7, "chest:1")).not.toBe(hash32(8, "chest:1"));
  });

  it("stays inside the uint32 range", () => {
    const states = [hash32(0, "a"), hash32(4_294_967_295, "b"), hash32(-1, "c")];

    for (const state of states) {
      expect(Number.isInteger(state)).toBe(true);
      expect(state).toBeGreaterThanOrEqual(0);
      expect(state).toBeLessThan(2 ** 32);
    }
  });
});

describe("nextUint32", () => {
  it("pins the first five outputs of a stream", () => {
    const start = hash32(42, "chest:42");
    const drawn: number[] = [];

    let state = start;
    for (let index = 0; index < goldenStream.length; index++) {
      const step = nextUint32(state);
      drawn.push(step.value);
      state = step.state;
    }

    expect(drawn).toEqual(goldenStream);
  });

  it("is a pure function of the state", () => {
    expect(nextUint32(12_345)).toEqual(nextUint32(12_345));
  });

  it("advances the state", () => {
    const step = nextUint32(12_345);

    expect(step.state).not.toBe(12_345);
  });

  it("keeps value and state inside the uint32 range", () => {
    let state = hash32(1, "range");

    for (let index = 0; index < 500; index++) {
      const step = nextUint32(state);

      expect(step.value).toBeGreaterThanOrEqual(0);
      expect(step.value).toBeLessThan(2 ** 32);
      expect(Number.isInteger(step.value)).toBe(true);
      expect(step.state).toBeGreaterThanOrEqual(0);
      expect(step.state).toBeLessThan(2 ** 32);
      state = step.state;
    }
  });
});
