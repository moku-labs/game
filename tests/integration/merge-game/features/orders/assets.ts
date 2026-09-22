/**
 * @file The bundle of the orders feature: the sound a finished order plays. Tier "core" means it
 * is loaded once at the start and never unloaded, like every short sound of the game.
 */
import { defineBundles } from "../../kit";

export const ordersAssets = defineBundles({ orders: { tier: "core" } });
