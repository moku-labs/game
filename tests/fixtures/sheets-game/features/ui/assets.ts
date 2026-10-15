/**
 * @file The bundle of the interface: the body font of the counters. Tier "boot": it arrives before the first scene.
 * `ui` is a plugin name, so no feature is called `ui`: the ward feature registers this bundle.
 */
import { defineBundles } from "../../kit";

export const uiAssets = defineBundles({ ui: { tier: "boot" } });
