/**
 * @file An icon inside wrapped text, headless (V5): the note of the daily gift is one `ui.paragraph`
 * string with `<icon=ui.icon-coin>` in it, in both languages. The game reads its art from the
 * fixture folder, so `text` measures with the advance tables of the real fonts, as the page does:
 * the note takes two lines, and the coin rides in the second line with its word.
 */

import { describe, expect, it } from "vitest";
import { createScreenGame } from "./merge-game/game";
import { tr } from "./merge-game/kit";
import { folderIo, frames, nodeOf, player, readManifest, tap, tick, until } from "./timber-helpers";

/** The folder of the fixture game: the dev manifest's paths are relative to it. */
const gameFolder = new URL("merge-game/", import.meta.url);

/** The note of the daily gift popup. */
const note = tr("gift.note");

/**
 * Starts the game with its art read from disk and waits for Home with the `ui` bundle loaded.
 *
 * @returns The game, resting on `home`.
 */
async function startWithFonts() {
  const game = createScreenGame({
    player,
    manifest: await readManifest(),
    io: folderIo(gameFolder).io
  });

  await game.app.start();
  game.app.flow.run().catch(() => undefined);
  await until(game, () => game.app.flow.state().path === "home" && game.app.assets.isLoaded("ui"));
  await frames(game);

  return game;
}

describe("timber-icon-text — a coin inside the wrapped note of the daily gift", () => {
  it("measures the note on two lines of the body font, in Russian and in English", async () => {
    const game = await startWithFonts();
    // One line of the body font at 52: its line height of 55 at 44, scaled.
    const line = game.app.text.measure("Подарок", "ui.paragraph").height;

    expect(line).toBe(65);

    const russian = game.app.text.measure(note, "ui.paragraph");

    expect(russian.height).toBe(2 * line);
    expect(russian.width).toBeLessThanOrEqual(520);

    await game.app.i18n.setLocale("en");

    const english = game.app.text.measure(note, "ui.paragraph");

    expect(english.height).toBe(2 * line);
    expect(english.width).toBeLessThanOrEqual(520);
    expect(
      game.app.log.trace().filter(entry => entry.level === "warn" && entry.event.startsWith("text"))
    ).toEqual([]);

    await game.app.stop();
  });

  it("lays the note out on the parchment of the gift popup at two lines", async () => {
    const game = await startWithFonts();

    await tap(game, "gift");
    await tick();

    const text = nodeOf(game.app.ui.tree(), "giftNote");

    expect(text?.rect.h).toBe(2 * 65);
    expect(nodeOf(game.app.ui.tree(), "giftNotePaper")?.style.nineSlice).toBe("ui.panel-parchment");

    await game.app.stop();
  });
});
