/**
 * @file The one bundle of the bench: the body font and the spark, the texture every sprite of a
 * scene is drawn with. Tier "boot": it arrives before the scene, so no scene waits for it.
 */
import { defineBundles } from "../../kit";

export const uiAssets = defineBundles({ ui: { tier: "boot" } });
