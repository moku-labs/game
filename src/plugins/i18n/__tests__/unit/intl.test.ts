import { afterEach, describe, expect, it, vi } from "vitest";
import { createIntlKit, durationInput } from "../../intl";

describe("createIntlKit", () => {
  it("carries the locale it was built for", () => {
    expect(createIntlKit("ru").locale).toBe("ru");
  });

  it("answers the same formatter for the same options", () => {
    const intl = createIntlKit("en");

    expect(intl.number()).toBe(intl.number());
    expect(intl.number({ style: "percent" })).toBe(intl.number({ style: "percent" }));
    expect(intl.plural()).toBe(intl.plural());
    expect(intl.list()).toBe(intl.list());
    expect(intl.date({ dateStyle: "short" })).toBe(intl.date({ dateStyle: "short" }));
  });

  it("answers a different formatter for different options", () => {
    const intl = createIntlKit("en");

    expect(intl.number({ style: "percent" })).not.toBe(intl.number());
    expect(intl.plural({ type: "ordinal" })).not.toBe(intl.plural());
    expect(intl.date({ timeStyle: "short" })).not.toBe(intl.date({ dateStyle: "short" }));
  });

  it("formats through the locale it was built for", () => {
    expect(createIntlKit("en").plural().select(3)).toBe("other");
    expect(createIntlKit("ru").plural().select(3)).toBe("few");
    expect(createIntlKit("en").plural({ type: "ordinal" }).select(3)).toBe("few");
  });

  it("keeps two kits apart", () => {
    expect(createIntlKit("en").number()).not.toBe(createIntlKit("ru").number());
  });
});

describe("createIntlKit duration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("formats through Intl.DurationFormat of the locale", () => {
    const intl = createIntlKit("en");

    expect(intl.duration({ style: "short" }).format({ minutes: 1, seconds: 35 })).toBe(
      "1 min, 35 sec"
    );
  });

  it("answers the same formatter for the same options, another for others", () => {
    const intl = createIntlKit("en");
    const short = { style: "short", secondsDisplay: "always" } as const;

    expect(intl.duration(short)).toBe(intl.duration({ ...short }));
    expect(intl.duration()).toBe(intl.duration());
    expect(intl.duration({ style: "digital" })).not.toBe(intl.duration(short));
  });

  it("names the runtime when Intl.DurationFormat is missing", () => {
    vi.stubGlobal(
      "Intl",
      Object.assign(Object.create(Intl) as object, { DurationFormat: undefined })
    );

    expect(() => createIntlKit("en").duration()).toThrow(
      "[game] i18n: Intl.DurationFormat is missing in this runtime.\n" +
        "  Use Bun 1.3.14+, Node 24+ or a WebGPU browser."
    );
  });
});

describe("durationInput", () => {
  it.each([
    [95_000, { minutes: 1, seconds: 35 }],
    [3_605_000, { hours: 1, seconds: 5 }],
    [7_295_000, { hours: 2, minutes: 1, seconds: 35 }],
    [3_600_000, { hours: 1, seconds: 0 }],
    [0, { seconds: 0 }],
    [500, { seconds: 1 }],
    [59_001, { minutes: 1, seconds: 0 }]
  ])("splits %d ms into whole seconds, rounded up", (ms, expected) => {
    expect(durationInput(ms)).toEqual(expected);
  });

  it.each([
    -5,
    -60_000,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ])("reads %d ms as zero seconds", ms => {
    expect(durationInput(ms)).toEqual({ seconds: 0 });
  });
});
