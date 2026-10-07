/**
 * @file The visual tests of the mini game as `moku-game visual` reads them: the app of the
 * headless leg and every test, the two arguments of `runVisualTests`. The engine keeps its
 * baselines next to the tests, so a run names the folder:
 * `bun tests/fixtures/moku-game.ts visual --root tests/fixtures/mini-game --tests tests/visual/index.ts --dir tests/visual --no-pixels`.
 */
import { miniApp } from "./fixture";
import { miniVisualTests } from "./tests";

export default { app: miniApp, tests: miniVisualTests };
