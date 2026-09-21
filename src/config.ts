/**
 * @file Framework configuration — Config and Events types, core plugin registration.
 */
import { envPlugin, logPlugin } from "@moku-labs/common/browser";
import { createCoreConfig } from "@moku-labs/core";

/**
 * Global configuration of a game.
 *
 * @example
 * ```ts
 * createApp({ config: { orientation: "portrait", referenceSide: 1080 } });
 * ```
 */
export type Config = {
  /** Screen orientation the game is designed for. */
  orientation: "portrait" | "landscape";
  /** Short side of the reference resolution in pixels. */
  referenceSide: number;
};

/**
 * Global events. Empty: every event belongs to a plugin.
 *
 * @example
 * ```ts
 * type AppEvents = Events;
 * ```
 */
export type Events = Record<never, never>;

/**
 * Public API type of a plugin instance, read from its phantom carrier.
 * Mirrors the kernel's non-exported `ExtractPluginApi`.
 *
 * @example
 * ```ts
 * type TimeApi = ApiOf<typeof timePlugin>;
 * ```
 */
export type ApiOf<Plugin> = Plugin extends { readonly _phantom: { readonly api: infer PluginApi } }
  ? PluginApi
  : never;

/**
 * Structural type of `ctx.require`, for domain factories that resolve their own dependencies.
 * The bound repeats the kernel's plugin shape so the kernel's generic `require` is assignable to it.
 *
 * @example
 * ```ts
 * type LifecycleCtx = PluginCtx<Config, State, Events> & { readonly require: Require };
 * ```
 */
export type Require = <
  Plugin extends {
    readonly name: string;
    readonly spec: unknown;
    readonly _phantom: {
      readonly config: unknown;
      readonly state: unknown;
      readonly api: unknown;
      readonly events: Record<string, unknown>;
    };
  }
>(
  plugin: Plugin
) => ApiOf<Plugin>;

const config: Config = { orientation: "portrait", referenceSide: 1080 };

/**
 * Core config of the engine: `log` and `env` on every plugin context.
 *
 * @example
 * ```ts
 * const framework = createCore(coreConfig, { plugins: [] });
 * ```
 */
export const coreConfig = createCoreConfig<Config, Events, [typeof logPlugin, typeof envPlugin]>(
  "game",
  { config, plugins: [logPlugin, envPlugin] }
);

/**
 * Creates an engine or game plugin bound to the engine's Config and Events.
 *
 * @example
 * ```ts
 * export const timePlugin = createPlugin("time", { api: createTimeApi });
 * ```
 */
export const createPlugin = coreConfig.createPlugin;

/**
 * Creates the framework from the core config. Used by `src/index.ts` only.
 *
 * @example
 * ```ts
 * const framework = createCore(coreConfig, { plugins: [timePlugin] });
 * ```
 */
export const createCore = coreConfig.createCore;
