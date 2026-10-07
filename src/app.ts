/**
 * @file The `@moku-labs/game/app` entry: re-exports only. A game is two files: `config.ts`, plain
 * data that `satisfies GameConfig`, and `index.ts`, one `defineGameApp` object. Its tests make the
 * app with `game.headless()` or `game.screen()`. It imports no `node:` module, no
 * `@moku-labs/system` and no `@moku-labs/native`, and never the testing entry.
 */
export { defineGameApp, startMoment } from "./app/define";
export type {
  GameApp,
  GameConfig,
  GameDefinition,
  GameHandle,
  GamePluginConfigs,
  HeadlessSeams,
  MemoryProvider,
  PageAgent,
  SaveKind,
  Scenario,
  ScreenSeams,
  SystemName
} from "./app/types";
