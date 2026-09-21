/**
 * Very Complex tier — deterministic business-logic graph: runner, gate, inbox, effects gateway, features.
 * Emits `flow:edge`, `flow:rest`, `flow:error`.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { clockPlugin } from "../clock";
import { lifecyclePlugin } from "../lifecycle";
import { modelPlugin } from "../model";
import { timePlugin } from "../time";
import { createFlowApi } from "./api";
import { createHandlers } from "./handlers";
import { connectFlow } from "./lifecycle";
import { stopRunner } from "./runner/loop";
import { createFlowState } from "./state";
import type { Config, Events } from "./types";

const config: Config = {
  mainFlow: undefined,
  safeNode: undefined,
  retries: 1,
  settleTimeoutMs: 2000,
  journalLimit: 500
};

/**
 * Flow plugin: `app.flow.run()`, `app.flow.gate.answer(...)`, `app.flow.fx.handle(...)`.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { flow: { mainFlow } }, onStart: startGraph });
 * ```
 */
export const flowPlugin = /*#__PURE__*/ createPlugin("flow", {
  // lifecyclePlugin: no API is required; the edge types the `lifecycle:changed` hook (spec/07 §5).
  depends: [timePlugin, lifecyclePlugin, modelPlugin, clockPlugin],
  config,
  events: register =>
    register.map<Events>({
      "flow:edge": "An edge was taken and its state committed",
      "flow:rest": "The graph reached a rest node",
      "flow:error": "A node failed and the graph rolled back"
    }),
  createState: createFlowState,
  api: createFlowApi,
  hooks: createHandlers,
  onInit: connectFlow,
  // @no-resource-check — onStop aborts the running node and awaits settle.
  onStop: ({ config, state }) => stopRunner({ config, state })
});
