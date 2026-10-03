/**
 * @file Visual test: the Rename popup (V5 text input). The gear of Home opens Settings, its Name
 * tab and the Rename plank stack the popup on top; "Alex" goes into the field through the `fill`
 * command and the counter under it reads 4/16. Enter saves the name, and the Name tab shows it.
 */
import { defineVisualTest } from "@moku-labs/game/testing";
import { atHome } from "./fixture";

export const renamePopup = defineVisualTest("rename-popup", {
  start: atHome,
  steps: [
    { tap: { key: "homeSettings" } },
    { tap: { key: "tabProfile" } },
    { tap: { key: "profileRename" } },
    { fill: { key: "nameField", value: "Alex" } },
    { checkpoint: "typed" },
    { key: { key: "Enter" } },
    { checkpoint: "saved" }
  ]
});
