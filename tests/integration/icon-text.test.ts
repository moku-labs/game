/**
 * @file An icon inside wrapped text, headless: the note of Home is one `ui.note` string with
 * `<icon=ui.fx-spark>` in it, in both languages. The game reads its art from the fixture folder,
 * so `text` measures with the advance table of the real body font, as the page does: the note
 * takes two lines, and the spark rides in a line with its words.
 */
import { describe, expect, it } from "vitest";
import { createMiniGame } from "../fixtures/mini-game/game";
import { tr } from "../fixtures/mini-game/kit";
import { folderIo, readManifest, startOnHome } from "./mini-helpers";

/** The note of Home. */
const note = tr("home.note");

/**
 * Starts the game with its art read from disk and waits for Home with the `ui` bundle loaded.
 *
 * @returns The game, resting on `home`.
 */
async function startWithFonts() {
  const app = createMiniGame({ manifest: await readManifest(), io: folderIo().io });

  await startOnHome(app);
  expect(app.assets.isLoaded("ui")).toBe(true);

  return app;
}

describe("icon-text — a spark inside the wrapped note of Home", () => {
  it("measures the note on two lines of the body font, in English and in Russian", async () => {
    const app = await startWithFonts();
    // One line of the body font at 52: its line height of 55 at 44, scaled.
    const line = app.text.measure("Spark", "ui.note").height;

    expect(line).toBe(65);

    const english = app.text.measure(note, "ui.note");

    expect(english.height).toBe(2 * line);
    expect(english.width).toBeLessThanOrEqual(520);

    await app.i18n.setLocale("ru");

    const russian = app.text.measure(note, "ui.note");

    expect(russian.height).toBe(2 * line);
    expect(russian.width).toBeLessThanOrEqual(520);
    expect(
      app.log.trace().filter(entry => entry.level === "warn" && entry.event.startsWith("text"))
    ).toEqual([]);

    await app.stop();
  });

  it("measures the spark as one glyph as wide as the line is high", async () => {
    const app = await startWithFonts();
    const word = app.text.measure("Spark", "ui.note").width;
    const withIcon = app.text.measure("Spark<icon=ui.fx-spark>", "ui.note").width;

    expect(withIcon - word).toBe(65);

    await app.stop();
  });
});
