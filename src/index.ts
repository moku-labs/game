// biome-ignore-all assist/source/organizeImports: sectioned manifest (Framework API → Plugins → Helpers → Types) is house style
/**
 * The `@moku-labs/game` package — 2D puzzle game engine on Moku Core.
 *
 * Global options and their defaults, set through `config`:
 *
 * | Option | Default |
 * |---|---|
 * | orientation | "portrait" |
 * | referenceSide | 1080 |
 * | referenceLong | 1920, the long side the layout needs inside the safe area |
 *
 * Plugin options and their defaults, set through `pluginConfigs`:
 *
 * | Plugin | Option | Default |
 * |---|---|---|
 * | time | maxFps | 60 |
 * | time | maxDeltaMs | 50 |
 * | time | idleFps | 30 |
 * | time | idleAfterMs | 2000 |
 * | time | adaptive | false |
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
 * | flow | holdMs | 0, an answer to a closed gate lives one frame |
 * | world | settleMs | 350 |
 * | world | reconciledEvent | false |
 * | renderer | mount | undefined, inert without a mount |
 * | renderer | background | 0x000000 |
 * | renderer | antialias | false |
 * | renderer | maxResolution | 2 |
 * | renderer | poolTrim | { restMs: 1000, aboveMb: 16 }, the idle render targets of Pixi's pool go after a second at rest, a second after a scene change and on a pause; false keeps them; shallow merge: a game that sets `poolTrim` gives both fields |
 * | renderer | preference | "webgpu", WebGL is Pixi's fallback |
 * | renderer | aspect | { min: 4/3, max: 21/9 }; shallow merge: a game that sets `aspect` gives both fields |
 * | renderer | poolLimit | 256 |
 * | renderer | adaptiveScale | { floor: 0.75, devices: "phone" }, the render scale of the adaptive frame rate on a GPU-bound phone; false keeps the resolution; shallow merge: a game that sets it gives both fields |
 * | renderer | unsupportedMessage | "This device cannot run the game." |
 * | renderer | loadPixi | () => import("pixi.js") |
 * | renderer | debug | { nineSlice: false, verifyFrames: false, kept: true, overdraw: false }; shallow merge: a game that sets `debug` replaces the whole object, and a switch it leaves out is off, except `kept`, which stays on unless set to false; `verifyFrames` and `overdraw` work in dev and debug builds only |
 * | renderer | onDemand | false, every frame is drawn; true draws only a frame in which something changed |
 * | renderer | monitor | { budgetMs: "rate", frames: 1024, stillFrames: 60, stillMpx: 0.25, churnPerSecond: 4, churnSeconds: 3, churnAfterTrimMs: 1000 }, the performance log of an agent build, the thresholds of its `problem` rules and `sections`, the sections it starts with (`MonitorSections`, every one on when left out); shallow merge: a game that sets `monitor` gives `budgetMs` and `frames`, a threshold it leaves out keeps its default, a section it leaves out is on |
 * | renderer | keptMb | 64, MiB the kept pictures may hold: a filtered view that did not change is drawn from its picture, the least recently drawn goes first; 0 keeps none |
 * | renderer | warm | 1, probe draws a drawn frame that create the GPU pipelines while the game loads; 0 creates each in the first frame that needs it |
 * | renderer | uploads | 1, texture sources `sync.textures.upload` puts on the GPU a drawn frame (~9 ms each on the A26); 0 turns the queue off |
 * | input | tapSlopPx | 12 |
 * | input | longPressMs | 450 |
 * | input | dragStartPx | 8 |
 * | input | swipeMinPx | 48 |
 * | input | swipeMaxMs | 300 |
 * | input | heldScale | 1 |
 * | input | cursor | { control: "pointer", idle: "" }; shallow merge: a game that sets `cursor` gives both fields |
 * | input | traceStepPx | 32 |
 * | input | traceInset | 0.4 |
 * | assets | manifest | undefined, a URL or an inline manifest |
 * | assets | textureBudgetMb | 192 |
 * | assets | preloadDepth | 2 |
 * | assets | baseUrl | undefined |
 * | assets | io | undefined, the browser fetch and the renderer textures |
 * | scenes | buildMs | "auto", two thirds of a frame ((1000 / time.rate().fps) * 2 / 3, 11.1 ms at 60 Hz), read at each build start; a number fixes it |
 * | scenes | leave | { cover: { color: 0x000000, alpha: 0.45, inMs: 50, outMs: 150 }, loader: { afterMs: 400 } }, what a live switch shows over the scene being left: a veil from its start and a loader (the engine's ring, a `texture` or a `projection`) once it took `afterMs`; a scene's `leave` is merged over it field by field, a field left out keeps this default, `false` turns a part or the whole off |
 * | anim | maxTracks | 2000 |
 * | anim | reducedMotion | false |
 * | i18n | locale | "en" |
 * | i18n | fallback | "en" |
 * | i18n | locales | {} |
 * | text | fonts | { body: "ui.font-body", digits: "ui.font-digits" }; shallow merge: a game that sets `fonts` gives both fields |
 * | ui | tapTargetPt | 44 |
 * | ui | breakpoints | { tall: 2, wide: 1.5 }; shallow merge: a game that sets `breakpoints` gives both fields |
 * | ui | focusRing | { stroke: 0x3a2212, strokeWidth: 4, dash: 10, offset: 9, halo: 0xfff3d6, haloWidth: 12 }; shallow merge: a game that sets `focusRing` gives all six fields |
 * | ui | textInput | { caretWidth: 3, caret: 0x000000, selection: 0x3390ff, selectionAlpha: 0.35, composingUnderline: 3, keyboardMargin: 16 }; shallow merge |
 * | audio | buses | { master: 1, music: 0.6, sfx: 1 }; shallow merge: a game that sets `buses` gives all three fields |
 * | audio | musicFadeMs | 600 |
 * | audio | sfxFadeMs | 120 |
 * | audio | volumes | undefined, the buses stay at `buses` |
 * | audio | context | undefined, the real AudioContext |
 * | audio | journal | 0, no started sound is kept |
 * | audio | music | "decode", gapless; "stream" plays an `<audio>` element |
 * | audio | session | "ambient", iOS only |
 * | effects | maxParticles | 3000, live particles above which one dev warning fires per crossing |
 * | effects | maxPasses | 24, render passes per frame above which one dev warning fires once they stay over it 60 frames in a row |
 * | effects | phone | "auto", a coarse pointer and a short side of at most 820 CSS px |
 * | effects | blur | { quality: 2, phoneResolution: 0.5 }, what a Blur with quality 0 and resolution 0 resolves to; shallow merge: a game that sets `blur` gives both fields |
 * | platform | provider | undefined, inert: no subscription, no haptic handler, `back()` answers "none"; the engine page passes the system shell's provider |
 * | platform | keepAwake | false |
 *
 * Subpaths next to the root:
 *
 * | Subpath | What |
 * |---|---|
 * | `@moku-labs/game/app` | `defineGameApp`, the game as one data object with `headless()` and `screen()`; `startMoment`; the types of `index.ts` and `config.ts` (`GameConfig`) |
 * | `@moku-labs/game/app/page` | `startPage`, the page the generated `.moku/main.ts` calls: `?player=` scenarios, the system shell, the dev agents |
 * | `@moku-labs/game/app/system` | the system shell over the optional peer `@moku-labs/system`: `systemShellOf`, `fromSystem`, `storeSave`, `createSystemApp` |
 * | `@moku-labs/game/cli` | `runCli` of the bin `moku-game` and `preparePage` for the editor, node and bun only |
 * | `@moku-labs/game/testing` | headless play, repro runs, isolated feature tests (`isolate`, `stub`), the in-memory save, the fake clock |
 * | `@moku-labs/game/visual` | the visual tests, node and bun only |
 * | `@moku-labs/game/assets` | the build-time asset key scanner and the production packer (`packAssets`, `--pack <dir>`), node and bun only |
 * | `@moku-labs/game/inspect` | the editor's read door: `read`, `watch`, `defineSource`, the `sources` catalogue |
 * | `@moku-labs/game/control` | the editor's write door, dev builds only: `run`, `defineCommand`, the `commands` catalogue |
 * | `@moku-labs/game/hot` | the Bun plugin that hot swaps views; `moku-game dev` lists it in its bunfig |
 * | `@moku-labs/game/lint` | the oxlint JS plugin `moku-game` with the game lint rules |
 * | `@moku-labs/game/project` | the project index of a game's sources, node and bun only |
 * | `@moku-labs/game/jsx-runtime`, `/jsx-dev-runtime` | the JSX runtimes `jsxImportSource: "@moku-labs/game"` names |
 * | `@moku-labs/game/fonts/*` | the MSDF body font `font-body.fnt` + `.png` and its OFL licence; a game copies them into `features/ui/assets/` |
 * | bin `moku-game` | `dev`, `build`, `native <verb>`, `keys`, `pack`, `visual`: serves, builds, packages, packs and visually tests a game folder, bun only |
 * | bin `moku-game-assets` | the asset scanner CLI, bun only |
 * | bin `moku-game-index` | the project index CLI, bun only |
 *
 * @file The package root: the composed framework and its public exports.
 * @example
 * ```ts
 * const app = createApp({ pluginConfigs: { flow: { mainFlow } } });
 * ```
 */
