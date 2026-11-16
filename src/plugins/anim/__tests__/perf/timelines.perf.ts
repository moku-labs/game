import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { createRuntime } from "../../lifecycle";
import { startTimeline } from "../../timeline/play";
import { defineAnimation, wait } from "../../timeline/steps";
import { createMockAnim } from "../unit/mock-anim";
import { BUDGET } from "./budgets";
import {
  crowdedTimelinesFixture,
  crowdedWaitingTimelinesFixture,
  timelinesFixture,
  waitingTimelinesFixture
} from "./fixtures";

/** The bytes per call two windows of `alloc` may differ by: its own tolerance. */
const NOISE = 1;

/** A window ten times the default, so a stray compile weighs nothing in a step that keeps 0 B. */
const IDLE_CALLS = 100_000;

describe("anim timelines: heap bytes per frame step", () => {
  it("walks 10 waiting timelines and allocates nothing", () => {
    expect(alloc(waitingTimelinesFixture(), IDLE_CALLS)).toBeLessThanOrEqual(
      BUDGET.timelinesWaiting + NOISE
    );
  });

  it("runs 10 timelines keeping only the numbers that cross into world", () => {
    expect(alloc(timelinesFixture())).toBeLessThanOrEqual(BUDGET.timelines + NOISE);
  });

  it("walks 50 waiting timelines and allocates nothing: the ring and the snapshot fields cost no frame work", () => {
    expect(alloc(crowdedWaitingTimelinesFixture(), IDLE_CALLS)).toBeLessThanOrEqual(
      BUDGET.timelinesCrowdedWaiting + NOISE
    );
  });

  it("runs 50 timelines keeping only the numbers that cross into world, 16 B a moved field as for 10", () => {
    expect(alloc(crowdedTimelinesFixture())).toBeLessThanOrEqual(BUDGET.timelinesCrowded + NOISE);
  });
});

describe("anim timelines: the ring of ended timelines", () => {
  it("is written in place: the ring and its 16 records are the same objects after 20 ends", () => {
    const mock = createMockAnim();
    const rt = createRuntime(mock.actx);
    const blink = defineAnimation("perf.blink", { slots: {}, build: () => wait(1000) });
    const ring = mock.state.ended;
    const records = [...ring];

    for (let index = 0; index < 20; index++) startTimeline(mock.actx, rt, blink, {}).finish();

    expect(mock.state.ended).toBe(ring);
    expect(mock.state.ended).toHaveLength(16);
    expect(mock.state.ended.every((record, index) => record === records[index])).toBe(true);
    // All 16 were written, so they are real records the ring reused, not the blank ones.
    expect(mock.state.ended.every(record => record.animation === "perf.blink")).toBe(true);
    expect(mock.state.endedCount).toBe(16);
  });
});
