/**
 * @file The handler of the `exit` effect: Leave on the Leave popup asks the app to close. A node
 * has no platform in its context, so the feature that asks owns the one line that leaves. The app
 * passes the provider's `exit` in `pluginConfigs.leaveExit`; the web page has no provider and
 * passes none, so Leave lands back on Home there.
 */
import { createPlugin, flowPlugin } from "@moku-labs/game";

/** What the app passes: how the app is left. */
type LeaveExitConfig = {
  /** Leaves the app: the provider's `exit()` in the native shell. Does nothing by default. */
  exit: () => void;
};

/** Without a provider there is nothing to leave: the effect does nothing. */
const defaultConfig: LeaveExitConfig = { exit: () => undefined };

/**
 * Leaves the app when the Leave node asks for it. Registered in `onStart`, so the handler exists
 * before the graph runs. Not in a fast walk: restoring a save never closes the app.
 */
export const leaveExitPlugin = createPlugin("leaveExit", {
  depends: [flowPlugin],
  config: defaultConfig,
  onStart: ctx => {
    ctx.require(flowPlugin).fx.handle("exit", () => {
      ctx.config.exit();
    });
  }
});
