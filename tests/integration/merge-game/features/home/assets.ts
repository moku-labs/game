/**
 * @file The bundle of the home screen: the sawmill yard in the middle of it. Tier "core" means it
 * starts loading at the start and is never unloaded, so Home is ready when the splash leaves.
 */
import { defineBundles } from "../../kit";

export const homeAssets = defineBundles({ home: { tier: "core" } });
