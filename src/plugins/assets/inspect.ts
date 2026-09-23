/**
 * @file assets plugin — the assets source of the `/inspect` door: what the loaded bundles cost.
 * Production-safe: it only reads.
 */
import { defineSource } from "../flow/doors/define";
import type { HeadlessApp } from "../flow/headless";
import type { Api } from "./types";

/**
 * The texture memory in use, the budget and one entry per loaded bundle, sorted by name. Read
 * every frame: a bundle loads asynchronously, without a model commit.
 *
 * @example
 * ```ts
 * // The editor's memory bar after the board scene loaded.
 * read(app, sources.assets);
 * // { textureMb: 3.5, budgetMb: 192, bundles: [{ name: "board", tier: "scene", mb: 3.5, lastUsed: 12 }] }
 * ```
 */
export const assetsSource = defineSource({
  id: "game.assets",
  title: "Assets",
  input: {},
  changes: "frame",
  read: (app: HeadlessApp & { readonly assets: Api }) => app.assets.usage()
});
