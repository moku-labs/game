/**
 * @file platform plugin — the guard around every provider call. A provider is the game's own code
 * over native APIs: a call that throws is logged through the common log and the frame goes on.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PlatformProvider, ProviderMethod, State } from "./types";

/**
 * Runs one provider call and logs it when it throws, so a native failure never reaches the frame.
 *
 * @param log - The engine log.
 * @param method - The provider method, named in the log.
 * @param call - The call itself.
 * @returns What the call returned, or `undefined` when it threw.
 */
export function safely<Result>(
  log: Log.LogApi,
  method: ProviderMethod,
  call: () => Result
): Result | undefined {
  try {
    return call();
  } catch (error) {
    log.error(
      "platform: the provider failed",
      { method },
      error instanceof Error ? error : new Error(String(error))
    );

    return undefined;
  }
}

/**
 * Asks the provider to keep the screen on or to let it sleep. `awake` follows only a call that
 * went through, so a refused wake lock leaves the flag where it was.
 *
 * @param ctx - The log and the state of the plugin.
 * @param ctx.log - The engine log.
 * @param ctx.state - The plugin state.
 * @param provider - The provider of the game.
 * @param on - `true` keeps the screen on.
 */
export function setAwake(
  ctx: { readonly log: Log.LogApi; readonly state: State },
  provider: PlatformProvider,
  on: boolean
): void {
  const done = safely(ctx.log, "keepAwake", () => {
    provider.keepAwake(on);

    return true;
  });

  if (done === true) ctx.state.awake = on;
}
