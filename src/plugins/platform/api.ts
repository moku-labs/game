/**
 * @file platform plugin — API factory, the Back chain and the exit. One press runs three steps and
 * the first that takes it wins: the Escape button of the top popup, the intent `back` of the
 * resting node, the provider leaving the app. `exit()` is that last step alone.
 */
import { flowPlugin } from "../flow";
import { inputPlugin } from "../input";
import { safely } from "./provider";
import type { BackResult, KernelSlice, PlatformApi } from "./types";

/** The intent a resting node lists to take the Back press itself. */
const BACK_INTENT = "back";

/**
 * Leaves the app through the provider, guarded like every provider call. Without a provider it
 * does nothing. The last step of the Back chain and `exit()` both go through here.
 *
 * @param ctx - Kernel context of the platform plugin.
 */
function leave(ctx: KernelSlice): void {
  const provider = ctx.config.provider;

  if (provider === undefined) return;

  safely(ctx.log, "exit", () => provider.exit());
}

/**
 * Runs the Back chain once. `back()` and the provider's `onBack` both go through here, so a test
 * and a real press end the same way. Escape is what ui answers with the `escape` button of its
 * top root; it also ends the editing of a text field. While the graph moves between nodes the gate
 * is closed: it holds the answer for one frame, so the press counts as taken and never leaves the
 * app in the middle of a step.
 *
 * @param ctx - Kernel context of the platform plugin.
 * @returns What took the press, `"none"` without a provider.
 */
export function runBack(ctx: KernelSlice): BackResult {
  if (ctx.config.provider === undefined) return "none";
  if (ctx.require(inputPlugin).pressKey("Escape")) return "popup";

  const gate = ctx.require(flowPlugin).gate;

  if (gate.answer({ intent: BACK_INTENT }) || !gate.state().open) return "intent";

  leave(ctx);

  return "exit";
}

/**
 * Creates the platform API: the Back chain and the exit on demand.
 *
 * @param ctx - Kernel context of the platform plugin.
 * @returns The plugin API.
 */
export function createPlatformApi(ctx: KernelSlice): PlatformApi {
  return {
    back: (): BackResult => runBack(ctx),
    exit: (): void => leave(ctx)
  };
}
