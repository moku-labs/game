// biome-ignore-all assist/source/organizeImports: sectioned manifest (Framework API → Plugins → Helpers → Types) is house style
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
import { bundlesFor } from "./plugins/assets/bundles";
import { flowFor } from "./plugins/flow/feature";
import type { BundlesOf, GameTypes } from "./plugins/flow/types";
import { componentsFor } from "./plugins/renderer/components";
import { scenesFor } from "./plugins/scenes/define";
import { projectionFor } from "./plugins/world/projection/define";

const framework = createCore(coreConfig, {
  // Dependency order (spec/11 §1.3, §1.5). The screen set is a list the game spreads in (later cycles).
  plugins: [timePlugin, lifecyclePlugin, modelPlugin, clockPlugin, flowPlugin],
  // A hook threw. Core 1.7 hands the framework `onError` the core plugin APIs, which exist before the
  // event bus and are safe whenever a hook can fail (core spec/02 §3), so the error goes to the log.
  onError: (error, { log }) => log.error("game: a hook failed", undefined, error)
});

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
 * Binds the authoring helpers to the types of one game: "createApp for a game". Each plugin binds
 * its own helpers (`flowFor`, `projectionFor`, `componentsFor`, `bundlesFor`, `scenesFor`); this
 * only spreads them, so the kit's type is inferred and never written by hand. At run time these
 * are the same functions and component objects the plugins export.
 *
 * @returns The helpers typed with the game's `player`, `session`, `assets` and `bundles`.
 * @example
 * ```ts
 * // kit.ts of a game: bound once, imported by every node, flow and view file.
 * export const { defineNode, defineFlow, defineFeature, projection, sprite, Sprite, defineBundles, load, defineScene } =
 *   defineGame<{ player: Player; session: Session; assets: AssetKey; bundles: BundleKey; strings: StringTable }>();
 * ```
 */
export function defineGame<Types extends GameTypes>() {
  return {
    ...flowFor<{ player: Types["player"]; session: Types["session"] }>(),
    ...projectionFor<Types["player"], Types["session"]>(),
    ...componentsFor<Types["assets"]>(),
    ...bundlesFor<BundlesOf<Types>>(),
    ...scenesFor<Types["assets"], BundlesOf<Types>>()
  };
}

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

// ─── Plugins + Types ──────────────────────────────────────────
export * from "./plugins";

// ─── Helpers (explicit, never export *) ───────────────────────
// flow: nodes, flows, features, effect descriptors
export { defineFeature } from "./plugins/flow/feature";
export { guide, hint, schedule } from "./plugins/flow/fx/descriptors";
export { exit, slot, to, type } from "./plugins/flow/runner/define";
// model
export { SaveUnreadableError } from "./plugins/model/store/types";
// world: the ECS vocabulary and the projection
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
// renderer: the display components
export {
  Display,
  NineSlice,
  Parent,
  Sprite,
  sprite,
  Transform
} from "./plugins/renderer/components";
// input: gestures as data
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
// assets and scenes: declarations
export { defineBundles, load } from "./plugins/assets/bundles";
export { defineScene } from "./plugins/scenes/define";
