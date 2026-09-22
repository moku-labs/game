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

const config: Config = { tapTargetPt: 44, breakpoints: { tall: 2, wide: 1.5 } };

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
