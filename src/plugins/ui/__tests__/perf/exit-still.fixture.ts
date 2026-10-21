/**
 * @file ui plugin — the perf fixture of the exit sweep's question (F42): one leaving element holding three motions,
 * a finished roll, the exit hook's fade still running, and a hot pulse that repeats forever.
 */
import type { MotionHandle } from "../../../world/types";
import type { Element } from "../../jsx/types";
import { still } from "../../layout/motion";

/**
 * A motion handle that answers a fixed `active`.
 *
 * @param active - What it answers.
 * @returns The handle.
 */
function handle(active: boolean): MotionHandle {
  return { finish: () => undefined, cancel: () => undefined, active: () => active };
}

/** Where each call puts its answer, so the call is not dropped as dead code. */
const answers = { last: false };

/**
 * One call of `still` on the leaving element, as the sweep asks it once a frame.
 *
 * @returns The call.
 */
export function stillCall(): () => void {
  const pulse = handle(true);
  const element = {
    handles: [handle(false), handle(true), pulse],
    endless: new Set([pulse])
  } as unknown as Element;

  return () => {
    answers.last = still(element);
  };
}
