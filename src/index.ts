/**
 * @file The `@moku-labs/game` package — 2D puzzle game engine on Moku Core.
 */
import { coreConfig, createCore } from "./config";
import { clockPlugin, flowPlugin, lifecyclePlugin, modelPlugin, timePlugin } from "./plugins";
import { reportHookError } from "./teardown";

const framework = createCore(coreConfig, {
  // Dependency order (spec/11 §1.3, §1.5). The screen set is a list the game spreads in (later cycles).
  plugins: [timePlugin, lifecyclePlugin, modelPlugin, clockPlugin, flowPlugin],
  onError: reportHookError
});

// ─── Plugins + Types ──────────────────────────────────────────
export * from "./plugins";

// ─── Framework API ────────────────────────────────────────────
/**
 * Creates a game application.
 *
 * @example
 * ```ts
 * const app = createApp({ plugins: [boardFeature] });
 * ```
 */
export const createApp = framework.createApp;

/**
 * Creates a game plugin.
 *
 * @example
 * ```ts
 * export const scorePlugin = createPlugin("score", { api: createScoreApi });
 * ```
 */
export const createPlugin = framework.createPlugin;

// ─── Helpers (explicit, never export *) ───────────────────────
export { defineGame } from "./kit";
export { rules } from "./merge";
export { guide, hint, schedule } from "./plugins/flow/fx/descriptors";
export { exit, slot, to, type } from "./plugins/flow/runner/define";
export { SaveUnreadableError } from "./plugins/model/store/types";
export { teardown } from "./teardown";
