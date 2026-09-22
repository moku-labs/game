import { describe, expect, it } from "vitest";
import { createIntlKit } from "../../intl";

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
