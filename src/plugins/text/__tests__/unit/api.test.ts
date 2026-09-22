import { describe, expect, it, vi } from "vitest";
import type { Part } from "../../../i18n/types";
import { defineTextStyles } from "../../components";
import { miniFontJson } from "../fixtures/mini-font";
import { createMockText, type MockText } from "./mock-text";

// ---------------------------------------------------------------------------
// The two members `ui.layout` and a dev overlay call. Both answer without a
// canvas, so the numbers below are the same in a browser and in plain Bun.
// ---------------------------------------------------------------------------

/** The parts the fake `i18n` answers with. */
const messages: Record<string, Record<string, Part[]>> = {
  ru: { "hud.orders": [{ kind: "text", text: "12" }] }
};

/**
 * The warnings one message was written with. Every warning goes through `ctx.log.warn`, so a case
 * that is about one of them counts that one.
 *
 * @param mock - The mock plugin.
 * @param message - The log event to count.
 * @returns The calls that carried it.
 */
function warningsOf(mock: MockText, message: string): unknown[][] {
  return vi.mocked(mock.log.warn).mock.calls.filter(call => call[0] === message);
}

/** A started plugin with one feature style. */
function started(): MockText {
  const mock = createMockText({
    messages,
    features: [
      {
        name: "hud",
        description: {
          textStyles: defineTextStyles({
            "hud.digits": { font: "ui.font-digits", size: 64, fill: 1, digits: true }
          })
        }
      }
    ]
  });

  mock.start();

  return mock;
}

describe("measure", () => {
  it("answers the fallback size while no font is loaded", () => {
    const mock = started();
    const size = mock.api.measure("120", "digits");

    expect(size.width).toBeCloseTo(57.6, 5);
    expect(size.height).toBeCloseTo(38.4, 5);
  });

  it("scales with the size of the style", () => {
    const mock = started();
    const size = mock.api.measure("12", "hud.digits");

    expect(size.width).toBeCloseTo(76.8, 5);
    expect(size.height).toBeCloseTo(76.8, 5);
  });

  it("formats a message before it measures it", () => {
    const mock = started();

    expect(mock.api.measure({ key: "hud.orders" }, "body").width).toBeCloseTo(38.4, 5);
    expect(mock.i18n.formatted).toEqual(["hud.orders"]);
  });

  it("measures from the advance table once the font is there", () => {
    const mock = started();

    mock.assets.fonts.set("ui.font-body", { fnt: miniFontJson, texture: undefined as never });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });

    expect(mock.api.measure("12", "body")).toEqual({ width: 36, height: 40 });
  });

  it("measures an unknown style as body and warns once", () => {
    const mock = started();

    expect(mock.api.measure("12", "nope")).toEqual(mock.api.measure("12", "body"));
    expect(mock.api.measure("1", "nope")).toEqual(mock.api.measure("1", "body"));
    expect(warningsOf(mock, "text: unknown style")).toHaveLength(1);
  });

  it("lays the same content and style out once", () => {
    const mock = started();

    mock.api.measure("12", "body");
    mock.api.measure("12", "body");
    mock.api.measure("12", "digits");

    expect(mock.state.cache.size).toBe(2);
  });
});

describe("the layout cache", () => {
  it("keeps at most 1024 blocks and drops the oldest first", () => {
    const mock = started();

    for (let index = 0; index <= 1024; index += 1) mock.api.measure(String(index), "body");

    expect(mock.state.cache.size).toBe(1024);
    expect([...mock.state.cache.keys()].some(key => key.endsWith("0"))).toBe(true);
  });
});

describe("styles", () => {
  it("lists the built-ins first, then the styles of every feature", () => {
    const mock = started();

    expect(mock.api.styles()).toEqual(["body", "digits", "hud.digits"]);
  });

  it("hands out a frozen list, so nobody registers a style by pushing", () => {
    const mock = started();

    expect(Object.isFrozen(mock.api.styles())).toBe(true);
  });
});
