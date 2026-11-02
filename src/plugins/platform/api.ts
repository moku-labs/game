/**
 * @file platform plugin — API factory, the Back chain and the exit. One press runs three steps and
 * the first that takes it wins: the Escape button of the top popup, the intent `back` of the
 * resting node, the provider leaving the app. A guide that narrows the open gate takes it first.
 * `exit()` is that last step alone.
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
 * and a real press end the same way. A guide that narrows the open gate owns the screen and takes
 * Back before step 1: the press is offered as the intent `back`, which only a guide that allows
 * `back` takes, and counts as taken either way. It never presses Escape, so an `escape` button on
 * a guided screen never turns Back into the guide's `blocked`, and it never leaves the app.
 * Otherwise Escape is what ui answers with the `escape` button of its top root; it also ends the
 * editing of a text field. While the graph moves between nodes the gate is closed: it holds the
 * answer for the next gate (one frame, or `flow.holdMs`), so the press counts as taken and never
 * leaves the app in the middle of a step.
 *
 * @param ctx - Kernel context of the platform plugin.
 * @returns What took the press, `"none"` without a provider.
 */
export function runBack(ctx: KernelSlice): BackResult {
  if (ctx.config.provider === undefined) return "none";

  const gate = ctx.require(flowPlugin).gate;
  const before = gate.state();
  const guideOwnsScreen = before.open && before.narrowed;

  if (guideOwnsScreen) {
    gate.answer({ intent: BACK_INTENT });

    return "intent";
  }

  if (ctx.require(inputPlugin).pressKey("Escape")) return "popup";
  if (gate.answer({ intent: BACK_INTENT }) || !before.open) return "intent";

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
