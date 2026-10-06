/**
 * @file Visual test: Home at rest, the counter at 3, the note with the spark inside it and the
 * glowing info button.
 */
import { defineVisualTest } from "@moku-labs/game/visual";
import { atHome } from "./fixture";

export const home = defineVisualTest("home", {
  start: atHome,
  steps: [{ checkpoint: "rest" }]
});
