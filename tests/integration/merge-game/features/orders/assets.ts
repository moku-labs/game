/**
 * @file The bundle of the orders feature: the paper tag an order card is drawn on (9-slice) and
 * the sound a finished order plays. Tier "core" means it is loaded once at the start and never
 * unloaded, so the order strip is ready with the board.
 */
import { defineBundles } from "../../kit";

export const ordersAssets = defineBundles({ orders: { tier: "core" } });
