/**
 * @file The bundle of episode 1: it loads when the story is entered and leaves at the second rest
 * after no scene names it any more. The items are mipmapped, so they shrink smoothly.
 */
import { defineBundles } from "@core/kit";

export const ep01Assets = defineBundles({
  ep01: { tier: "feature", release: "leave", mipmaps: ["items/**"] }
});
