/**
 * @file platform plugin — API factory and the Back chain. One press runs three steps and the
 * first that takes it wins: the Escape button of the top popup, the intent `back` of the resting
 * node, the provider leaving the app.
 */
import { flowPlugin } from "../flow";
import { inputPlugin } from "../input";
import { safely } from "./provider";
import type { BackResult, KernelSlice, PlatformApi } from "./types";

/** The intent a resting node lists to take the Back press itself. */
const BACK_INTENT = "back";

/**
 * Runs the Back chain once. `back()` and the provider's `onBack` both go through here, so a test
 * and a real press end the same way. Escape is what ui answers with the `escape` button of its
 * top root; it also ends the editing of a text field.
 *
 * @param ctx - Kernel context of the platform plugin.
 * @returns What took the press, `"none"` without a provider.
 */
export function runBack(ctx: KernelSlice): BackResult {
  const provider = ctx.config.provider;

  if (provider === undefined) return "none";
  if (ctx.require(inputPlugin).pressKey("Escape")) return "popup";
  if (ctx.require(flowPlugin).gate.answer({ intent: BACK_INTENT })) return "intent";

  safely(ctx.log, "exit", () => provider.exit());

  return "exit";
}

/**
 * Creates the platform API: the Back chain on demand.
 *
 * @param ctx - Kernel context of the platform plugin.
 * @returns The plugin API.
 */
export function createPlatformApi(ctx: KernelSlice): PlatformApi {
  return { back: (): BackResult => runBack(ctx) };
}
