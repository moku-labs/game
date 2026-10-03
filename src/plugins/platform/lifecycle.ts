/**
 * @file platform plugin — lifecycle: the subscriptions to the provider, the haptic handler and
 * keep-awake on start, and the teardown that removes exactly what was opened.
 */
import { flowPlugin } from "../flow";
import { lifecyclePlugin } from "../lifecycle";
import { runBack } from "./api";
import { kindOf, playHaptic } from "./haptic";
import { safely, setAwake } from "./provider";
import type { KernelSlice, ProviderMethod, State } from "./types";

/** The pause reason the provider's pause pushes. `renderer` pushes the same one; lifecycle dedupes. */
const BACKGROUND = "background";

/**
 * Opens one provider subscription and keeps its remover, guarded, for the stop. A subscription
 * that throws is logged and leaves nothing to remove.
 *
 * @param ctx - Kernel context of the platform plugin.
 * @param method - The provider method, named in the log.
 * @param open - Makes the subscription and returns its remover.
 */
function subscribe(ctx: KernelSlice, method: ProviderMethod, open: () => () => void): void {
  const remove = safely(ctx.log, method, open);

  if (remove !== undefined) ctx.state.offs.push(() => safely(ctx.log, method, remove));
}

/**
 * Starts the plugin in `onStart`. With a provider: the pause and the resume become the
 * `"background"` reason of `lifecycle`, the Back press runs the Back chain, the `haptic` effect
 * reaches the provider (never in a fast walk), and with `keepAwake` the screen stays on while the
 * game is not paused. Without a provider nothing happens, so a `haptic` effect resolves at once.
 *
 * @param ctx - Kernel context of the platform plugin.
 */
export function startPlatform(ctx: KernelSlice): void {
  const provider = ctx.config.provider;

  if (provider === undefined) return;

  const lifecycle = ctx.require(lifecyclePlugin);
  const fx = ctx.require(flowPlugin).fx;

  subscribe(ctx, "onPause", () => provider.onPause(() => lifecycle.push(BACKGROUND)));
  subscribe(ctx, "onResume", () => provider.onResume(() => lifecycle.pop(BACKGROUND)));
  subscribe(ctx, "onBack", () => provider.onBack(() => runBack(ctx) !== "none"));

  ctx.state.offs.push(
    fx.handle("haptic", descriptor => playHaptic(ctx, provider, kindOf(descriptor)), {
      runInFast: false
    }),
    () => {
      if (ctx.state.awake) setAwake(ctx, provider, false);
    }
  );

  if (ctx.config.keepAwake && !lifecycle.isPaused()) setAwake(ctx, provider, true);
}

/**
 * Frees everything `onStart` opened, in order: the three provider subscriptions, the haptic
 * handler, then keep-awake. Each remover is guarded, so one that throws is logged and the rest
 * still run.
 *
 * @param state - The plugin state, all a teardown context needs.
 */
export function stopPlatform(state: State): void {
  for (const off of state.offs.splice(0)) off();
}
