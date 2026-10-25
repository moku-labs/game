import { describe, expect, it } from "vitest";
import { commands } from "../../src/control";
import { sources } from "../../src/inspect";
import { Transform } from "../../src/plugins/renderer/components";
import { schemaOf } from "../../src/plugins/world/ecs/schema";
import { alloc } from "./alloc";

// ---------------------------------------------------------------------------
// Perf: the editor doors must not share V8's hidden shapes with the game's data (F77). A door
// descriptor or a schema built as a literal with the keys of a point (`{ x: "number", y: "number" }`)
// or of a `Transform` (`{ x: "number", y: "number", rotation: "number", … }`) stores strings where
// the game stores numbers: V8 turns the fields of that shape from double to tagged, and from then on
// every fractional write into any `{ x, y }` boxes a new heap number of 16 B. A Memory Missing's
// garbage test counted 107–119 B a frame against 0. Every door module is loaded and the component
// schema built before the windows, the way a debug build loads them.
// ---------------------------------------------------------------------------

/** Calls before a window, so the writes run optimized. */
const WARM_CALLS = 30_000;

/** Calls of a window. */
const CALLS = 100_000;

/** The bytes per call the `alloc` helper itself tolerates. */
const NOISE = 1;

/**
 * The heap bytes one call keeps, the call run until V8 optimized it first.
 *
 * @param fn - The write.
 * @returns Bytes per call.
 */
function bytesPerCall(fn: () => void): number {
  for (let call = 0; call < WARM_CALLS; call += 1) fn();

  return alloc(fn, CALLS);
}

/** The moving value, in a typed array: a double kept there is never boxed, so the windows count the targets alone. */
const counter = new Float64Array(1);

/**
 * The next fractional number, `0.375`, `0.5`, … wrapping before 1000.
 *
 * @returns The number.
 */
function next(): number {
  counter[0] = (counter[0] ?? 0) > 1000 ? 0.25 : (counter[0] ?? 0) + 0.125;

  return counter[0] ?? 0;
}

describe("door shapes (F77): writes into game data after the doors loaded, heap bytes per call", () => {
  // The doors are loaded and the component schema is built, as the editor's palette reads it.
  expect(Object.keys(sources).length + Object.keys(commands).length).toBeGreaterThan(0);
  expect(schemaOf([Transform]).length).toBe(1);

  // Bug: the `game.at` source's input `{ x: "number", y: "number" }` turns every `{ x, y }` tagged.
  it("a point literal keeps its numbers unboxed", () => {
    const point = { x: 0.5, y: 0.5 };
    const move = (): void => {
      point.x = next();
      point.y = next();
    };

    expect(bytesPerCall(move)).toBeLessThanOrEqual(NOISE);
  });

  // Bug: the `game.diff` source's input `{ from: "number", to: "number" }` turns every `{ from, to }` tagged.
  it("a from-to literal keeps its numbers unboxed", () => {
    const range = { from: 0.5, to: 0.5 };
    const move = (): void => {
      range.from = next();
      range.to = next();
    };

    expect(bytesPerCall(move)).toBeLessThanOrEqual(NOISE);
  });
});
