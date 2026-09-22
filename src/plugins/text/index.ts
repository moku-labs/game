/**
 * Complex tier — words on the screen: a string or a message becomes runs of glyphs and inline
 * icons, measured from the font's advance table and drawn as `BitmapText`. Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { assetsPlugin } from "../assets";
import { flowPlugin } from "../flow";
import { i18nPlugin } from "../i18n";
import { rendererPlugin } from "../renderer";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { createTextApi } from "./api";
import { createHandlers } from "./handlers";
import { startText, stopText } from "./lifecycle";
import { createTextState } from "./state";
import type { Config } from "./types";

const config: Config = {
  fonts: { body: "ui.font-body", digits: "ui.font-digits" },
  missingGlyph: "□"
};

/**
 * Text plugin: `app.text.measure(...)`, the `Text` component and the helpers `label` and
 * `defineTextStyles` a game writes.
 *
 * @example
 * ```ts
 * // A feature brings its styles; a projection puts a label over an item.
 * export const hudStyles = defineTextStyles({
 *   "hud.digits": { font: "ui.font-digits", size: 40, fill: 0xffe082, digits: true }
 * });
 *
 * const app = createApp({ plugins: [...screen, hudFeature] });
 *
 * app.text.styles(); // ["body", "digits", "hud.digits"]
 * ```
 */
export const textPlugin = /*#__PURE__*/ createPlugin("text", {
  depends: [timePlugin, flowPlugin, worldPlugin, rendererPlugin, assetsPlugin, i18nPlugin],
  config,
  createState: createTextState,
  api: createTextApi,
  hooks: createHandlers,
  onStart: startText,
  // @no-resource-check — onStop removes the system, the two world hooks and the display adapter.
  onStop: ({ state }) => stopText(state)
});
