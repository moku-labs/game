import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { createMockRenderer } from "../mock-renderer";
import { waitingSources } from "./release-fixtures";

const idle = createMockRenderer();
const waiting = createMockRenderer();

await idle.start();
await waiting.start();
waiting.ctx.state.sync.release.pending.push(...waitingSources(40));

describe("the release step", () => {
  bench(
    "one step with nothing waiting",
    () => {
      idle.modules.sync.releaseStep();
    },
    BENCH_OPTIONS
  );

  bench(
    "one step with 40 images waiting for their upload",
    () => {
      waiting.modules.sync.releaseStep();
    },
    BENCH_OPTIONS
  );
});
