/**
 * @file The sheets game as one data object: the ward and the board with a live HUD above every sheet, and the four
 * sheets that lie over them (the shop, the case file, the inspection and the settings over the shop). It is the
 * fixture of the overlay tests and of the visual suite `tests/visual-sheets`. The seams (clock, save, manifest,
 * platform) come from the caller: a test, or the page.
 */
import { defineGameApp } from "@moku-labs/game/app";
import { boardFeature } from "./features/board";
import { casefileFeature } from "./features/casefile";
import { hudFeature } from "./features/hud";
import { inspectFeature } from "./features/inspect";
import { settingsFeature } from "./features/settings";
import { shopFeature } from "./features/shop";
import { wardFeature } from "./features/ward";
import { mainFlow } from "./flows/main";
import { startingPlayer, startingSession } from "./state";

export default defineGameApp({
  flow: mainFlow,
  safeNode: "ward",
  player: startingPlayer,
  session: startingSession,
  features: [
    wardFeature,
    boardFeature,
    hudFeature,
    shopFeature,
    casefileFeature,
    inspectFeature,
    settingsFeature
  ],
  headless: { features: [] },
  // The game draws on demand, as A Memory Missing does: a sheet at rest over a scene draws no frame.
  pluginConfigs: { renderer: { onDemand: true } }
});
