/**
 * @file The ward scene: the scene layer, the ui layer of the sheets and the HUD layer above every overlay.
 */
import { defineScene } from "../../kit";
import { casefileSheet } from "../casefile/view";
import { hudBar } from "../hud/view";
import { inspectSheet } from "../inspect/view";
import { settingsSheet } from "../settings/view";
import { shopSheet } from "../shop/view";
import { wardRoot } from "./view";

export const wardScene = defineScene("ward", {
  bundle: "ui",
  layers: { scene: {}, ui: { sort: "order" }, hud: { above: "overlays" } },
  projections: [wardRoot, hudBar, shopSheet, settingsSheet, casefileSheet, inspectSheet]
});
