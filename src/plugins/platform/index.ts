/**
 * Platform plugin — Standard tier.
 *
 * The phone as a provider: pause and resume, the Back chain, haptic ticks and keep-awake.
 * Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { flowPlugin } from "../flow";
import { inputPlugin } from "../input";
import { lifecyclePlugin } from "../lifecycle";
import { createPlatformApi } from "./api";
import { createHandlers } from "./handlers";
import { startPlatform, stopPlatform } from "./lifecycle";
import { createPlatformState } from "./state";
import type { Config } from "./types";

const config: Config = { provider: undefined, keepAwake: false };

/**
 * Platform plugin: `app.platform`, the handler of the effect kind `haptic`, and the provider's
 * pause, resume and Back press. Inert without a provider.
 *
 * @example
 * ```ts
 * // A game in the native shell composes it last and hands it the bridge it built.
 * createApp({
 *   plugins: [...screen, effectsPlugin, audioPlugin, platformPlugin, ...features],
 *   pluginConfigs: { platform: { provider: fromSystem(system), keepAwake: true } }
 * });
 * ```
 */
export const platformPlugin = /*#__PURE__*/ createPlugin("platform", {
  depends: [lifecyclePlugin, flowPlugin, inputPlugin],
  config,
  createState: createPlatformState,
  api: createPlatformApi,
  hooks: createHandlers,
  onStart: startPlatform,
  // @no-resource-check — onStop removes the provider subscriptions and releases keep-awake.
  onStop: ({ state }) => stopPlatform(state)
});
