import * as pixi from "pixi.js";
import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { createLazyCanvasClasses } from "../../host/render-pass";
import type { PixiModule } from "../../types";
import { createPassStage } from "../pass-stage";
import { canvasBeginStep } from "./fixtures";

// The lazy canvas pass (B3) against Pixi's own systems, on the quiet stand-in of the GPU: the CPU side of a frame that
// starts with a filter, and of one draw inside a frame. Reported only.

const classes = createLazyCanvasClasses(pixi as unknown as PixiModule);
const lazy = createPassStage({ targets: classes.targets, pipeline: classes.pipeline });
const own = createPassStage({ targets: pixi.GpuRenderTargetSystem, pipeline: pixi.PipelineSystem });

lazy.gpu.record = false;
own.gpu.record = false;

describe("a frame that starts with a filter", () => {
  bench(
    "lazy canvas pass",
    () => {
      lazy.frame(() => lazy.withFilter(lazy.draw));
    },
    BENCH_OPTIONS
  );
  bench(
    "Pixi's own",
    () => {
      own.frame(() => own.withFilter(own.draw));
    },
    BENCH_OPTIONS
  );
});

describe("ten draws on the canvas", () => {
  bench(
    "lazy canvas pass",
    () => {
      lazy.frame(() => {
        for (let draw = 0; draw < 10; draw += 1) lazy.draw();
      });
    },
    BENCH_OPTIONS
  );
  bench(
    "Pixi's own",
    () => {
      own.frame(() => {
        for (let draw = 0; draw < 10; draw += 1) own.draw();
      });
    },
    BENCH_OPTIONS
  );
});

const begin = await canvasBeginStep(true, "real");

describe("the canvas pass count", () => {
  bench("one canvas begin, an agent build", begin, BENCH_OPTIONS);
});
