/**
 * @file renderer plugin — the renderer source of the `/inspect` door: the frame counters.
 * Production-safe: it only reads.
 */
import { defineSource } from "../flow/doors/define";
import type { HeadlessApp } from "../flow/headless";
import type { Api } from "./types";

/**
 * The counters of the renderer: frames per second, frame work, GPU textures and their memory,
 * views and pooled display objects, render passes, and in a dev build the draw calls.
 *
 * @example
 * ```ts
 * // The editor's stats panel on the board of Timber Town, in a dev build.
 * read(app, sources.render);
 * // { fps: 60, frameMs: 3.4, textures: 12, textureMb: 41.25, views: 180, pooled: 24, renderPasses: 1, drawCalls: 14 }
 * ```
 */
export const renderSource = defineSource({
  id: "game.render",
  title: "Render stats",
  input: {},
  changes: "frame",
  read: (app: HeadlessApp & { readonly renderer: Api }) => app.renderer.stats()
});
