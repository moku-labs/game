/**
 * Ui plugin — Very Complex tier.
 *
 * JSX trees into entities: reconcile by key, one Yoga solve per change, `Box` as the rest pose.
 * Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { animPlugin } from "../anim";
import { flowPlugin } from "../flow";
import { i18nPlugin } from "../i18n";
import { inputPlugin } from "../input";
import { rendererPlugin } from "../renderer";
import { textPlugin } from "../text";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { createUiApi } from "./api";
import { startUi, stopUi } from "./lifecycle";
import { createUiState } from "./state";
import type { Config } from "./types";

const config: Config = {
  tapTargetPt: 44,
  breakpoints: { tall: 2, wide: 1.5 },
  focusRing: {
    stroke: 0x3a_22_12,
    strokeWidth: 4,
    dash: 10,
    offset: 9,
    halo: 0xff_f3_d6,
    haloWidth: 12
  }
};

/**
 * Ui plugin: `app.ui.tree()`, `app.ui.find(...)`, `app.ui.lint()`, the components `Box` and
 * `LocalWrite`, and the helpers `defineComponent`, `defineStyle`, `defineTokens` and `popup`.
 *
 * @example
 * ```ts
 * // A headless test reads the HUD and taps the button the popup opened.
 * const app = createApp({ plugins: [...screen, uiPlugin, hudFeature] });
 *
 * app.ui.tree().type; // "row"
 * app.input.tap(app.ui.find("claim") ?? 0);
 * ```
 */
export const uiPlugin = /*#__PURE__*/ createPlugin("ui", {
  // animPlugin: no API is required; the edge orders the plugins, so the tween driver behind every
  // motion handle is installed before ui plays its first motion.
  depends: [
    timePlugin,
    flowPlugin,
    worldPlugin,
    rendererPlugin,
    inputPlugin,
    animPlugin,
    i18nPlugin,
    textPlugin
  ],
  config,
  createState: createUiState,
  api: createUiApi,
  onStart: startUi,
  // @no-resource-check — onStop frees every Yoga node, removes the handlers and despawns the ui entities.
  onStop: ({ state }) => stopUi(state)
});
