/**
 * @file flow/runner — teardown.
 */
import type { FlowCtx } from "../types";
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
 * const deadline = startDeadline(ctx.config.settleTimeoutMs);
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
     *
     * @example
     * ```ts
     * deadline.cancel();
     * ```
     */
    cancel: (): void => {
      globalThis.clearTimeout(watch.handle);
    }
  };
}

/**
 * Waits for the aborted loop to settle, at most `settleTimeoutMs` of real time. Without a running
 * frame loop the game is headless and the loop is simply awaited.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param running - The promise of `run()`.
 * @example
 * ```ts
 * await settle(ctx, running);
 * ```
 */
async function settle(ctx: FlowCtx, running: Promise<void>): Promise<void> {
  const quiet = running.then(noop, noop);

  if (!ctx.deps.time.isRunning()) {
    await quiet;
    return;
  }

  const deadline = startDeadline(ctx.config.settleTimeoutMs);

  try {
    await Promise.race([quiet, deadline.reached]);
  } finally {
    deadline.cancel();
  }
}

/**
 * Stops the runner: the active node is aborted with reason `"stop"`, the loop is given
 * `settleTimeoutMs` to settle, and a background flush that is still running is awaited. The loop
 * itself discards the open transaction and shuts the gate while it leaves the aborted node.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns A promise that resolves when the graph stands still.
 * @example
 * ```ts
 * teardown.register(ctx.global, "flow", () => stopRunner(flowCtx));
 * ```
 */
export async function stopRunner(ctx: FlowCtx): Promise<void> {
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

  if (running !== undefined) await settle(ctx, running);

  state.running = undefined;
  state.abort = undefined;

  const flushing = state.flushing;

  if (flushing !== undefined) {
    state.flushing = undefined;
    await flushing;
  }
}
