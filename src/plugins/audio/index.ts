/**
 * Audio plugin — Standard tier.
 *
 * WebAudio buses, sounds as fx descriptors, music from the scene, volumes from the player.
 * Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { assetsPlugin } from "../assets";
import { flowPlugin } from "../flow";
import { lifecyclePlugin } from "../lifecycle";
import { modelPlugin } from "../model";
import { scenesPlugin } from "../scenes";
import { timePlugin } from "../time";
import { createAudioApi } from "./api";
import { createHandlers } from "./handlers";
import { startAudio, stopAudio } from "./lifecycle";
import { createAudioState } from "./state";
import type { Config } from "./types";

const config: Config = {
  buses: { master: 1, music: 0.6, sfx: 1 },
  musicFadeMs: 600,
  volumes: undefined,
  context: undefined,
  journal: 0
};

/**
 * Audio plugin: `app.audio`, the handlers of the effect kinds `sfx` and `music`, and the three
 * buses a game drives from its player state.
 *
 * @example
 * ```ts
 * // A game composes it next to the screen set and points it at the player's settings.
 * createApp({
 *   plugins: [...screen, audioPlugin, settingsFeature],
 *   pluginConfigs: { audio: { volumes: player => player.settings.audio } }
 * });
 * ```
 */
export const audioPlugin = /*#__PURE__*/ createPlugin("audio", {
  depends: [timePlugin, lifecyclePlugin, modelPlugin, flowPlugin, assetsPlugin, scenesPlugin],
  config,
  createState: createAudioState,
  api: createAudioApi,
  hooks: createHandlers,
  onStart: startAudio,
  // @no-resource-check — onStop closes the AudioContext and removes the window listeners.
  onStop: ({ state }) => stopAudio(state)
});
