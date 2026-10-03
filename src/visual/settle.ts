/**
 * @file visual — settle: run frames of 60 fps, each followed by one task so a load and a promise
 * chain progress, until the graph rests at a gate or stops, then one frame more so the ui of a
 * screen the gate opened is built. The mode stays `live`, so popups mount and motions play while
 * it runs.
 */
import type { SettleApp } from "./types";

/** The length of one frame at 60 fps. */
const FRAME_MS = 1000 / 60;

/** Where a settle runs, for the message: the test and the step. */
type Place = { test: string; where: string };

/**
 * Yields the task queue once: a timer of 0 ms.
 *
 * @returns A promise that settles in the next task.
 */
function nextTask(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

/**
 * Runs frames by hand, each followed by one task.
 *
 * @param app - The started app.
 * @param count - How many frames.
 */
export async function frames(app: SettleApp, count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    app.time.step(FRAME_MS);
    await nextTask();
  }
}

/**
 * Runs frames until the graph rests at a gate or stops: at least one, at most `limit`. One more
 * frame follows, because a screen the gate opened builds its ui in the frame after it.
 *
 * @param app - The started app.
 * @param limit - The most frames to run, `settleFrames` of the run.
 * @param place - The test and the step, for the message.
 * @throws {Error} When the graph neither rests at a gate nor stops within `limit` frames.
 */
export async function settle(app: SettleApp, limit: number, place: Place): Promise<void> {
  for (let frame = 0; frame < limit; frame += 1) {
    await frames(app, 1);

    const state = app.flow.state();

    if (state.pending.gate !== undefined || !state.running) {
      await frames(app, 1);

      return;
    }
  }

  throw new Error(
    `[game] Visual test "${place.test}", ${place.where} did not settle in ${limit} frames.\n  The graph stands at "${app.flow.state().path}"; add a step that answers what it waits for.`
  );
}
