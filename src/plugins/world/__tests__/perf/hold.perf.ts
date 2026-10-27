import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { heldInputFixture, settled } from "./fixtures";

// F103: a leave loader held while its scene stands costs its memory and nothing a frame. World's `input` callback
// looks for a commit and for an owed `show`, then takes the warm step, which finds the held view ready.
describe("held projection: heap per frame", () => {
  // Bug caught: a scene that holds its loader allocates in every frame it stands (the check for an owed show, the
  // held lookup), and the A26's GC pauses come back.
  it("world's input step at rest with a loader held keeps nothing", async ({ annotate }) => {
    const bytes = alloc(settled(heldInputFixture()));

    await annotate(`input step at rest, loader held: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.heldInputRest + NOISE_BYTES);
  });
});
