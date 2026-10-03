/**
 * @file Every visual test of the fixture game, in the order a run plays them. The headless leg
 * runs them in `bun run test` (`tests/integration/visual-headless.test.ts`); both legs run with
 * `bun run fixture:visual` (`run.ts`). The baselines live next to them: `<test>/<checkpoint>/`.
 */
import type { VisualTest } from "@moku-labs/game/testing";
import { boardMerge } from "./board-merge.visual";
import { giftPopup } from "./gift-popup.visual";
import { home } from "./home.visual";
import { renamePopup } from "./rename-popup.visual";
import { rewardPopup } from "./reward-popup.visual";
import { settings } from "./settings.visual";

export const fixtureVisualTests: readonly VisualTest[] = [
  home,
  boardMerge,
  rewardPopup,
  renamePopup,
  giftPopup,
  settings
];
