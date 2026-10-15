/**
 * @file renderer/monitor — the display's frame period guessed from the frame source's ticks (D6), for the budget of an
 * agent build's frames while `time` does not know the display yet: the median of the last nine tick intervals of 50 ms
 * or less, snapped to a display rate by `time`'s own rule. A frame that skipped ticks under the cap spans them all, so
 * its interval is its gap over the ticks it covers. Indexed stores into typed arrays allocated once: no allocation.
 */
import { DISPLAY_RATES, displayIndexOf, TICK_IGNORE_MS } from "../../time/rate-rules";
import type { FrameMeasure } from "../../time/types";
import type { TickEstimate } from "./types";
import { cell } from "./units";

/** Tick intervals the median is taken over. */
export const TICK_SAMPLES = 9;

/**
 * Creates the estimate: no interval yet, no period.
 *
 * @returns The estimate.
 */
export function createTickEstimate(): TickEstimate {
  return {
    samples: new Float32Array(TICK_SAMPLES),
    sorted: new Float32Array(TICK_SAMPLES),
    size: 0,
    next: 0,
    periodMs: Float64Array.of(Number.NaN)
  };
}

/**
 * Forgets every interval: the next frames start a new estimate.
 *
 * @param ticks - The estimate.
 */
export function resetTicks(ticks: TickEstimate): void {
  ticks.size = 0;
  ticks.next = 0;
  ticks.periodMs[0] = Number.NaN;
}

/**
 * Adds the tick interval of a frame and snaps the median of the last nine to a display rate: `periodMs[0]` becomes
 * that rate's period, or NaN while the median matches none. A stepped frame, a frame without a gap and a gap over
 * 50 ms (a hitch, a page away) add nothing. The median is taken by an insertion sort into `sorted`: nine numbers.
 *
 * @param ticks - The estimate.
 * @param measure - What `time` measured of the frame; read, never kept.
 */
export function noteTicks(ticks: TickEstimate, measure: Readonly<FrameMeasure>): void {
  if (measure.stepped || Number.isNaN(measure.gapMs) || measure.gapMs > TICK_IGNORE_MS) return;

  const { samples, sorted } = ticks;

  samples[ticks.next] = measure.gapMs / (measure.skipped + 1);
  ticks.next = (ticks.next + 1) % TICK_SAMPLES;
  ticks.size = Math.min(ticks.size + 1, TICK_SAMPLES);

  // Insertion-sort the held samples into scratch to take the median.
  for (let index = 0; index < ticks.size; index += 1) {
    const value = cell(samples, index);
    let place = index;

    while (place > 0 && cell(sorted, place - 1) > value) {
      sorted[place] = cell(sorted, place - 1);
      place -= 1;
    }

    sorted[place] = value;
  }

  const rate = displayIndexOf(cell(sorted, ticks.size >> 1));
  // Indexed directly, never through `cell`: a plain array beside the typed arrays would turn `cell`'s shared feedback
  // generic, and every typed-array read it inlines on the per-frame path would box its double.
  const hz = rate === -1 ? undefined : DISPLAY_RATES[rate];

  ticks.periodMs[0] = hz === undefined ? Number.NaN : 1000 / hz;
}
