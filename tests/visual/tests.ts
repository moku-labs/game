/**
 * @file Every visual test of the mini game, in the order a run plays them. The headless leg runs
 * them in `bun run test` (`tests/integration/visual-headless.test.ts`); both legs run with
 * `bun run mini:visual` (`run.ts`). The baselines live next to them: `<test>/<checkpoint>/`, the
 * headless files only.
 */
import type { VisualTest } from "@moku-labs/game/visual";
import { home } from "./home.visual";
import { infoPopup } from "./info-popup.visual";

export const miniVisualTests: readonly VisualTest[] = [home, infoPopup];
