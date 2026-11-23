import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import {
  entryFixture,
  settled,
  warmCallsFixture,
  warmNextFixture,
  warmPruneFixture,
  warmWaitingFixture
} from "./fixtures";

// F61 slice B+D: a warm window held hidden costs its memory and nothing a frame. World's `input` callback takes one
// warm step every frame; ui and the renderer ask `left()` and `isBuilding` while they build the held view.
describe("warm windows: heap per frame", () => {
  const resting = warmCallsFixture(false);
  const building = warmCallsFixture(true);

  // Bug caught: a scene with a warm window allocates in every frame of its rest (the A26's GC pauses come back).
  it("the warm step at rest keeps nothing", async ({ annotate }) => {
    const bytes = alloc(settled(resting.step));

    await annotate(`stepWarm at rest: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.warmStepRest + NOISE_BYTES);
  });

  // Bug caught: the frame start, the empty reconcile check or the warm step of world's `input` callback allocates.
  it("world's input step at rest with a warm window held keeps nothing", async ({ annotate }) => {
    const bytes = alloc(settled(resting.input));

    await annotate(`input step at rest, warm window held: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.warmInputRest + NOISE_BYTES);
  });

  // Bug caught: the poll of the checks while a held view builds allocates in every frame of the build.
  it("the warm step that polls the checks keeps nothing", async ({ annotate }) => {
    const bytes = alloc(settled(building.step));

    await annotate(`stepWarm polling two checks: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.warmStepPoll + NOISE_BYTES);
  });

  // Bug caught: ui and the renderer ask `left()` and `isBuilding` many times a frame while a held view builds; a heap
  // number per call is a GC pause on the A26. Settled first: a tier-up of V8 inside a window reads as 16 B a call.
  it("left() and isBuilding(held) keep nothing while a held view builds", async ({ annotate }) => {
    const left = alloc(settled(building.left));
    const flag = alloc(settled(resting.isBuilding));

    await annotate(`left: ${left} B, isBuilding: ${flag} B`);
    expect(left).toBeLessThanOrEqual(BUDGET.warmLeft + NOISE_BYTES);
    expect(flag).toBeLessThanOrEqual(BUDGET.warmIsBuilding + NOISE_BYTES);
  });

  // Bug caught: the prune of the held entities that are gone allocates in every frame that despawns something while a
  // window is held (a match that clears tiles under a held shop).
  it("the sweep after a despawn with 600 held elements keeps nothing", async ({ annotate }) => {
    const bytes = alloc(warmPruneFixture(), 2000);

    await annotate(`sweep after a despawn, 600 held elements: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.warmPruneSweep + NOISE_BYTES);
  });
});

// F202 (spec 33, slice F): the open view of a gated window built under its dim, through the press tween of the tapped
// button, and the reconcile's check for a held next view of a live key.
describe("the open view built under the dim: heap per frame", () => {
  // Bug caught: the frames of the build under the dim, which run through an owned motion now, allocate in the poll.
  it("the warm step polling the next view's checks under an owned motion keeps nothing", async ({
    annotate
  }) => {
    const bytes = alloc(settled(warmNextFixture()));

    await annotate(`stepWarm, next view in work under a motion: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.warmNextPoll + NOISE_BYTES);
  });

  // Bug caught: the walk that passes a waiting record over runs every frame of a motion now; a closure or an iterator
  // per frame is a GC pause in every animation.
  it("the warm step under an owned motion with a sheet waiting keeps nothing", async ({
    annotate
  }) => {
    const bytes = alloc(settled(warmWaitingFixture()));

    await annotate(`stepWarm, a sheet waiting under a motion: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.warmWaitingWalk + NOISE_BYTES);
  });

  // Bug caught: every live key of every commit pays for the swap check, with nothing warm (a board of 300 items).
  it("applyEntry of an unchanged live key and the swap check of a new item keep nothing with nothing warm", async ({
    annotate
  }) => {
    const calls = entryFixture();
    const same = alloc(settled(calls.same));
    const swapCheck = alloc(settled(calls.swapCheck));

    await annotate(`applyEntry same item: ${same} B, swap check: ${swapCheck} B`);
    expect(same).toBeLessThanOrEqual(BUDGET.entrySame + NOISE_BYTES);
    expect(swapCheck).toBeLessThanOrEqual(BUDGET.entrySwapCheck + NOISE_BYTES);
  });

  // Bug caught: a merge hands every board item out as a new object; the content compare that spares their `view`
  // makes a key array or a closure per item (F230: ~70 items a merge).
  it("applyEntry of a live key handed a new object with the same content keeps nothing and runs no view", async ({
    annotate
  }) => {
    const calls = entryFixture();
    const bytes = alloc(settled(calls.equal));

    await annotate(`applyEntry, a new object with the same content: ${bytes} B`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.entryEqual + NOISE_BYTES);
  });
});
