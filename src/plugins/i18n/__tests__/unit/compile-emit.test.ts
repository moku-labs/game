import { describe, expect, it } from "vitest";
import { emitLocale, emitTypes } from "../../compile/emit";
import { compileMessage } from "../../compile/message";
import { createIntlKit, durationInput } from "../../intl";
import type { IntlKit } from "../../types";
import { evaluateModule } from "./evaluate";

const HELPER_HEAD =
  "function duration(ms: number): Partial<Record<Intl.DurationFormatUnit, number>> {";

/**
 * A duration "format" that writes back the record it was handed.
 *
 * @param input - What the emitted helper built.
 * @returns The record as JSON.
 */
function format(input: object): string {
  return JSON.stringify(input);
}

/**
 * A kit whose duration formatter writes back the record it was handed, so a test reads what the
 * emitted helper produced.
 *
 * @returns The kit of "en" with a recording `duration`.
 */
function recordingKit(): IntlKit {
  return { ...createIntlKit("en"), duration: () => ({ format }) as unknown as Intl.DurationFormat };
}

/**
 * Runs the emitted `duration` helper on one value.
 *
 * @param ms - Milliseconds.
 * @returns The record the helper built, as JSON.
 */
function helperOf(ms: number): string {
  const module = evaluateModule(
    emitLocale([{ key: "chest.opens", compiled: compileMessage("{left, duration}") }])
  );
  const parts = module["chest.opens"]?.({ left: ms }, recordingKit()) ?? [];

  return parts.map(part => (part.kind === "text" ? part.text : "")).join("");
}

describe("the duration helper of a locale module", () => {
  it("is emitted once when several messages need it", () => {
    const source = emitLocale([
      { key: "chest.opens", compiled: compileMessage("Opens in {left, duration}") },
      { key: "energy.refill", compiled: compileMessage("Refills in {time, duration, long}") }
    ]);

    expect(source.split(HELPER_HEAD)).toHaveLength(2);
  });

  it("is not emitted when no message needs it", () => {
    const source = emitLocale([{ key: "hud.coins", compiled: compileMessage("{n, number}") }]);

    expect(source).not.toContain("function duration(");
  });

  it("sits next to the argument helper when both are needed", () => {
    const source = emitLocale([
      { key: "chest.opens", compiled: compileMessage("{name} opens in {left, duration}") }
    ]);

    expect(source).toContain("function argument(value: unknown, intl: I18n.IntlKit): I18n.Part {");
    expect(source).toContain(HELPER_HEAD);
  });

  it("builds the record Intl.DurationFormat reads", () => {
    expect(helperOf(95_000)).toBe('{"minutes":1,"seconds":35}');
    expect(helperOf(3_605_000)).toBe('{"hours":1,"seconds":5}');
    expect(helperOf(0)).toBe('{"seconds":0}');
  });

  it.each([
    0,
    1,
    500,
    999,
    1000,
    59_001,
    60_000,
    95_000,
    3_600_000,
    7_295_000,
    -5,
    Number.NaN
  ])("splits %d ms the way durationInput does", ms => {
    expect(helperOf(ms)).toBe(JSON.stringify(durationInput(ms)));
  });

  it("splits an infinite value the way durationInput does", () => {
    expect(helperOf(Number.POSITIVE_INFINITY)).toBe(
      JSON.stringify(durationInput(Number.POSITIVE_INFINITY))
    );
  });
});

describe("the types module", () => {
  it("types a duration parameter as milliseconds", () => {
    const source = emitTypes([{ key: "chest.opens", params: { left: { kind: "duration" } } }]);

    expect(source).toContain('  "chest.opens": { left: number };');
    expect(source).not.toContain("DescriptionNode");
  });
});
