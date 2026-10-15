/**
 * @file Episode 2 as a sub-feature with no `assets.ts`: one default bundle, `ep02`, released by
 * the budget like any other. Its strings load and unload with that bundle.
 */
import { defineFeature } from "@core/kit";
import { ep02Flow } from "./flow/story";

export { ep02Flow } from "./flow/story";

export const ep02Feature = defineFeature("ep02", {
  flows: [ep02Flow],
  strings: {
    en: () => import("@generated/strings.ep02.en"),
    ru: () => import("@generated/strings.ep02.ru")
  }
});
