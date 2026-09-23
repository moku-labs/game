/**
 * @file The ink outline of Timber Town's words (design §2): every cream word on wood carries a
 * thick ink outline and a drop shadow that still shows below it; ink words on paper carry none.
 * The widths are measured on the design screenshots: 5 to 6 units at 54 to 64 units of text,
 * 9 to 10 on the logo and the Play sign.
 */
import { describe, expect, it } from "vitest";
import { uiStyles } from "../styles";

/** The ink of the art, the colour of every outline. */
const ink = 0x3a_22_12;

/** The cream voices: titles, buttons, numbers, the logo, the Play sign and the captions. */
const outlined = [
  "ui.title",
  "ui.button",
  "ui.button-small",
  "ui.plank",
  "ui.number",
  "ui.amount",
  "ui.caption",
  "ui.badge",
  "ui.logo",
  "ui.sign"
] as const;

/** The ink voices on paper: no outline. */
const onPaper = ["ui.tab", "ui.name", "ui.body", "ui.paragraph", "ui.link", "ui.small"] as const;

describe("ui styles — the ink outline", () => {
  it("outlines every cream word in ink, 6 to 10 % of its size", () => {
    for (const name of outlined) {
      const style = uiStyles.map[name];

      expect(style?.stroke, name).toBe(ink);
      // 6 units at 64 (the title), 9 and 10 at 110 and 130 (the Play sign and the logo).
      expect((style?.strokeWidth ?? 0) / (style?.size ?? 1), name).toBeGreaterThanOrEqual(0.06);
      expect((style?.strokeWidth ?? 0) / (style?.size ?? 1), name).toBeLessThanOrEqual(0.1);
    }

    expect(uiStyles.map["ui.button"]?.strokeWidth).toBe(5);
    expect(uiStyles.map["ui.title"]?.strokeWidth).toBe(6);
    expect(uiStyles.map["ui.logo"]?.strokeWidth).toBe(10);
  });

  it("keeps each drop shadow lower than the outline, so it still shows under the word", () => {
    for (const name of outlined) {
      const style = uiStyles.map[name];

      expect(style?.shadow?.dy ?? 0, name).toBeGreaterThan(style?.strokeWidth ?? 0);
    }
  });

  it("leaves the ink words on paper without an outline", () => {
    for (const name of onPaper) expect(uiStyles.map[name]?.strokeWidth, name).toBe(0);
  });
});
