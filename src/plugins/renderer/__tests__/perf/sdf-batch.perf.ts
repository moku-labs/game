import * as pixi from "pixi.js";
import { afterAll, describe, expect, it } from "vitest";
import { SDF_BATCHER } from "../../host/sdf-batcher";
import { type StageElement, sdfBatchStage } from "../sdf-text-stage";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the batch of distance-field text over the real pixi.js (change 2026-10-18-sdf-batch-scopes): the pack of a
// label's glyph quad, the routing of an element to its batcher, and the draw of an SDF batch at a still resolution.
// A build of ten labels is made once, outside every window, at a phone's resolution.
// ---------------------------------------------------------------------------

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

if (glyph === undefined || batch === undefined)
  throw new Error("sdf batch perf: the build drew nothing");

/**
 * Adds an element to a batch of its own build again and again, the batch emptied every 64 adds, as one rebuild adds
 * a run of labels.
 *
 * @param element - The element.
 * @returns One add.
 */
function addsOf(element: StageElement): () => void {
  const own = new pixi.InstructionSet();
  let added = 0;

  stage.batchPipe.buildStart(own);
  stage.batchPipe.addToBatch(element, own);

  return () => {
    stage.batchPipe.addToBatch(element, own);
    added += 1;

    if (added === 64) {
      added = 0;
      element._batcher.begin();
    }
  };
}

describe("the SDF batch", () => {
  it("packs a glyph quad with its distance and allocates nothing", () => {
    const { float32View, uint32View } = batcher.attributeBuffer;

    expect(
      bytesPerCall(() =>
        batcher.packAttributes(glyph, float32View, uint32View, glyph._attributeStart, 0)
      )
    ).toBeLessThanOrEqual(BUDGET.sdfPack + NOISE);
  });

  it("routes a label's glyph to the SDF batcher and adds it, allocating nothing", () => {
    const element = stage.elements(labels[1] ?? stage.label("1"))[0];

    if (element === undefined) throw new Error("sdf batch perf: no glyph");

    expect(bytesPerCall(addsOf(element))).toBeLessThanOrEqual(BUDGET.sdfAddToBatch + NOISE);
    expect(element.batcherName).toBe(SDF_BATCHER);
  });

  it("routes a pooled element back to Pixi's default batcher, allocating nothing", () => {
    const element = new pixi.BatchableGraphics();

    Object.assign(element, {
      renderable: new pixi.Graphics(),
      geometryData: { vertices: [0, 0, 1, 0, 1, 1], uvs: [0, 0, 1, 0, 1, 1], indices: [0, 1, 2] },
      attributeOffset: 0,
      attributeSize: 3,
      indexOffset: 0,
      indexSize: 3,
      baseColor: 0xff_ff_ff,
      alpha: 1,
      texture: pixi.Texture.WHITE
    });

    const add = addsOf(element);

    expect(
      bytesPerCall(() => {
        element.batcherName = SDF_BATCHER;
        add();
      })
    ).toBeLessThanOrEqual(BUDGET.sdfAddToBatchPooled + NOISE);
    expect(element.batcherName).toBe("default");
  });

  it("draws an SDF batch at a still resolution, allocating nothing", () => {
    expect(bytesPerCall(() => stage.batchPipe.execute(batch))).toBeLessThanOrEqual(
      BUDGET.sdfDrawStill + NOISE
    );
  });
});
