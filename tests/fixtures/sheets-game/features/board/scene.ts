/**
 * @file The board scene: the same three layers as the ward, the HUD above every overlay.
 */
import { defineScene } from "../../kit";
import { hudBar } from "../hud/view";
import { settingsSheet } from "../settings/view";
import { shopSheet } from "../shop/view";
import { boardRoot } from "./view";

export const boardScene = defineScene("board", {
  bundle: "ui",
  layers: { scene: {}, ui: { sort: "order" }, hud: { above: "overlays" } },
  projections: [boardRoot, hudBar, shopSheet, settingsSheet]
});
