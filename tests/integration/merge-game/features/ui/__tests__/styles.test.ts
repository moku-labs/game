/**
 * @file The ink outline of Timber Town's words (design §2): every cream word on wood carries a
 * thick ink outline and a drop shadow that still shows below it; ink words on paper carry none.
 * The widths are measured on the design screenshots: 5 to 6 units at 54 to 64 units of text,
 * 9 to 10 on the logo and the Play sign. The words of a field are dark enough that its
 * placeholder, drawn at half alpha, reads at 3:1 on the cream slot (WCAG 1.4.11).
 */
import { describe, expect, it } from "vitest";
import { theme } from "../kit";
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
const onPaper = [
  "ui.tab",
  "ui.name",
  "ui.body",
  "ui.field",
  "ui.paragraph",
  "ui.link",
  "ui.small"
] as const;

/** The alpha the engine draws the placeholder of a field at (`ui/jsx/fields.ts`). */
const PLACEHOLDER_ALPHA = 0.5;

/**
 * One sRGB channel in linear light (WCAG 2.2).
 *
 * @param channel - The channel, 0..255.
 * @returns 0..1.
 */
function linear(channel: number): number {
  const value = channel / 255;

  return value <= 0.040_45 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * The relative luminance of a colour (WCAG 2.2).
 *
 * @param color - The colour, `0xrrggbb`.
 * @returns 0 for black to 1 for white.
 */
function luminance(color: number): number {
  return (
    0.2126 * linear((color >> 16) & 0xff) +
    0.7152 * linear((color >> 8) & 0xff) +
    0.0722 * linear(color & 0xff)
  );
}

/**
 * The contrast ratio of two colours (WCAG 2.2).
 *
 * @param first - One colour.
 * @param second - The other colour.
 * @returns 1 to 21.
 */
function contrast(first: number, second: number): number {
  const [light, dark] = [luminance(first), luminance(second)].toSorted((a, b) => b - a);

  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/**
 * A colour drawn at an alpha over another, channel by channel.
 *
 * @param top - The colour drawn.
 * @param under - The colour under it.
 * @param alpha - The alpha of the top colour.
 * @returns The colour on the screen.
 */
function over(top: number, under: number, alpha: number): number {
  const channel = (shift: number) =>
    Math.round(alpha * ((top >> shift) & 0xff) + (1 - alpha) * ((under >> shift) & 0xff));

  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

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

describe("ui styles — the name field", () => {
  it("keeps the placeholder at 3:1 on the cream slot at the half alpha the engine draws it with", () => {
    const words = uiStyles.map["ui.field"]?.fill ?? theme.color.cream;
    const placeholder = over(words, theme.color.cream, PLACEHOLDER_ALPHA);

    expect(contrast(placeholder, theme.color.cream)).toBeGreaterThanOrEqual(3);
    // The ink of the body would sit right on the line: 3.00 at half alpha.
    expect(
      contrast(over(theme.color.ink, theme.color.cream, PLACEHOLDER_ALPHA), theme.color.cream)
    ).toBeLessThan(3.01);
    // The typed name itself reads far above body-text contrast.
    expect(contrast(words, theme.color.cream)).toBeGreaterThanOrEqual(7);
  });
});
