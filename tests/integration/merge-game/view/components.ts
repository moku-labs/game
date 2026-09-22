/**
 * @file The components this game adds to the world. Both are declared once and listed in the
 * feature description, so the world knows their storage before the first frame.
 */
import { component, tag } from "@moku-labs/game";

/**
 * The model row of an item, as the world carries it: what the projection wrote and what a game
 * system reads. `cell` is the address the item stands on, so a system needs no model lookup.
 */
export const Item = component("Item", { chain: "", level: 1, cell: "" });

/**
 * A legal target of the item in the hand. Written by `highlightLegal` while a drag runs, and
 * taken off again as soon as it is not legal any more.
 */
export const Highlighted = tag("Highlighted");
