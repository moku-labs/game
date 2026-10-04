import { describe, expect, it } from "vitest";
import type { Json } from "../../../model/types";
import { isProjectionTarget, readTarget } from "../../target";

describe("isProjectionTarget", () => {
  it("takes an object with a string projection and a string key", () => {
    expect(isProjectionTarget({ projection: "board.items", key: "i5" })).toBe(true);
  });

  it.each([
    ["undefined", undefined],
    ["null", JSON.parse("null") as Json],
    ["a list", ["board.items", "i5"]],
    ["a number key", { projection: "board.items", key: 5 }]
  ])("refuses %s", (_name, value: Json | undefined) => {
    expect(isProjectionTarget(value)).toBe(false);
  });
});

describe("readTarget", () => {
  it("reads a fresh target out of the JSON", () => {
    const value = { projection: "board.items", key: "i5", extra: true };
    const target = readTarget(value);

    expect(target).toEqual({ projection: "board.items", key: "i5" });
    expect(target).not.toBe(value);
  });

  it("throws the target error for anything else", () => {
    expect(() => readTarget("i5")).toThrow(
      /^\[game] The target is not a projection key\.\n {2}.*\.$/
    );
  });
});
