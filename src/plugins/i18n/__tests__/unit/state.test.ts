import { describe, expect, it } from "vitest";
import { createI18nState } from "../../state";

describe("createI18nState", () => {
  it("starts with no locale, nothing registered, nothing loaded and no load in flight", () => {
    const state = createI18nState();

    expect(state.locale).toBe("");
    expect(state.registered.size).toBe(0);
    expect(state.loaded.size).toBe(0);
    expect(state.intl.size).toBe(0);
    expect(state.warned.size).toBe(0);
    expect(state.loading).toBeUndefined();
  });

  it("gives every app its own maps", () => {
    const first = createI18nState();
    const second = createI18nState();

    first.warned.add("hud.orders");

    expect(second.warned.size).toBe(0);
  });
});
