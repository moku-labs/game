/**
 * @file The sheets game as its visual tests play it: the app of the headless leg and the start of every test. The
 * headless app reads its art from the fixture folder, so `text` measures with the real font and `describe.json` holds
 * the layout the page draws. Nothing here imports a test runner: `bun tests/visual-sheets/run.ts` loads it as well as
 * vitest does.
 */
import { readFileSync } from "node:fs";
import type { Assets } from "@moku-labs/game";
import type { VisualSetup, VisualStart } from "@moku-labs/game/visual";
import sheetsGame from "../fixtures/sheets-game/index";
import { startingPlayer, startingSession } from "../fixtures/sheets-game/state";
import { folderIo } from "../integration/mini-helpers";

/** The folder of the sheets game. */
const sheetsFolder = new URL("../fixtures/sheets-game/", import.meta.url);

/** The dev manifest, the file the dev server hands the page. */
const manifest = JSON.parse(
  readFileSync(new URL("generated/manifest.json", sheetsFolder), "utf8")
) as Assets.Manifest;

/**
 * A fresh sheets game with its screen, not started: the setup of every visual test. Headless the renderer is inert;
 * the page `moku-game dev` serves builds the same app with `sheetsGame.screen()`.
 *
 * @returns The app.
 */
export const sheetsApp: VisualSetup["app"] = () =>
  sheetsGame.screen({ manifest, io: folderIo(sheetsFolder).io }).app;

/** Where most visual tests start: the ward, no sheet. */
export const atWard: VisualStart = {
  player: startingPlayer,
  session: startingSession,
  checkpoint: "ward"
};
