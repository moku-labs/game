/**
 * @file Episode 1 as a sub-feature: its story, its bundle options, its art in kind sub-folders,
 * a sound and its strings. The strings are lazy: they load and unload with the bundle `ep01`.
 */
import { defineFeature } from "@core/kit";
import { ep01Assets } from "./assets";
import { ep01Flow } from "./flow/story";

export { ep01Flow } from "./flow/story";

export const ep01Feature = defineFeature("ep01", {
  flows: [ep01Flow],
  assets: ep01Assets,
  strings: {
    en: () => import("@generated/strings.ep01.en"),
    ru: () => import("@generated/strings.ep01.ru")
  }
});
