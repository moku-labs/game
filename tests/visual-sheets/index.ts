/**
 * @file The visual tests of the sheets game as `moku-game visual` reads them: the setup of the headless leg and every
 * test, the two arguments of `runVisualTests`. A run names the folder of the baselines:
 * `bun tests/fixtures/moku-game.ts visual --root tests/fixtures/sheets-game --tests tests/visual-sheets/index.ts --dir tests/visual-sheets --no-pixels`.
 */
import { sheetsApp } from "./fixture";
import { sheetsVisualTests } from "./tests";

export default { app: { app: sheetsApp }, tests: sheetsVisualTests };
