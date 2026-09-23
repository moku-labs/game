/**
 * @file The bundle of the splash screen: its full-bleed background. Tier "boot" means it arrives
 * before the first scene, because the splash is the first thing the player sees.
 */
import { defineBundles } from "../../kit";

export const splashAssets = defineBundles({ splash: { tier: "boot" } });
