/**
 * Very Complex tier — the screen as data: a small ECS and the projection from the model to
 * entities. Emits `world:reconciled` (dev only).
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createPlugin } from "../../config";
import { flowPlugin } from "../flow";
import { modelPlugin } from "../model";
import { timePlugin } from "../time";
import { createWorldApi } from "./api";
import { createHandlers } from "./handlers";
import { clearWorld, connectWorld } from "./lifecycle";
import { createWorldState } from "./state";
import type { Config, Events } from "./types";

const config: Config = { settleMs: 350, reconciledEvent: false };

/**
 * World plugin: `app.world.ecs.query(...)`, `app.world.projection.mount(...)`.
 *
 * @example
 * ```ts
 * // A test drives the screen without a browser: mount, commit, step frames.
 * const app = createApp({ plugins: [worldPlugin, boardFeature] });
 *
 * app.world.projection.setLayers([{ name: "items", sort: "y" }]);
 * app.world.projection.mount(["board.items"], { kind: "plugin", name: "test" });
 * app.world.projection.entityOf("board.items", "i7"); // 1048576
 * ```
 */
export const worldPlugin = /*#__PURE__*/ createPlugin("world", {
  depends: [timePlugin, modelPlugin, flowPlugin],
  config,
  events: (register: RegisterFunction) =>
    register.map<Events>({ "world:reconciled": "A reconcile finished (dev only)" }),
  createState: createWorldState,
  api: createWorldApi,
  hooks: createHandlers,
  onStart: connectWorld,
  // @no-resource-check — onStop removes the frame callbacks and clears the world.
  onStop: ({ state }) => clearWorld(state)
});
