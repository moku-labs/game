import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startWarm, untilApplying, untilWarm } from "../warm-app";

// F200: a warm window opened while its record is building. Each call is one cycle on the tabs sheet
// of 165 elements, which starts closed with its held root in its application: the answer that
// opens it, the frame of the open, the close, and the frames until the held root is in its
// application again. The two benches differ only in the item of the open, so their gap is the cost
// of opening on another item than the warm one: the difference written, the root diffed again and
// applied still, the moved track's pose written at once.
const warm = await startWarm();

warm.mount(["warm.tabs"]);
untilWarm(warm, 1);
await warm.answer("openPacks");
warm.frame();
await warm.answer("close");
untilApplying(warm);

/**
 * One cycle: opens the sheet with the intent while its record is building, steps the frame of the
 * open, closes it, and steps until the record is building in its application again.
 *
 * @param intent - `"openMarket"` for another item than the warm one, `"openPacks"` for the same.
 */
async function openWhileBuilding(intent: string): Promise<void> {
  await warm.answer(intent);
  warm.frame();
  await warm.answer("close");
  untilApplying(warm);
}

describe("ui: a warm window opened while its record is building", () => {
  bench(
    "open on another item, then close and warm until applied in parts (F200)",
    () => openWhileBuilding("openMarket"),
    { ...BENCH_OPTIONS, throws: true }
  );

  bench(
    "open on the warm item, then close and warm until applied in parts",
    () => openWhileBuilding("openPacks"),
    { ...BENCH_OPTIONS, throws: true }
  );
});
