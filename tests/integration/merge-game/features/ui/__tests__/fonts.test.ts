/**
 * @file The two MSDF fonts of Timber Town: every character the strings of the game use has a glyph
 * in both, so no label ever draws the missing-glyph box. The second test names an engine gap and
 * is skipped until the engine reads every glyph of these fonts.
 */
import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseAdvances } from "../../../../../../src/plugins/text/measure";

/** The folder of the game's features. */
const featuresFolder = new URL("../../", import.meta.url);

/** The two fonts of the `ui` bundle, by file stem. */
const fontStems = ["font-display", "font-body"] as const;

/**
 * Reads one `.fnt` of the `ui` bundle.
 *
 * @param stem - The file name without its extension.
 * @returns The file as text.
 */
async function fontFile(stem: string): Promise<string> {
  return readFile(new URL(`ui/assets/${stem}.fnt`, featuresFolder), "utf8");
}

/** One value of a string file: the message, or the message with a note for the translator. */
type StringValue = string | { text: string; note: string };

/** The locales the game ships. */
const locales = ["ru", "en"] as const;

/**
 * Reads every message of every feature, in every locale. A noted value counts by its text: the
 * note never reaches the screen.
 *
 * @returns The message texts, ICU syntax included.
 */
async function allMessages(): Promise<string[]> {
  const messages: string[] = [];

  for (const feature of await readdir(featuresFolder)) {
    for (const locale of locales) {
      const file = new URL(`${feature}/strings/${locale}.json`, featuresFolder);
      const text = await readFile(file, "utf8").catch(() => "{}");
      const values = Object.values(JSON.parse(text) as Record<string, StringValue>);

      messages.push(...values.map(value => (typeof value === "string" ? value : value.text)));
    }
  }

  return messages;
}

/**
 * The words `Intl` writes for a `{time, duration, short}` argument in every locale, hours to
 * seconds: the refill of the Out of energy popup is drawn with them.
 *
 * @returns One formatted duration per locale.
 */
function durationWords(): string[] {
  return locales.map(locale =>
    new Intl.DurationFormat(locale, { style: "short", secondsDisplay: "always" }).format({
      hours: 1,
      minutes: 2,
      seconds: 3
    })
  );
}

describe("the fonts of Timber Town", () => {
  it("has a glyph for every character of every string, in both fonts", async () => {
    const messages = [...(await allMessages()), ...durationWords()];
    // A line break is not drawn: `text` breaks the line there ("Смотреть и\nпополнить").
    const characters = new Set(
      messages.flatMap(message => [...message]).filter(character => character !== "\n")
    );

    for (const stem of fontStems) {
      const fnt = await fontFile(stem);
      const glyphs = new Set(
        [...fnt.matchAll(/<char id="(\d+)"/g)].map(match => String.fromCodePoint(Number(match[1])))
      );

      expect([...characters].filter(character => !glyphs.has(character))).toEqual([]);
    }
  });

  it("measures every glyph the fonts declare, `>` included", async () => {
    for (const stem of fontStems) {
      const fnt = await fontFile(stem);
      const declared = Number(/<chars count="(\d+)"/.exec(fnt)?.[1]);

      expect(parseAdvances(fnt, `ui.${stem}`).advances.size).toBe(declared);
    }
  });
});
