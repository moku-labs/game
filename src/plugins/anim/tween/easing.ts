/**
 * @file anim/tween — the named easing curves now live in `world/projection/easing` (world owns
 * `Ease`, and renderer, scenes, anim and ui all depend on world). This module keeps the old path.
 */
export { applyEase, EASE_NAMES, easeCell } from "../../world/projection/easing";
