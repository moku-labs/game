import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { buildReady } from "../../sync/build";
import { createMockRenderer } from "../mock-renderer";
import { waitingBuild } from "./fixtures";

const waiting = await waitingBuild(40);
const idle = createMockRenderer();

await idle.start();

describe("the frame functions of a scene build", () => {
  bench(
    "a still pass while 40 built views wait for the swap",
    () => waiting.mock.modules.sync.pass(),
    BENCH_OPTIONS
  );

  bench(
    "the build step of a drawn frame with no build",
    () => {
      idle.modules.sync.takeBuildWork();
    },
    BENCH_OPTIONS
  );

  bench(
    "the readiness check of built()",
    () => {
      buildReady(waiting.sctx);
    },
    BENCH_OPTIONS
  );
});
