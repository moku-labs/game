/**
 * @file The bundle of the interface: the body font, the spark and the swing of the popup. Tier
 * "boot" means it arrives before the first scene, because no screen has anything to write without
 * its font. The folder is named after the key the `text` config reads by default, `ui.font-body`.
 * `ui` is a plugin name, so no feature is called `ui`: the Home feature registers this bundle.
 */
import { defineBundles } from "../../kit";

export const uiAssets = defineBundles({ ui: { tier: "boot" } });
