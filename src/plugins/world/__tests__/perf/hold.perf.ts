import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { feedEqualFixture, feedShownFixture, heldInputFixture, settled } from "./fixtures";

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

  // Bug caught (F107): a held loader that `scenes` fed (the standing scene's switch, then a switch only stored) owes
  // work in every frame it stands: a reconcile by name, a warm step that reads it again.
  it("world's input step at rest with a loader held and fed keeps nothing", async ({
    annotate
  }) => {
    const bytes = alloc(settled(heldInputFixture(true)));

    await annotate(`input step at rest, loader held and fed: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.heldFedInputRest + NOISE_BYTES);
  });
});

// F107: `scenes` feeds its loader on every progress step of a switch; a step that does not move the value is free, one
// that does costs one reconcile of the loader.
describe("feed: heap per call", () => {
  // Bug caught: a feed of the value the loader has stores a copy or owes a reconcile, so every progress event of a
  // switch allocates.
  it("an equal feed keeps nothing", async ({ annotate }) => {
    const bytes = alloc(settled(feedEqualFixture()));

    await annotate(`equal feed: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.feedEqual + NOISE_BYTES);
  });

  // Bug caught: one progress step of a switch costs more than one live change of the loader (a second reconcile of
  // it), and a switch of 100 steps adds GC pauses on the A26.
  it("a feed of a shown loader and its reconcile stay in the budget of one live change", async ({
    annotate
  }) => {
    const bytes = alloc(settled(feedShownFixture()));

    await annotate(`feed of a shown loader and its reconcile: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.feedShown + NOISE_BYTES);
  });
});
