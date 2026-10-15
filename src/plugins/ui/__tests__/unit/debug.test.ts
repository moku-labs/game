import { describe, expect, it } from "vitest";
import { countTap } from "../../jsx/debug";

// ---------------------------------------------------------------------------
// Unit test: the DebugTrigger counter — five taps within 3000 ms of wall time,
// the last five kept, emptied on an open
// ---------------------------------------------------------------------------

/**
 * Counts taps at the given wall times and answers what each tap returned.
 *
 * @param taps - The counter's list.
 * @param times - The wall times, in order.
 * @returns One answer per tap.
 */
function tapAt(taps: number[], times: readonly number[]): boolean[] {
  return times.map(at => countTap(taps, at));
}

describe("countTap", () => {
  it("four taps never open", () => {
    expect(tapAt([], [0, 100, 200, 300])).toEqual([false, false, false, false]);
  });

  it("five taps within 3000 ms open, the fifth at exactly first + 3000 included", () => {
    expect(tapAt([], [0, 700, 1400, 2100, 3000])).toEqual([false, false, false, false, true]);
  });

  it("the fifth at first + 3001 does not", () => {
    expect(tapAt([], [0, 700, 1400, 2100, 3001]).at(-1)).toBe(false);
  });

  it("after an open five new taps are needed", () => {
    const taps: number[] = [];

    tapAt(taps, [0, 100, 200, 300, 400]);

    expect(taps).toEqual([]);
    expect(tapAt(taps, [500, 600, 700, 800])).toEqual([false, false, false, false]);
    expect(countTap(taps, 900)).toBe(true);
  });

  it("a slow tap slides the window", () => {
    const taps: number[] = [];

    expect(tapAt(taps, [0, 700, 1400, 2100, 3001])).toEqual([false, false, false, false, false]);
    // The last five are 700…3100 now.
    expect(countTap(taps, 3100)).toBe(true);
  });
});
