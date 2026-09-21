/**
 * The `@moku-labs/game` package — 2D puzzle game engine on Moku Core.
 *
 * Plugin options and their defaults, set through `pluginConfigs`:
 *
 * | Plugin | Option | Default |
 * |---|---|---|
 * | time | maxFps | 60 |
 * | time | maxDeltaMs | 50 |
 * | clock | source | undefined, the system source |
 * | model | playerProvider | undefined, in memory |
 * | model | initialPlayer | {} |
 * | model | initialSession | {} |
 * | model | seed | "from-save" |
 * | model | schemaVersion | 1 |
 * | model | migrations | [] |
 * | flow | mainFlow | undefined, required before run() |
 * | flow | safeNode | undefined, the start of the main flow |
 * | flow | retries | 1 |
 * | flow | settleTimeoutMs | 2000 |
 * | flow | journalLimit | 500 |
 *
 * @file The package root: the composed framework and its public exports.
 * @example
 * ```ts
 * const app = createApp({ pluginConfigs: { flow: { mainFlow } } });
 * ```
 */
import { coreConfig, createCore } from "./config";
import { clockPlugin, flowPlugin, lifecyclePlugin, modelPlugin, timePlugin } from "./plugins";
import { defineFeature } from "./plugins/flow/feature";
import { defineFlow, defineNode } from "./plugins/flow/runner/define";
import type { GameTypes, Kit } from "./plugins/flow/types";

/**
 * Framework-level `onError`: a hook threw. It prints to the console on purpose: when a hook fails,
 * the state of the kernel and of the plugins is unknown, and the log plugin may be the broken part.
 * The kernel gives this handler no ctx either. Everywhere else errors go through `ctx.log`.
 *
 * @param error - The error thrown by a hook.
 */
function reportHookError(error: Error): void {
  // @log-sink — the only console call in src, see the comment above.
  console.error("[game] A hook failed.", error);
}

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
 * // The entry point of a game. The graph is started by the game, never by the plugin.
 * const app = createApp({
 *   pluginConfigs: { flow: { mainFlow, safeNode: "home" } },
 *   onStart: ctx => void ctx.flow.run().catch(error => ctx.log.error("game: failed", { error }))
 * });
 * ```
 */
export const createApp = framework.createApp;

/**
 * Creates a game plugin.
 *
 * @example
 * ```ts
 * // A game plugin that writes every edge of the graph to the log.
 * export const edgeLog = createPlugin("edgeLog", {
 *   depends: [flowPlugin],
 *   hooks: ctx => ({ "flow:edge": ({ node, outcome }) => ctx.log.info("edge", { node, outcome }) })
 * });
 * ```
 */
export const createPlugin = framework.createPlugin;

/**
 * Binds the authoring helpers to the types of one game: "createApp for a game". The binding is
 * type-only; at run time these are the same functions the plugins export. One line per helper,
 * no logic: anything a single plugin can own lives in that plugin.
 *
 * @returns The helpers typed with the game's `player` and `session`.
 * @example
 * ```ts
 * export const { defineNode, defineFlow, defineFeature } = defineGame<{
 *   player: Player;
 *   session: Session;
 *   assets: AssetKey;
 *   strings: StringTable;
 * }>();
 * ```
 */
export function defineGame<Types extends GameTypes>(): Kit<Types> {
  return { defineNode, defineFlow, defineFeature };
}

// ─── Helpers (explicit, never export *) ───────────────────────
export { defineFeature } from "./plugins/flow/feature";
export { guide, hint, schedule } from "./plugins/flow/fx/descriptors";
export { exit, slot, to, type } from "./plugins/flow/runner/define";
export { SaveUnreadableError } from "./plugins/model/store/types";
