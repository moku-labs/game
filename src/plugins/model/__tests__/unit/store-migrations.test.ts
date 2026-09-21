import { describe, expect, it, vi } from "vitest";
import { migrate, readSaveDoc } from "../../store/migrations";
import type { Migration } from "../../store/types";
import { SaveUnreadableError } from "../../store/types";
import type { Json } from "../../types";

const record = (value: Json): Record<string, Json> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The test expected a record.");
  }
  return value;
};

const saved = (coins: number): Json => ({
  player: { coins },
  rng: { seed: 42, streams: { "chest:1": 7 } }
});

const addLevel: Migration = {
  from: 1,
  up: state => ({ ...record(state), level: 1 })
};

const renameLevel: Migration = {
  from: 2,
  up: state => {
    const { level, ...rest } = record(state);
    return { ...rest, stage: level ?? 0 };
  }
};

describe("migrate", () => {
  it("returns the state unchanged when the versions match", () => {
    const state = saved(3);

    expect(migrate(state, 2, 2, [addLevel])).toBe(state);
  });

  it("runs the chain step by step", () => {
    const result = record(migrate(saved(3), 1, 3, [addLevel, renameLevel]));

    expect(result.stage).toBe(1);
    expect(result.level).toBeUndefined();
  });

  it("finds a step by its version, not by its position", () => {
    const result = record(migrate(saved(3), 1, 3, [renameLevel, addLevel]));

    expect(result.stage).toBe(1);
  });

  it("reports every step it runs", () => {
    const onStep = vi.fn();

    migrate(saved(3), 1, 3, [addLevel, renameLevel], onStep);

    expect(onStep.mock.calls).toEqual([
      [1, 2],
      [2, 3]
    ]);
  });

  it("rejects a save newer than the schema", () => {
    expect(() => migrate(saved(3), 4, 2, [])).toThrow(SaveUnreadableError);
  });

  it("names both versions in the error", () => {
    expect(() => migrate(saved(3), 4, 2, [])).toThrow(
      "[game] The save of version 4 cannot be read by schema version 2.\n  Add the missing migration or restore the backup."
    );
  });

  it("carries the versions on the error", () => {
    try {
      migrate(saved(3), 1, 3, [addLevel]);
      expect.unreachable("migrate should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SaveUnreadableError);
      if (!(error instanceof SaveUnreadableError)) return;
      expect(error.savedVersion).toBe(1);
      expect(error.schemaVersion).toBe(3);
      expect(error.name).toBe("SaveUnreadableError");
    }
  });

  it("explains a missing step in the cause", () => {
    try {
      migrate(saved(3), 1, 3, [addLevel]);
      expect.unreachable("migrate should have thrown");
    } catch (error) {
      if (!(error instanceof SaveUnreadableError)) throw error;
      expect(error.cause).toBeInstanceOf(Error);
      expect(String(error.cause)).toContain("2");
    }
  });

  it("wraps a throwing step", () => {
    const failure = new Error("bad migration");
    const broken: Migration = {
      from: 1,
      up: () => {
        throw failure;
      }
    };

    try {
      migrate(saved(3), 1, 2, [broken]);
      expect.unreachable("migrate should have thrown");
    } catch (error) {
      if (!(error instanceof SaveUnreadableError)) throw error;
      expect(error.cause).toBe(failure);
    }
  });
});

describe("readSaveDoc", () => {
  it("reads the player and the rng branch of a save", () => {
    const doc = readSaveDoc(saved(3), 1, 1);

    expect(record(doc.player).coins).toBe(3);
    expect(doc.rng).toEqual({ seed: 42, streams: { "chest:1": 7 } });
  });

  it("rejects a save that is not a record", () => {
    expect(() => readSaveDoc(7, 1, 1)).toThrow(SaveUnreadableError);
  });

  it("rejects a save without a player tree", () => {
    expect(() => readSaveDoc({ rng: { seed: 1, streams: {} } }, 1, 1)).toThrow(SaveUnreadableError);
  });

  it("rejects a save without an rng branch", () => {
    expect(() => readSaveDoc({ player: {} }, 1, 1)).toThrow(SaveUnreadableError);
  });

  it("rejects a seed that is not a number", () => {
    expect(() => readSaveDoc({ player: {}, rng: { seed: "42", streams: {} } }, 1, 1)).toThrow(
      SaveUnreadableError
    );
  });

  it("rejects a stream state that is not a number", () => {
    expect(() =>
      readSaveDoc({ player: {}, rng: { seed: 1, streams: { "chest:1": "7" } } }, 1, 1)
    ).toThrow(SaveUnreadableError);
  });

  it("rejects streams that are not a record", () => {
    expect(() => readSaveDoc({ player: {}, rng: { seed: 1, streams: [] } }, 1, 1)).toThrow(
      SaveUnreadableError
    );
  });
});
