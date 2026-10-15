/**
 * @file The episodes as a parent feature: its own flow, art and strings, and three sub-features,
 * each in a folder of its own. `episodes-kit` holds what the episodes share (the node factory and
 * the ward scene), `ep01` and `ep02` are the episodes. The door imports every sub-feature from
 * `./<folder>` and lists it in `features`, so the shell composes them after this feature.
 */
import { defineFeature } from "@core/kit";
import { ep01Feature } from "./ep01";
import { ep02Feature } from "./ep02";
import { episodesKitFeature } from "./episodes-kit";
import { episodesFlow } from "./flow/episodes";
import { pickerScreen } from "./views/picker";
import { pickerScene } from "./views/scene";

export { episodesFlow } from "./flow/episodes";

export const episodesFeature = defineFeature("episodes", {
  features: [episodesKitFeature, ep01Feature, ep02Feature],
  flows: [episodesFlow],
  scenes: [pickerScene],
  projections: [pickerScreen]
});
