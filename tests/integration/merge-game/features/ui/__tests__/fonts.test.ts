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

/**
 * Reads every message of every feature, in every locale.
 *
 * @returns The message texts, ICU syntax included.
 */
async function allMessages(): Promise<string[]> {
  const messages: string[] = [];

  for (const feature of await readdir(featuresFolder)) {
    for (const locale of ["ru", "en"]) {
      const file = new URL(`${feature}/strings/${locale}.json`, featuresFolder);
      const text = await readFile(file, "utf8").catch(() => "{}");

      messages.push(...Object.values(JSON.parse(text) as Record<string, string>));
    }
  }

  return messages;
}

describe("the fonts of Timber Town", () => {
  it("has a glyph for every character of every string, in both fonts", async () => {
    const messages = await allMessages();
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
