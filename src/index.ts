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
 * | world | settleMs | 350 |
 * | world | reconciledEvent | false |
 * | renderer | mount | undefined, inert without a mount |
 * | renderer | background | 0x000000 |
 * | renderer | antialias | false |
 * | renderer | maxResolution | 2 |
 * | renderer | preference | "webgpu", WebGL is Pixi's fallback |
 * | renderer | aspect | { min: 4/3, max: 21/9 } |
 * | renderer | poolLimit | 256 |
 * | renderer | unsupportedMessage | "This device cannot run the game." |
 * | renderer | loadPixi | () => import("pixi.js") |
 * | input | tapSlopPx | 12 |
 * | input | longPressMs | 450 |
 * | input | dragStartPx | 8 |
 * | input | swipeMinPx | 48 |
 * | input | swipeMaxMs | 300 |
 * | assets | manifest | undefined, a URL or an inline manifest |
 * | assets | textureBudgetMb | 192 |
 * | assets | preloadDepth | 2 |
 * | assets | baseUrl | undefined |
 * | assets | io | undefined, the browser fetch and the renderer textures |
 *
 * @file The package root: the composed framework and its public exports.
 * @example
 * ```ts
 * const app = createApp({ pluginConfigs: { flow: { mainFlow } } });
 * ```
 */
import { coreConfig, createCore } from "./config";
import {
  assetsPlugin,
  clockPlugin,
  flowPlugin,
  inputPlugin,
  lifecyclePlugin,
  modelPlugin,
  rendererPlugin,
  scenesPlugin,
  timePlugin,
  worldPlugin
} from "./plugins";
import { defineBundles, load } from "./plugins/assets/bundles";
import { defineFeature } from "./plugins/flow/feature";
import { defineFlow, defineNode } from "./plugins/flow/runner/define";
import type { GameTypes, Kit } from "./plugins/flow/types";
import { sprite } from "./plugins/renderer/components";
import { defineScene } from "./plugins/scenes/define";
import { projection } from "./plugins/world/projection/define";

const framework = createCore(coreConfig, {
  // Dependency order (spec/11 §1.3, §1.5). The screen set is a list the game spreads in (later cycles).
  plugins: [timePlugin, lifecyclePlugin, modelPlugin, clockPlugin, flowPlugin],
  // A hook threw. Core 1.7 hands the framework `onError` the core plugin APIs, which exist before the
  // event bus and are safe whenever a hook can fail (core spec/02 §3), so the error goes to the log.
  onError: (error, { log }) => log.error("game: a hook failed", undefined, error)
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
  return {
    defineNode,
    defineFlow,
    defineFeature,
    projection,
    sprite,
    defineBundles,
    load,
    defineScene
  };
}

export { defineBundles, load } from "./plugins/assets/bundles";
// ─── Helpers (explicit, never export *) ───────────────────────
export { defineFeature } from "./plugins/flow/feature";
export { guide, hint, schedule } from "./plugins/flow/fx/descriptors";
export { exit, slot, to, type } from "./plugins/flow/runner/define";
export {
  Draggable,
  DropTarget,
  Held,
  Hovered,
  Pointer,
  Pressable,
  Pressed,
  Swipeable,
  Tappable
} from "./plugins/input/components";
export { SaveUnreadableError } from "./plugins/model/store/types";
export {
  Display,
  NineSlice,
  Parent,
  Sprite,
  sprite,
  Transform
} from "./plugins/renderer/components";
export { defineScene } from "./plugins/scenes/define";
export {
  component,
  Exiting,
  Layer,
  mut,
  Order,
  resource,
  system,
  tag
} from "./plugins/world/ecs/define";
export { projection } from "./plugins/world/projection/define";

// ─── Plugin sets ──────────────────────────────────────────────
/**
 * The screen plugins, in dependency order. A game with a screen spreads them into `plugins`;
 * a headless test leaves them out. V2: `world`, `renderer`, `input`, `assets`, `scenes`. V3 appends `anim`, `i18n`, `text`, `ui`.
 *
 * @example
 * ```ts
 * createApp({ plugins: [...screen, boardFeature], pluginConfigs: { renderer: { mount: "#game" } } });
 * ```
 */
export const screen = [
  worldPlugin,
  rendererPlugin,
  inputPlugin,
  assetsPlugin,
  scenesPlugin
] as const;
