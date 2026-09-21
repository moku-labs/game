import type { Log } from "@moku-labs/common/browser";
import { describe, expect, it, vi } from "vitest";
import { createRngApi, createRngView } from "../../rng/api";
import { hash32 } from "../../rng/prng";
import type { RngState } from "../../rng/types";
import { createModelState } from "../../state";
import { memory } from "../../store/providers/memory";
import type { Config, ModelCtx } from "../../types";

const createMockLog = (): Log.LogApi => ({
  addSink: vi.fn(),
  clearSinks: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  expect: vi.fn(),
  info: vi.fn(),
  reset: vi.fn(),
  trace: vi.fn(() => []),
  warn: vi.fn()
});

const branchOf = (seed: number): RngState => ({ seed, streams: {} });

const createMockCtx = (streams: Record<string, number>): ModelCtx => {
  const config: Config = {
    playerProvider: memory(),
    initialPlayer: {},
    initialSession: {},
    seed: 7,
    schemaVersion: 1,
    migrations: []
  };
  const state = createModelState({ global: {}, config });
  state.store.doc = { player: {}, rng: { seed: 7, streams } };

  return { config, emit: vi.fn(), global: {}, log: createMockLog(), state };
};

describe("createRngView", () => {
  it("seeds a stream from the seed and the id on first use", () => {
    const branch = branchOf(42);

    createRngView(branch).stream("chest:42").int(6);

    expect(branch.streams["chest:42"]).toBeDefined();
  });

  it("repeats the same draws for the same seed and id", () => {
    const first = createRngView(branchOf(42)).stream("chest:42");
    const second = createRngView(branchOf(42)).stream("chest:42");

    const left = [first.int(100), first.int(100), first.int(100)];
    const right = [second.int(100), second.int(100), second.int(100)];

    expect(left).toEqual(right);
  });

  it("keeps two streams of one branch independent", () => {
    const branch = branchOf(42);
    const view = createRngView(branch);

    view.stream("chest:1").int(1000);
    const untouched = { ...branch.streams };
    view.stream("chest:2").int(1000);

    expect(branch.streams["chest:1"]).toBe(untouched["chest:1"]);
    expect(branch.streams["chest:2"]).not.toBe(untouched["chest:1"]);
  });

  it("advances the stream state of the branch on every draw", () => {
    const branch = branchOf(42);
    const stream = createRngView(branch).stream("chest:42");

    stream.int(6);
    const afterFirst = branch.streams["chest:42"];
    stream.int(6);

    expect(branch.streams["chest:42"]).not.toBe(afterFirst);
  });

  it("continues a stream that already has a state", () => {
    const resumed = branchOf(42);
    resumed.streams["chest:42"] = hash32(42, "chest:42");
    const fresh = branchOf(42);

    expect(createRngView(resumed).stream("chest:42").int(1000)).toBe(
      createRngView(fresh).stream("chest:42").int(1000)
    );
  });

  it("leaves a branch untouched when the draw happens on a copy", () => {
    const committed = branchOf(42);
    const copy: RngState = { seed: committed.seed, streams: { ...committed.streams } };

    createRngView(copy).stream("chest:42").int(6);

    expect(committed.streams["chest:42"]).toBeUndefined();
  });
});

describe("RngStream.int", () => {
  it("stays inside the bound", () => {
    const stream = createRngView(branchOf(42)).stream("bounds");

    for (let draw = 0; draw < 200; draw++) {
      const value = stream.int(6);

      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
    }
  });

  it("returns zero for a bound of one", () => {
    expect(createRngView(branchOf(42)).stream("one").int(1)).toBe(0);
  });

  it("throws on a bound of zero", () => {
    const stream = createRngView(branchOf(42)).stream("zero");

    expect(() => stream.int(0)).toThrow(/^\[game] /);
    expect(() => stream.int(0)).toThrow(/\n {2}.*\.$/);
  });

  it("throws on a negative bound", () => {
    const stream = createRngView(branchOf(42)).stream("negative");

    expect(() => stream.int(-3)).toThrow(/^\[game] /);
  });
});

describe("RngStream.range", () => {
  it("includes both ends", () => {
    const stream = createRngView(branchOf(42)).stream("range");
    const seen = new Set<number>();

    for (let draw = 0; draw < 300; draw++) seen.add(stream.range(1, 3));

    expect([...seen].toSorted()).toEqual([1, 2, 3]);
  });

  it("returns the single value of an empty span", () => {
    expect(createRngView(branchOf(42)).stream("span").range(5, 5)).toBe(5);
  });

  it("throws when the maximum is below the minimum", () => {
    const stream = createRngView(branchOf(42)).stream("bad");

    expect(() => stream.range(5, 4)).toThrow(/^\[game] /);
  });
});

describe("RngStream.pick", () => {
  it("returns an item of the array", () => {
    const items = ["a", "b", "c"];
    const stream = createRngView(branchOf(42)).stream("pick");

    for (let draw = 0; draw < 50; draw++) expect(items).toContain(stream.pick(items));
  });

  it("throws on an empty array", () => {
    const stream = createRngView(branchOf(42)).stream("empty");

    expect(() => stream.pick([])).toThrow(/^\[game] /);
    expect(() => stream.pick([])).toThrow(/\n {2}.*\.$/);
  });

  it("throws on an array with holes", () => {
    const stream = createRngView(branchOf(42)).stream("holes");

    expect(() => stream.pick([undefined, undefined])).toThrow(/^\[game] /);
  });
});

describe("RngStream.weighted", () => {
  it("never returns an entry of weight zero", () => {
    const table = [
      { id: "never", weight: 0 },
      { id: "always", weight: 5 }
    ];
    const stream = createRngView(branchOf(42)).stream("weights");

    for (let draw = 0; draw < 200; draw++) expect(stream.weighted(table).id).toBe("always");
  });

  it("returns every entry with a positive weight", () => {
    const table = [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 }
    ];
    const stream = createRngView(branchOf(42)).stream("spread");
    const seen = new Set<string>();

    for (let draw = 0; draw < 200; draw++) seen.add(stream.weighted(table).id);

    expect([...seen].toSorted()).toEqual(["a", "b"]);
  });

  it("throws on an empty table", () => {
    const stream = createRngView(branchOf(42)).stream("no-table");

    expect(() => stream.weighted([])).toThrow(/^\[game] /);
  });

  it("throws when every weight is zero", () => {
    const stream = createRngView(branchOf(42)).stream("zero-table");

    expect(() => stream.weighted([{ weight: 0 }])).toThrow(/^\[game] /);
  });
});

describe("RngStream.chance", () => {
  it("is never true for a numerator of zero", () => {
    const stream = createRngView(branchOf(42)).stream("never");

    for (let draw = 0; draw < 100; draw++) expect(stream.chance(0, 10)).toBe(false);
  });

  it("is always true when numerator and denominator match", () => {
    const stream = createRngView(branchOf(42)).stream("always");

    for (let draw = 0; draw < 100; draw++) expect(stream.chance(10, 10)).toBe(true);
  });

  it("throws on a denominator of zero", () => {
    const stream = createRngView(branchOf(42)).stream("bad-chance");

    expect(() => stream.chance(1, 0)).toThrow(/^\[game] /);
  });
});

describe("createRngApi", () => {
  it("peeks the committed state of a stream", () => {
    const api = createRngApi(createMockCtx({ "chest:42": 12_345 }));

    expect(api.peek("chest:42")).toBe(12_345);
  });

  it("returns undefined for a stream that was never drawn", () => {
    const api = createRngApi(createMockCtx({}));

    expect(api.peek("chest:42")).toBeUndefined();
  });
});
