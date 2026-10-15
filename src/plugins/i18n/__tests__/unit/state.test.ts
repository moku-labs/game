import { describe, expect, it } from "vitest";
import { createI18nState } from "../../state";

describe("createI18nState", () => {
  // The empty start state is asserted once, in lifecycle.test.ts ("createI18nState adds held,
  // bundled, coupled empty and started false"); the owner had the duplicate here removed.
  it("gives every app its own maps", () => {
    const first = createI18nState();
    const second = createI18nState();

    first.warned.add("hud.orders");

    expect(second.warned.size).toBe(0);
  });
});