import { coreConfig, createCore } from "./config";
import {
  animPlugin,
  assetsPlugin,
  clockPlugin,
  debugPlugin,
  flowPlugin,
  i18nPlugin,
  inputPlugin,
  lifecyclePlugin,
  modelPlugin,
  rendererPlugin,
  scenesPlugin,
  textPlugin,
  timePlugin,
  uiPlugin,
  worldPlugin
} from "./plugins";
import { animFor } from "./plugins/anim/bind";
import { bundlesFor } from "./plugins/assets/bundles";
import { audioFor } from "./plugins/audio/descriptors";
import { effectsFor } from "./plugins/effects/bind";
import { flowFor } from "./plugins/flow/feature";
import type {
  BundlesOf,
  EmitterIdOf,
  GameTypes,
  HudKeysOf,
  SceneIdOf,
  TextStylesOf
} from "./plugins/flow/types";
import { i18nFor } from "./plugins/i18n/tr";
import { componentsFor } from "./plugins/renderer/components";
import { scenesFor } from "./plugins/scenes/define";
import { textFor } from "./plugins/text/components";
import { uiFor } from "./plugins/ui/components";
import { systemsFor } from "./plugins/world/ecs/define";
import { projectionFor } from "./plugins/world/projection/define";

const framework = createCore(coreConfig, {
  // Dependency order (spec/11 §1.3, §1.5). The screen set is a list the game spreads in (later cycles).
  plugins: [timePlugin, lifecyclePlugin, modelPlugin, clockPlugin, debugPlugin, flowPlugin],
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
 * its own helpers (`flowFor`, `projectionFor`, `systemsFor`, `componentsFor`, `bundlesFor`,
 * `scenesFor`, `i18nFor`, `audioFor`); this only spreads them, so the kit's type is inferred and
 * never written by hand. At run time these are the same functions and component objects the
 * plugins export. The kit's `system` and `volumes` read the game's player and session; `key` types
 * a string key written in code (a key that comes from data is checked with `app.i18n.isKey`).
 *
 * @returns The helpers typed with the game's `player`, `session`, `assets`, `bundles`, `strings`,
 *   `emitters` and `hud` (the HUD part keys of `HudPart` and `Overlay`).
 * @example
 * ```ts
 * // kit.ts of a game: bound once, imported by every node, flow and view file.
 * export const { defineNode, defineFlow, defineFeature, projection, system, sprite, Sprite, defineBundles, load, defineScene, tr, key, volumes } =
 *   defineGame<{ player: Player; session: Session; assets: AssetKey; bundles: BundleKey; strings: StringTable }>();
 * ```
 */
export function defineGame<Types extends GameTypes>() {
  return {
    ...flowFor<{ player: Types["player"]; session: Types["session"]; scenes: SceneIdOf<Types> }>(),
    ...projectionFor<Types["player"], Types["session"]>(),
    ...systemsFor<Types["player"], Types["session"]>(),
    ...componentsFor<Types["assets"], HudKeysOf<Types>>(),
    ...bundlesFor<BundlesOf<Types>>(),
    ...scenesFor<Types["assets"], BundlesOf<Types>, Types["player"], Types["session"]>(),
    ...animFor<Types["assets"]>(),
    ...i18nFor<Types["strings"]>(),
    ...textFor<TextStylesOf<Types>, Types["assets"]>(),
    ...uiFor<Types["assets"], TextStylesOf<Types>, Extract<keyof Types["strings"], string>>(),
    ...audioFor<Types["assets"], Types["player"]>(),
    ...effectsFor<Types["assets"], EmitterIdOf<Types>>()
  };
}

// ─── Plugin sets ──────────────────────────────────────────────
/**
 * The screen plugins, in dependency order. A game with a screen spreads them into `plugins`;
 * a headless test leaves them out. V2: `world`, `renderer`, `input`, `assets`, `scenes`. V3 appends `anim`, `i18n`, `text`, `ui`; `audio`, `effects` and `platform` stay opt-in: `[...screen, effectsPlugin, audioPlugin, platformPlugin]`.
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
  scenesPlugin,
  animPlugin,
  i18nPlugin,
  textPlugin,
  uiPlugin
] as const;

// ─── Plugins + Types ──────────────────────────────────────────
export * from "./plugins";
// Bun's dev bundler drops values reached only through `export *`; a page built from src needs
// every plugin value named here.
export { audioPlugin, effectsPlugin, platformPlugin } from "./plugins";

// ─── Helpers (explicit, never export *) ───────────────────────
// flow: nodes, flows, features, effect descriptors
export { defineFeature, flattenFeatures } from "./plugins/flow/feature";
export { guide, hint, schedule } from "./plugins/flow/fx/descriptors";
export { defineEffect } from "./plugins/flow/fx/effect";
export { contribution, exit, slot, to, type } from "./plugins/flow/runner/define";
// model
export { SaveUnreadableError } from "./plugins/model/store/types";
// world: the ECS vocabulary and the projection
export {
  component,
  Exiting,
  Layer,
  mut,
  Now,
  Order,
  resource,
  system,
  tag,
  Tree
} from "./plugins/world/ecs/define";
export { projection } from "./plugins/world/projection/define";
export type {
  AnchorTarget,
  DescriptionNode,
  SceneSwitch
} from "./plugins/world/projection/types";
// renderer: the display components
export {
  Display,
  HudPart,
  NineSlice,
  Overlay,
  Parent,
  Shape,
  Sprite,
  sprite,
  Transform
} from "./plugins/renderer/components";
export type { HudPartValue, OverlayValue, SpriteBlend } from "./plugins/renderer/components";
// renderer: the performance log of an agent build, its frame ring and the record of one frame
export {
  MONITOR_SECTIONS,
  PERF_CAUSES,
  PERF_GAP_BUCKETS,
  PERF_LOG_VERSION,
  PROBLEM_RULES,
  SHADER_WHATS
} from "./plugins/renderer/monitor/log-types";
export { frameAt, PASS_KINDS } from "./plugins/renderer/monitor/ring";
export { CANVAS_RESTARTS, DEMAND_REASONS } from "./plugins/renderer/reasons";
export type {
  CanvasRestart,
  FrameColumns,
  FrameReadout,
  FrameReadResult,
  FrameRecord,
  FrameRing,
  LongFrameEntry,
  MonitorConfig,
  MonitorCounts,
  MonitorSections,
  OverlayEventDetail,
  OverlayWhat,
  PassKind,
  PassRecord,
  PerfCause,
  PerfChange,
  PerfChangeEntry,
  PerfCollectorLine,
  PerfCounts,
  PerfDisplay,
  PerfEventLine,
  PerfEventName,
  PerfGapLine,
  PerfHeaderLine,
  PerfLogLine,
  PerfLongFrameLine,
  PerfMarkLine,
  PerfMeasured,
  PerfSampleLine,
  PerfSpikeLine,
  PerfStartupLine,
  PerfTelemetryLine,
  PerfThermalLine,
  PoolTrim,
  AdaptiveScale,
  PoolTrimDetail,
  ProblemEventDetail,
  ProblemRule,
  RetakeWhy,
  ShaderEventDetail,
  ShaderWhat,
  WarmDetail,
  WhyEntry,
  WhyLive
} from "./plugins/renderer/types";
// input: gestures as data
export {
  Draggable,
  DropTarget,
  Held,
  Hovered,
  Pointer,
  PointerOver,
  Pressable,
  Pressed,
  Swipeable,
  Tappable,
  Touchable,
  Traceable,
  Traced
} from "./plugins/input/components";
// assets and scenes: declarations
export { defineBundles, load, ready } from "./plugins/assets/bundles";
export { defineScene } from "./plugins/scenes/define";
// anim: choreography as data, the motion sugar, its components, the AnimPlayer resource of systems
export { Animation, AnimPlayer, Frames } from "./plugins/anim/components";
export { defineMotion } from "./plugins/anim/motion";
export { cubicBezier } from "./plugins/anim/tween/bezier";
export {
  defineAnimation,
  external,
  frames,
  HAPTIC_KINDS,
  haptic,
  mark,
  parallel,
  play,
  sequence,
  set,
  sfx,
  spawn,
  spawned,
  stagger,
  stopSfx,
  tween,
  use,
  wait
} from "./plugins/anim/timeline/steps";
export type { HapticKind } from "./plugins/anim/timeline/types";
// i18n: messages as data, and the two helpers a generated strings module imports
export { messageArgument, messageDuration } from "./plugins/i18n/intl";
export { tr } from "./plugins/i18n/tr";
// text: the Text component, board labels, text styles, bound numbers and countdowns
export { bind, Countdown, defineTextStyles, label, Text } from "./plugins/text/components";
export type { BindOptions, CountdownValue, TextFormat } from "./plugins/text/types";
// ui: components, styles, tokens, the popup effect and the ui-owned components
export { Box, DebugTrigger, LocalWrite, popup, ScrollState } from "./plugins/ui/components";
export { defineComponent } from "./plugins/ui/jsx/component";
export { defineStyle } from "./plugins/ui/styles/define";
export { resolve } from "./plugins/ui/styles/resolve";
export { defineTokens } from "./plugins/ui/styles/tokens";
// audio: the music descriptor (sfx is anim's)
export { music } from "./plugins/audio/descriptors";
// effects: particles and filters as data on entities
export {
  Alpha,
  Blur,
  ColorMatrix,
  Displacement,
  Glow,
  Noise,
  Outline
} from "./plugins/effects/filters/builtins";
export { defineFilter } from "./plugins/effects/filters/define";
export type { FilterArea } from "./plugins/effects/filters/types";
export { Emitter } from "./plugins/effects/particles/component";
export { defineEmitter } from "./plugins/effects/particles/define";
// platform: the provider seam a game fills, and what one Back press ends in
export type { BackResult, PlatformProvider } from "./plugins/platform/types";
