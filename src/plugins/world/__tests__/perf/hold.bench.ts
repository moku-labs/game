import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { feedEqualFixture, feedShownFixture, heldInputFixture } from "./fixtures";

const heldFed = heldInputFixture(true);
const equal = feedEqualFixture();
const shown = feedShownFixture();

describe("held and fed loader", () => {
  bench("input step, at rest with a loader held and fed", heldFed, BENCH_OPTIONS);
  bench("feed of a shown loader, an equal value", equal, BENCH_OPTIONS);
  bench("feed of a shown loader of 12 rows and its reconcile", shown, BENCH_OPTIONS);
});
