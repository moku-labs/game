/**
 * @file effects plugin — shared types: the config, the state both modules work on, the resolved
 * dependencies, the public API and its stats; re-exports the public types of `particles` and
 * `filters`.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Events as GlobalEvents, Require } from "../../config";
import type { AnimApi } from "../anim/types";
import type { Api as AssetsApi, Events as AssetsEvents } from "../assets/types";
import type { Api as FlowApi } from "../flow/types";
import type { Api as RendererApi } from "../renderer/types";
import type { Entity, Api as WorldApi } from "../world/types";
import type { CheckState, FilteredView, FilterKind } from "./filters/types";
import type { BakedEmitter, EmitterDefinition, EmitterInstance } from "./particles/types";

/**
 * effects plugin config. `maxParticles` here is the global warning line; the `maxParticles` of an
 * emitter config caps one instance.
 *
 * @example
 * ```ts
 * createApp({
 *   plugins: [...screen, effectsPlugin],
 *   pluginConfigs: { effects: { maxPasses: 16, phone: false } }
 * });
 * ```
 */
export type Config = {
  /** Live particles over all instances above which one dev warning fires per crossing. */
  maxParticles: number;
  /** Render passes per frame above which one dev warning fires per crossing. */
  maxPasses: number;
  /** Whether this device is a phone. `"auto"`: a coarse pointer and a short side of at most 820 CSS px, read once in `onStart`. */
  phone: boolean | "auto";
  /**
   * What a `Blur` with `quality: 0` and `resolution: 0` resolves to. Shallow merge: a game that
   * sets `blur` gives both fields.
   */
  blur: { quality: number; phoneResolution: number };
};

/**
 * effects plugin state: the particle half, the filter half, and what both share.
 */
export type State = {
  /** Resolved in `onStart`. */
  phone: boolean;
  /** The `emitters` of every feature, read in `onStart`. */
  emitters: Map<string, EmitterDefinition>;
  /** Per effect id, built on first use. */
  baked: Map<string, BakedEmitter>;
  /** Host entity to its running instance. */
  instances: Map<Entity, EmitterInstance>;
  /** World-space instances whose host left, stepped until empty. */
  orphans: Set<EmitterInstance>;
  /** Ordinal of the next instance: the cosmetic seed. */
  seedCounter: number;
  /** Live particles after the last step. */
  particles: number;
  /** Filter kinds whose shader or one of whose stages failed the check on the running backend, in every build. */
  broken: Set<string>;
  /** Filter kinds whose main definition and every stage answered ok: a kind's status is a set lookup once settled. */
  ready: Set<string>;
  /** The filter kinds, built-ins first, then the filters of every feature. */
  kinds: Map<string, FilterKind>;
  /** The shader check of every definition a kind can draw, in every build. */
  checks: CheckState;
  /** Entity to the filters the sync keeps for it. */
  views: Map<Entity, FilteredView>;
  /** Keys of the one-shot warnings: `"emitter:fx.x"`, `"texture:board.cell"`, `"atlas:fx.x"`. */
  warned: Set<string>;
  /** Whether each budget warning is in force, so a crossing warns once. */
  over: { particles: boolean; passes: boolean; fullScreen: boolean };
  /** The teardown closure, the two systems and the world hooks. */
  removers: Array<() => void>;
  /**
   * The switches of a debug build: the kind ids in registration order (frozen, filled in `onStart`), the kinds
   * turned off, and those as a frozen list in the order of `kinds`.
   */
  diagnostics: { kinds: readonly string[]; off: Set<string>; offList: readonly string[] };
};

/**
 * What `app.effects.stats()` answers: live particles, running emitter instances, filter instances
 * on views, and the render passes of the frame as the renderer counts them.
 *
 * @example
 * ```ts
 * const stats: EffectsStats = { particles: 120, emitters: 3, filters: 25, renderPasses: 49 };
 * ```
 */
export type EffectsStats = {
  /** Live particles over every instance and orphan after the last step. */
  particles: number;
  /** Running instances plus the orphans still flying. */
  emitters: number;
  /** Filter instances over every view; the stages of a filter's inputs are counted in `renderPasses`, not here. */
  filters: number;
  /** `renderer.sync.renderPasses()`, read at call time. */
  renderPasses: number;
};

/**
 * effects plugin API, `app.effects`. Everything a game does with effects is data on entities;
 * the API only counts.
 *
 * @example
 * ```ts
 * // A test waits for a merge burst to land before it compares the board.
 * while (app.effects.stats().particles > 0) app.time.step(16);
 * app.effects.stats().particles; // 0
 * ```
 */
export type EffectsApi = {
  /**
   * Counts what runs now. `renderPasses` is the renderer's own number, read at call time; the
   * others are the plugin's. Headless every number is 0.
   *
   * @returns A fresh object: live particles, emitter instances with orphans, filter instances
   *   and render passes.
   * @example
   * ```ts
   * // After the board rests: one steam stream, 24 enabled glows on 24 views, one disabled blur.
   * app.effects.stats();
   * // { particles: 18, emitters: 1, filters: 25, renderPasses: 49 }: 1 + 24 × (1 + 1), the disabled blur costs 0
   * ```
   */
  stats(): EffectsStats;

  /**
   * Switches of a debug build: filter kinds turned off by hand, to measure what a kind costs on the device. Acts on
   * a page with the agent flag (a debug build, the dev page); elsewhere `disable` and `enable` change nothing. An off
   * kind keeps its instances: `stats().filters` still counts them, `renderPasses` drops.
   *
   * @example
   * ```ts
   * // A game's overlay toggle "Glow": the frame without any glow, then with it again.
   * app.effects.diagnostics.disable("effects.glow"); // true
   * app.effects.diagnostics.enable("effects.glow"); // true
   * ```
   */
  diagnostics: EffectsDiagnostics;
};

