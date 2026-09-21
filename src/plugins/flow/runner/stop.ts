/**
 * @file flow/runner — stopping the runner, the `onStop` of the plugin.
 */
import type { FlowCtx } from "../types";

/**
 * What a stop needs: the plugin's own config and state, exactly what `onStop` receives.
 */
export type StopCtx = Pick<FlowCtx, "config" | "state">;

import { noop } from "./loop-types";
import { abortReason } from "./node";

/**
 * Waits `timeoutMs` of real time. The deadline is not counted in frames: a paused clock runs no
 * frame and a time scale of 0 gives a delta of 0, and a stop must end in both cases.
 *
 * @param timeoutMs - How long the deadline waits, in real milliseconds.
 * @returns The deadline and the way to cancel it.
 * @example
 * ```ts
 * const deadline = startDeadline(2000);
 * deadline.cancel(); // the loop settled first: deadline.reached never resolves
 * ```
 */
function startDeadline(timeoutMs: number): { reached: Promise<void>; cancel(): void } {
  const watch: { handle: ReturnType<typeof globalThis.setTimeout> | undefined } = {
    handle: undefined
  };
  const reached = new Promise<void>(resolve => {
    watch.handle = globalThis.setTimeout(resolve, timeoutMs);
  });

  return {
    reached,
    /**
     * Drops the deadline when the loop settled first.
     */
    cancel: (): void => {
      globalThis.clearTimeout(watch.handle);
    }
  };
}

/**
 * Waits for the aborted loop to settle, at most `settleTimeoutMs` of real time, with or without a
 * frame loop.
 *
 * @param ctx - Config and state of the flow plugin.
 * @param running - The promise of `run()`.
 * @returns `true` when the loop settled, `false` when the deadline won and the loop still runs.
 */
async function settle(ctx: StopCtx, running: Promise<void>): Promise<boolean> {
  const quiet = running.then(noop, noop);
  const deadline = startDeadline(ctx.config.settleTimeoutMs);

  try {
    return await Promise.race([quiet.then(() => true), deadline.reached.then(() => false)]);
  } finally {
    deadline.cancel();
  }
}

/**
 * Stops the runner: the active node is aborted with reason `"stop"`, the loop is given
 * `settleTimeoutMs` to settle, and a background flush that is still running is awaited. The loop
 * itself discards the open transaction and shuts the gate while it leaves the aborted node.
 *
 * @param ctx - Config and state of the flow plugin.
 * @returns A promise that resolves when the graph stands still.
 */
export async function stopRunner(ctx: StopCtx): Promise<void> {
  const state = ctx.state.runner;
  const running = state.running;
  const active = state.abort;

  active?.abort("stop");
  ctx.state.gate.wake?.();

  const alreadyAbortedForStop = active !== undefined && abortReason(active.signal) === "stop";

  // A stop must be on record even when there was no active node to abort.
  if (!alreadyAbortedForStop) {
    const stop = new AbortController();

    stop.abort("stop");
    state.abort = stop;
  }

  const settled = running === undefined || (await settle(ctx, running));

  // A loop that outlived the deadline must still see the stop when it wakes up.
  state.running = undefined;
  if (settled) state.abort = undefined;

  const flushing = state.flushing;

  if (flushing !== undefined) {
    state.flushing = undefined;
    await flushing;
  }
}
