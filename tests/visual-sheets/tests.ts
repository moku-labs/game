/**
 * @file Every visual test of the sheets game, in the order a run plays them: the five K5 scenarios of spec 22. The
 * headless leg runs them in `bun run test` (`tests/integration/visual-headless.test.ts`); both legs, WebGPU and WebGL,
 * run with `bun run sheets:visual` (`run.ts`), with `debug.verifyFrames` on. The baselines live next to them:
 * `<test>/<checkpoint>/`, the headless files only.
 */
import type { VisualTest } from "@moku-labs/game/visual";
import { casefileOverWard } from "./casefile-over-ward.visual";
import { inspectionPage } from "./inspection-page.visual";
import { sheetOverSheet } from "./sheet-over-sheet.visual";
import { shopBuyClose } from "./shop-buy-close.visual";
import { wardToBoard } from "./ward-to-board.visual";

export const sheetsVisualTests: readonly VisualTest[] = [
  shopBuyClose,
  casefileOverWard,
  inspectionPage,
  wardToBoard,
  sheetOverSheet
];
