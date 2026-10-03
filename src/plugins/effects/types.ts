/**
 * @file effects plugin — shared types: the config, the state both modules work on, the resolved
 * dependencies, the public API and its stats; re-exports the public types of `particles` and
 * `filters`.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Api as AssetsApi, Events as AssetsEvents } from "../assets/types";
import type { Api as FlowApi } from "../flow/types";
import type { Api as RendererApi } from "../renderer/types";
import type { Entity, Api as WorldApi } from "../world/types";
import type { FilteredView, FilterKind } from "./filters/types";
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
  /** What a `Blur` with `quality: 0` and `resolution: 0` resolves to. */
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
  /** Filter kinds whose WGSL failed the dev check. */
  broken: Set<string>;
  /** The filter kinds, built-ins first, then the filters of every feature. */
  kinds: Map<string, FilterKind>;
  /** The dev WGSL check per kind; `broken` holds the failed ones. */
  checks: Map<string, "pending" | "ok">;
  /** Entity to the filters the sync keeps for it. */
  views: Map<Entity, FilteredView>;
  /** Keys of the one-shot warnings: `"emitter:fx.x"`, `"texture:board.cell"`, `"atlas:fx.x"`. */
  warned: Set<string>;
  /** Whether each budget warning is in force, so a crossing warns once. */
  over: { particles: boolean; passes: boolean; fullScreen: boolean };
  /** The teardown closure, the two systems and the world hooks. */
  removers: Array<() => void>;
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
  /** Filter instances over every view. */
  filters: number;
  /** `renderer.stats().renderPasses`, read at call time. */
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
};

/**
 * Resolved dependency APIs.
 */
export type Deps = { flow: FlowApi; world: WorldApi; renderer: RendererApi; assets: AssetsApi };

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

export type {
  AlphaValue,
  BlurValue,
  ColorMatrixValue,
  CoreKind,
  DisplacementValue,
  FilterComponent,
  FilterDefinition,
  FilterSpec,
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
