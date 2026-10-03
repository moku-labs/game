/**
 * @file The backend the dev page draws with, picked with `?renderer=webgl`. WebGPU when the query
 * names none: the WebGL leg of the visual tests opens the page with the flag, and so can an e2e
 * run that checks a filter on WebGL.
 */
import type { Renderer } from "@moku-labs/game";

/**
 * The renderer preference the page passes, read from its query.
 *
 * @param search - `location.search` of the page.
 * @returns `"webgl"` when the query asks for it, `"webgpu"` otherwise.
 * @example
 * ```ts
 * rendererFor("?renderer=webgl&player=full"); // "webgl"
 * ```
 */
export function rendererFor(search: string): Renderer.Config["preference"] {
  return new URLSearchParams(search).get("renderer") === "webgl" ? "webgl" : "webgpu";
}
