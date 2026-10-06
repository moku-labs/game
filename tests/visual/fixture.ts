/**
 * @file The mini game as its visual tests play it: the app of the headless leg and the start of
 * every test. The headless app reads its art from the fixture folder, so `text` measures with the
 * real font and `describe.json` holds the layout the page draws. Nothing here imports a test
 * runner: `bun tests/visual/run.ts` loads it as well as vitest does.
 */
import { readFileSync } from "node:fs";
import type { Assets } from "@moku-labs/game";
import type { VisualSetup, VisualStart } from "@moku-labs/game/visual";
import { createMiniGame } from "../fixtures/mini-game/game";
import { startingSession } from "../fixtures/mini-game/state";
import { ready } from "../fixtures/mini-game/web/scenarios";
import { folderIo, miniFolder } from "../integration/mini-helpers";

/** The dev manifest, the file the dev server hands the page. */
const manifest = JSON.parse(
  readFileSync(new URL("manifest.json", miniFolder), "utf8")
) as Assets.Manifest;

/**
 * A fresh mini game with its screen, not started: the setup of every visual test. Headless the
 * renderer is inert; the page of the pixel leg builds the same app in `web/main.ts`.
 *
 * @returns The app.
 */
export const miniApp: VisualSetup["app"] = () => createMiniGame({ manifest, io: folderIo().io });

/** Where every visual test starts: the `ready` save of the dev page at Home, the counter at 3. */
export const atHome: VisualStart = {
  player: ready,
  session: startingSession,
  checkpoint: "home"
};
