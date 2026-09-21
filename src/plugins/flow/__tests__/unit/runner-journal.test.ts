import { describe, expect, it } from "vitest";
import { compact, entryHash, hashText, pushEntry } from "../../runner/journal";
import { createRunnerState } from "../../runner/state";
import type { JournalEntry, RunnerState } from "../../runner/types";

const edge = (overrides: Partial<Omit<JournalEntry, "index" | "hash">> = {}) => ({
  path: overrides.path ?? "board/merge",
  outcome: overrides.outcome ?? "done",
  payload: overrides.payload ?? {},
  next: overrides.next ?? "awaitIntent",
  now: overrides.now ?? 1000
});

const fill = (state: RunnerState, count: number, limit: number) => {
  for (let index = 0; index < count; index++) {
    pushEntry(state, edge({ next: `n${index}` }), limit);
  }
};

describe("hashText", () => {
  it("returns the same hash for the same text", () => {
    expect(hashText("board/merge")).toBe(hashText("board/merge"));
  });

  it("returns a different hash for different text", () => {
    expect(hashText("board/merge")).not.toBe(hashText("board/sell"));
  });

  it("returns a short hexadecimal string", () => {
    expect(hashText("board/merge")).toMatch(/^[\da-f]+$/);
  });

  it("hashes the empty string without failing", () => {
    expect(hashText("")).toMatch(/^[\da-f]+$/);
  });
});

describe("entryHash", () => {
  it("is deterministic", () => {
    expect(entryHash("board/merge", "done", "awaitIntent")).toBe(
      entryHash("board/merge", "done", "awaitIntent")
    );
  });

  it("changes when the node changes", () => {
    expect(entryHash("board/merge", "done", "awaitIntent")).not.toBe(
      entryHash("board/sell", "done", "awaitIntent")
    );
  });

  it("changes when the outcome changes", () => {
    expect(entryHash("board/merge", "done", "awaitIntent")).not.toBe(
      entryHash("board/merge", "rejected", "awaitIntent")
    );
  });

  it("changes when the next node changes", () => {
    expect(entryHash("board/merge", "done", "awaitIntent")).not.toBe(
      entryHash("board/merge", "done", "catchUp")
    );
  });

  it("does not confuse a moved separator", () => {
    expect(entryHash("a", "b", "c")).not.toBe(entryHash("a|b", "", "c"));
  });
});

describe("pushEntry", () => {
  it("appends the entry to the journal", () => {
    const state = createRunnerState();
    const entry = pushEntry(state, edge(), 500);

    expect(state.journal).toEqual([entry]);
  });

  it("numbers the entries from zero", () => {
    const state = createRunnerState();

    fill(state, 3, 500);

    expect(state.journal.map(entry => entry.index)).toEqual([0, 1, 2]);
  });

  it("keeps the running index on the state", () => {
    const state = createRunnerState();

    fill(state, 3, 500);

    expect(state.journalIndex).toBe(3);
  });

  it("carries the hash of node, outcome and next", () => {
    const state = createRunnerState();
    const entry = pushEntry(state, edge(), 500);

    expect(entry.hash).toBe(entryHash("board/merge", "done", "awaitIntent"));
  });

  it("keeps the edge data", () => {
    const state = createRunnerState();
    const entry = pushEntry(state, edge({ payload: { from: "a" }, now: 42 }), 500);

    expect(entry.payload).toEqual({ from: "a" });
    expect(entry.now).toBe(42);
  });

  it("drops the oldest entries above the limit", () => {
    const state = createRunnerState();

    fill(state, 5, 3);

    expect(state.journal.map(entry => entry.index)).toEqual([2, 3, 4]);
  });

  it("keeps counting the index while it drops entries", () => {
    const state = createRunnerState();

    fill(state, 5, 3);

    expect(state.journalIndex).toBe(5);
  });

  it("keeps nothing when the limit is zero", () => {
    const state = createRunnerState();

    fill(state, 2, 0);

    expect(state.journal).toEqual([]);
  });
});

describe("compact", () => {
  it("clears the journal at a checkpoint", () => {
    const state = createRunnerState();

    fill(state, 3, 500);
    compact(state);

    expect(state.journal).toEqual([]);
  });

  it("keeps the running index, so a later entry is not renumbered", () => {
    const state = createRunnerState();

    fill(state, 3, 500);
    compact(state);
    const entry = pushEntry(state, edge(), 500);

    expect(entry.index).toBe(3);
  });

  it("keeps the same array, so a reader of history sees the compaction", () => {
    const state = createRunnerState();
    const journal = state.journal;

    fill(state, 2, 500);
    compact(state);

    expect(state.journal).toBe(journal);
  });
});

describe("createRunnerState", () => {
  it("starts with an empty journal and no position", () => {
    const state = createRunnerState();

    expect(state.journal).toEqual([]);
    expect(state.journalIndex).toBe(0);
    expect(state.stack).toEqual([]);
    expect(state.restFrame).toBeUndefined();
  });

  it("starts with no flow, no run and no failures", () => {
    const state = createRunnerState();

    expect(state.flows.size).toBe(0);
    expect(state.running).toBeUndefined();
    expect(state.abort).toBeUndefined();
    expect(state.flushing).toBeUndefined();
    expect(state.failures).toBe(0);
  });

  it("starts with one empty callback list per stage", () => {
    const state = createRunnerState();

    expect(state.enterCallbacks).toEqual({ load: [], scene: [] });
  });

  it("gives every state its own collections", () => {
    const first = createRunnerState();
    const second = createRunnerState();

    expect(first.journal).not.toBe(second.journal);
    expect(first.flows).not.toBe(second.flows);
  });
});
