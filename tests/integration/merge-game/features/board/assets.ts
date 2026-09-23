/**
 * @file The bundles of the board feature. The folder `assets/` next to this file is the bundle
 * "board": the four wood items, the sawmill, the grass cell and the tray (both 9-slice), the
 * meadow background and the music. The scanner reads this declaration for the tier and writes
 * every file of that folder into the manifest. Tier "scene" means the bundle arrives with the
 * scene that names it.
 */
import { defineBundles } from "../../kit";

export const boardAssets = defineBundles({ board: { tier: "scene" } });
