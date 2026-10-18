import * as pixi from "pixi.js";
import { afterEach, describe, expect, it } from "vitest";
import { Shape, Transform } from "../../components";
import { stepCalm } from "../../kept/record";
import { createKeptState } from "../../kept/state";
import type { KeptCtx, KeptRecord } from "../../kept/types";
import { type Drawn, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// The calm frame of the kept cache (E5 of change 2026-10-18-render-path-garbage): in a drawn frame with no mark and no
// whole-frame reason, a kept record that owes nothing is drawn from its picture as it stands, without its step. A
// record that owes something steps, or its picture goes stale; a skipped one still counts as drawn.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.oracle.expectPicturesCurrent();
    drawn.mock.stop();
  }
});

/** What `stepCalm` reads of a record. */
type CalmFields = Pick<
  KeptRecord,
  "mode" | "dirtyS1" | "dirtyS2" | "dirtyS3" | "settle" | "churn" | "lastDrawn" | "quiet"
>;

/**
 * A kept context over a fresh kept state, in a calm frame at frame 7: all `stepCalm` reads.
 *
 * @returns The context.
 */
function calmContext(): KeptCtx {
  const state = createKeptState({ keptMb: 64, debug: {} } as never);

  state.calm = true;
  state.frame = 7;

  return { state } as unknown as KeptCtx;
}

/**
 * A kept record that owes nothing, drawn last at frame 3, with fields changed.
 *
 * @param fields - The fields to change.
 * @returns The record.
 */
function recordOf(fields: Partial<CalmFields> = {}): KeptRecord {
  const record: CalmFields = {
    mode: "kept",
    dirtyS1: false,
    dirtyS2: false,
    dirtyS3: false,
    settle: false,
    churn: 0,
    lastDrawn: 3,
    quiet: 4,
    ...fields
  };

  return record as KeptRecord;
}

describe("stepCalm", () => {
  // Bug: a skipped picture is not counted: `stats().kept.pictures` drops, and the budget evicts it as unused.
  it("draws a kept record that owes nothing in a calm frame: counted, its last frame and its quiet run moved on", () => {
    const kctx = calmContext();
    const record = recordOf();

    expect(stepCalm(kctx, record)).toBe(true);
    expect(kctx.state.drawnPictures).toBe(1);
    expect(record.lastDrawn).toBe(7);
    expect(record.quiet).toBe(5);
  });

  // Bug: a record that owes a retake, a refresh, a settle, a churn count or a take is skipped, and its picture or its
  // policy goes stale.
  it.each<[string, Partial<CalmFields>]>([
    ["a live record, which counts its still frames", { mode: "live" }],
    ["a stage-1 change", { dirtyS1: true }],
    ["a stage-2 change", { dirtyS2: true }],
    ["a stage-3 change", { dirtyS3: true }],
    ["a settle retake", { settle: true }],
    ["a churn count to reset", { churn: 1 }]
  ])("steps %s", (_name, fields) => {
    const kctx = calmContext();
    const record = recordOf(fields);

    expect(stepCalm(kctx, record)).toBe(false);
    expect(kctx.state.drawnPictures).toBe(0);
    expect(record.lastDrawn).toBe(3);
  });

  it("steps every record in a frame that is not calm, and while the cache draws live for an extract", () => {
    const busy = calmContext();
    const bypassed = calmContext();

    busy.state.calm = false;
    bypassed.state.bypassed = true;

    expect(stepCalm(busy, recordOf())).toBe(false);
    expect(stepCalm(bypassed, recordOf())).toBe(false);
  });
});

describe("the calm frames of a board of kept pictures", () => {
  // Bug: a frame with a mark is taken as calm, and the changed view's picture is never retaken.
  it("retake nothing while calm, and the picture of a view that changed in the frame of its change", async () => {
    const drawn = await startDrawn({ onDemand: false });

    running.push(drawn);

    const views = [100, 200, 300].map(x =>
      drawn.spawn(Transform({ x, y: 100 }), Shape({ w: 40, h: 40 }))
    );

    drawn.frame();

    for (const view of views) {
      drawn.mock.api.sync.filters.set(
        view,
        Object.freeze([{ filter: new pixi.AlphaFilter(), passes: 1, cache: "local" as const }])
      );
    }

    drawn.frames(6);

    expect(drawn.mock.ctx.state.kept.records.map(record => record.mode)).toEqual([
      "kept",
      "kept",
      "kept"
    ]);

    const takes = drawn.stage.targets().length;

    drawn.frame();

    expect(drawn.stage.targets()).toHaveLength(takes);
    expect(drawn.mock.api.stats().kept.pictures).toBe(3);

    drawn.mock.world.ecs.set(views[1] ?? 0, Shape, { fill: 0x99_33_66 });
    drawn.frame();

    expect(drawn.stage.targets().length).toBeGreaterThan(takes);
    expect(drawn.mock.api.stats().kept.pictures).toBe(3);
  });
});
