/**
 * Very Complex tier — session and save document, transactions, rest-point rollback, rng streams.
 * Emits `model:committed`.
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createPlugin } from "../../config";
import { createRngApi, createRngView } from "./rng/api";
import { createModelState } from "./state";
import { createStoreApi } from "./store/api";
import type { Config, Events } from "./types";

const config: Config = {
  playerProvider: undefined,
  initialPlayer: {},
  initialSession: {},
  seed: "from-save",
  schemaVersion: 1,
  migrations: []
};

/**
 * Model plugin: `app.model.store`, `app.model.rng`.
 *
 * @example
 * ```ts
 * // A game plugin that draws from committed state declares the dependency and reads the snapshot.
 * const hudPlugin = createPlugin("hud", {
 *   depends: [modelPlugin],
 *   hooks: ctx => ({
 *     "model:committed": () => drawCoins(ctx.require(modelPlugin).store.snapshot().player)
 *   })
 * });
 * ```
 */
export const modelPlugin = /*#__PURE__*/ createPlugin("model", {
  config,
  events: (register: RegisterFunction) =>
    register.map<Events>({ "model:committed": "Committed state changed" }),
  createState: createModelState,
  api: ctx => ({ store: createStoreApi(ctx, { createRngView }), rng: createRngApi(ctx) }),
  // @no-resource-check — onStop flushes the player provider.
  onStop: ({ state }) => state.store.provider.flush()
});
