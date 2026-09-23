/**
 * @file model plugin — the model source of the `/inspect` door: the committed player and
 * session. Production-safe: it only reads.
 */
import { defineSource } from "../flow/doors/define";
import type { HeadlessApp } from "../flow/headless";
import type { Api } from "./types";

/**
 * The committed player, session and rng trees, the same frozen object until the next commit.
 *
 * @example
 * ```ts
 * // An editor panel shows the coins after a delivery.
 * read(app, sources.model).player; // { coins: 140, orders: [] }
 * ```
 */
export const modelSource = defineSource({
  id: "game.model",
  title: "Model",
  input: {},
  changes: "commit",
  read: (app: HeadlessApp & { readonly model: Api }) => app.model.store.snapshot()
});
