/**
 * @file The bundle of the interface: the two fonts and the click of every button. Tier "boot"
 * means it arrives before the first scene, because a HUD without its font has nothing to draw.
 * The folder is named after the keys the engine expects — `ui.font-body`, `ui.font-digits` and
 * `ui.click` are the defaults of the `text` and `audio` configs.
 */
import { defineBundles } from "../../kit";

export const uiAssets = defineBundles({ ui: { tier: "boot" } });
