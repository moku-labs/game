/**
 * Complex tier — the one tween core of the engine and the choreographies over it. Installs the
 * `TweenDriver` of `world`, so a projection hook, a timeline step and a UI `motion` prop all make
 * tracks in the same table. Emits `anim:mark`, `anim:finished`.
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createPlugin } from "../../config";
import { flowPlugin } from "../flow";
import { rendererPlugin } from "../renderer";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { createAnimApi } from "./api";
import { initAnim, startAnim, stopAnim } from "./lifecycle";
import { createAnimState } from "./state";
import type { Config, Events } from "./types";

const config: Config = { maxTracks: 2000 };

/**
 * Anim plugin: `app.anim.play(animation, slots)`, `app.anim.finishAll()`.
 *
 * @example
 * ```ts
 * // Animation is text: a module next to the feature, played by a node or by a test.
 * const coinsFly = defineAnimation("hud.coinsFly", {
 *   slots: { from: type<Target>(), to: type<Target>() },
 *   build: ({ from, to }, { at }) =>
 *     sequence(
 *       tween(from, Transform, { x: at(to).x, y: at(to).y }, { ms: 600, ease: "inCubic" }),
 *       mark("landed")
 *     )
 * });
 *
 * const app = createApp({ plugins: [...screen, animPlugin, hudFeature] });
 *
 * app.anim.play(coinsFly, { from: purse, to: counter }).marks(); // []: the first frame is next
 * ```
 */
export const animPlugin = /*#__PURE__*/ createPlugin("anim", {
  // rendererPlugin: no API is required; the edge orders the plugins, so the `Sprite` a `frames`
  // step writes and the `Transform` and `rootPoseOf` `at` reads belong to a plugin already there.
  depends: [timePlugin, flowPlugin, worldPlugin, rendererPlugin],
  config,
  events: (register: RegisterFunction) =>
    register.map<Events>({
      "anim:mark": "A mark of a timeline was reached",
      "anim:finished": "A timeline ended"
    }),
  createState: createAnimState,
  api: createAnimApi,
  onInit: initAnim,
  onStart: startAnim,
  // @no-resource-check — onStop removes the driver, the frame callback and the play handler.
  onStop: ({ state }) => stopAnim(state)
});
