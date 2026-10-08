/**
 * @file The mini game as its visual tests play it: the app of the headless leg and the start of
 * every test. The headless app reads its art from the fixture folder, so `text` measures with the
 * real font and `describe.json` holds the layout the page draws. Nothing here imports a test
 * runner: `bun tests/visual/run.ts` loads it as well as vitest does.
 */
import { readFileSync } from "node:fs";
import type { Assets } from "@moku-labs/game";
import { startMoment } from "@moku-labs/game/app";
import type { VisualSetup, VisualStart } from "@moku-labs/game/visual";
import miniGame from "../fixtures/mini-game/index";
import { startingSession } from "../fixtures/mini-game/state";
import ready from "../fixtures/mini-game/tests/scenarios/ready";
import { folderIo, miniFolder } from "../integration/mini-helpers";

/** The dev manifest, the file the dev server hands the page. */
const manifest = JSON.parse(
  readFileSync(new URL("generated/manifest.json", miniFolder), "utf8")
) as Assets.Manifest;

/**
 * A fresh mini game with its screen, not started: the setup of every visual test. Headless the
 * renderer is inert; the page `moku-game dev` serves builds the same app with `miniGame.screen()`.
 *
 * @returns The app.
 */
export const miniApp: VisualSetup["app"] = () =>
  miniGame.screen({ manifest, io: folderIo().io }).app;

/** Where every visual test starts: the `ready` save of the dev page at Home, the counter at 3. */
export const atHome: VisualStart = {
  player: ready(startMoment).player,
  session: startingSession,
  checkpoint: "home"
};
