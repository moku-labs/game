/**
 * @file The components this game adds to the world. Each is declared once and listed in the
 * feature description, so the world knows its storage before the first frame. They carry what a
 * game system reads without a model lookup: the item, the generator and the cell a glow lies on.
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

/**
 * The generator a view draws, and the cell it stands on: the look of the board reads it next to
 * `Item`, so the sawmill lifts, squashes and glows like an item.
 */
export const Generator = component("Generator", { id: "", cell: "" });

/**
 * The cell a glow lies on. `glowCells` finds the glow of a cell through it.
 */
export const Glow = component("Glow", { cell: "" });

/**
 * The marching ring around the selected cell. `marchRing` finds the ring through it and swaps its
 * picture to the next dash phase.
 */
export const SelectionRing = tag("SelectionRing");
