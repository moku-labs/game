import { afterAll, bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { sdfBatchStage } from "../sdf-text-stage";

const stage = sdfBatchStage(2.8);
const labels = Array.from({ length: 10 }, (_, index) => stage.label(String(index * 7)));
const set = stage.build(labels);
const batcher = stage.sdfBatcher(set);
const [glyph] = stage.elements(labels[0] ?? stage.label("0"));
const [batch] = stage.batches(set);

stage.draw(set);

afterAll(() => {
  stage.remove();
});

describe("the SDF batch", () => {
  bench(
    "pack of a glyph quad",
    () => {
      if (glyph !== undefined) {
        const { float32View, uint32View } = batcher.attributeBuffer;

        batcher.packAttributes(glyph, float32View, uint32View, glyph._attributeStart, 0);
      }
    },
    BENCH_OPTIONS
  );

  bench(
    "a rebuild of ten consecutive labels",
    () => {
      stage.build(labels, set);
    },
    BENCH_OPTIONS
  );

  bench(
    "the draw of an SDF batch at a still resolution",
    () => {
      if (batch !== undefined) stage.batchPipe.execute(batch);
    },
    BENCH_OPTIONS
  );
});
