import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { settled, warmCallsFixture } from "./fixtures";

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

  it("left() and isBuilding(held) keep nothing while a held view builds", async ({ annotate }) => {
    const left = alloc(building.left);
    const flag = alloc(resting.isBuilding);

    await annotate(`left: ${left} B, isBuilding: ${flag} B`);
    expect(left).toBeLessThanOrEqual(BUDGET.warmLeft + NOISE_BYTES);
    expect(flag).toBeLessThanOrEqual(BUDGET.warmIsBuilding + NOISE_BYTES);
  });
});
