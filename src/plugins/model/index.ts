/**
 * Very Complex tier — session and save document, transactions, rest-point rollback, rng streams.
 * Emits `model:committed`.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { teardown } from "../../teardown";
import { registerModelTeardown } from "./lifecycle";
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
 * const transaction = ctx.require(modelPlugin).store.begin();
 * ```
 */
export const modelPlugin = /*#__PURE__*/ createPlugin("model", {
  config,
  events: register => register.map<Events>({ "model:committed": "Committed state changed" }),
  createState: createModelState,
  api: ctx => ({ store: createStoreApi(ctx, { createRngView }), rng: createRngApi(ctx) }),
  onStart: registerModelTeardown,
  // @no-resource-check — onStop flushes the player provider.
  onStop: ({ global }) => teardown.run(global, "model")
});