/**
 * Switches of a debug build: filter kinds turned off by hand, to measure what a kind costs on the device. Acts on
 * a page with the agent flag (a debug build, the dev page); elsewhere `disable` and `enable` change nothing.
 *
 * @example
 * ```ts
 * // A game's overlay toggle "Glow" (H4.4): the frame without any glow, then with it again.
 * app.effects.diagnostics.disable("effects.glow"); // true
 * app.effects.diagnostics.enable("effects.glow"); // true
 * ```
 */
export type EffectsDiagnostics = {
  /**
   * The filter kinds this app knows, in registration order: the seven built-ins, then the `filters` of every
   * feature. The same frozen array on every call; empty before start. Every build.
   *
   * @returns The kind ids.
   * @example
   * ```ts
   * // A game with the frost filter of its casefile feature, after start.
   * app.effects.diagnostics.kinds();
   * // ["effects.glow", "effects.outline", "effects.blur", "effects.colorMatrix", "effects.noise",
   * //  "effects.displacement", "effects.alpha", "casefile.frost"]
   * ```
   */
  kinds(): readonly string[];

  /**
   * Turns a filter kind off: from the next frame no view draws it (no apply, no render pass), while its instances
   * stay and are still written, so `enable` shows the current look at once. Agent pages only.
   *
   * @param kind - A kind id of `kinds()`.
   * @returns True when the kind is known and now off; false for an unknown kind, and on a page without the agent
   *   flag, where nothing changes.
   * @example
   * ```ts
   * // The owner measures the board without the glow of its four cards (one glow pass each).
   * app.effects.diagnostics.disable("effects.glow"); // true
   * app.time.step(16);
   * app.effects.stats().renderPasses; // 9, down from 13
   * app.effects.diagnostics.disable("fx.nope"); // false, and one warning effects:diagnostics-unknown
   * ```
   */
  disable(kind: string): boolean;

  /**
   * Turns a filter kind on again: from the next frame its views draw it with their current values.
   *
   * @param kind - A kind id of `kinds()`.
   * @returns True when the kind is known and now on; false for an unknown kind and without the agent flag.
   * @example
   * ```ts
   * app.effects.diagnostics.enable("effects.glow"); // true
   * app.time.step(16);
   * app.effects.stats().renderPasses; // 13
   * ```
   */
  enable(kind: string): boolean;

  /**
   * The kinds turned off now, in registration order. The same frozen array until the next change; empty without
   * the agent flag.
   *
   * @returns The kind ids.
   * @example
   * ```ts
   * app.effects.diagnostics.disable("casefile.frost");
   * app.effects.diagnostics.disable("effects.glow");
   * app.effects.diagnostics.disabled(); // ["effects.glow", "casefile.frost"]
   * ```
   */
  disabled(): readonly string[];
};

/**
 * Resolved dependency APIs.
 */
export type Deps = {
  flow: FlowApi;
  world: WorldApi;
  renderer: RendererApi;
  assets: AssetsApi;
  anim: AnimApi;
};

/**
 * What the kernel context offers before the deps are attached. `effects` owns no event, so
 * `emit` is the kernel's and never called here.
 */
export type KernelSlice = PluginCtx<Config, State> & {
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Domain context shared by both modules: the kernel slice plus the resolved deps.
 */
export type EffectsCtx = KernelSlice & { readonly deps: Deps };

/**
 * Payload of the `assets:bundle-unloaded` hook: `keys` names every texture that is gone.
 */
export type BundleUnloaded = AssetsEvents["assets:bundle-unloaded"];

/**
 * Payload of the `assets:replaced` hook: `keys` names every asset a dev hot swap gave new bytes.
 */
export type AssetsReplaced = AssetsEvents["assets:replaced"];

/**
 * Payload of the global `ui:hot-swap` hook: the saved file and its new exports.
 */
export type HotSwap = GlobalEvents["ui:hot-swap"];

export type { FilterCache } from "../renderer/types";
export type {
  AlphaValue,
  BlurValue,
  ColorMatrixValue,
  CoreKind,
  DisplacementValue,
  FilterChainContext,
  FilterComponent,
  FilterDefinition,
  FilterInput,
  FilterInputDefinition,
  FilterSpec,
  FilterStage,
  FilterStep,
  FilterValueOf,
  GlowValue,
  NoiseValue,
  OutlineValue,
  UniformDeclaration,
  UniformSpec,
  UniformValue
} from "./filters/types";
export type {
  Curve,
  EmitterConfig,
  EmitterDefinition,
  EmitterValue,
  Range,
  ResolvedEmitterConfig,
  Shape
} from "./particles/types";
