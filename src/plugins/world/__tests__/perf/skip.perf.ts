import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { emptyQueryFixture, sceneSkipFixture, settled, skipCheckFixture } from "./fixtures";

describe("skipped systems: heap per frame", () => {
  // Bug caught: a system whose query has no entity still runs, walks its first store or allocates,
  // so a game pays for the systems of screens it does not show.
  it("40 systems whose query has no entity are not run and the frame keeps nothing", async ({
    annotate
  }) => {
    const fixture = emptyQueryFixture();
    const bytes = alloc(settled(fixture.frame), 1000);

    await annotate(`skip, 40 systems with an empty store: ${bytes} B a frame`);
    expect(fixture.runs()).toBe(0);
    expect(bytes).toBeLessThanOrEqual(BUDGET.skipEmpty + NOISE_BYTES);
  });

  // Bug caught: a system whose scenes are not on screen still runs, or its check allocates.
  it("40 systems of a scene that is not mounted are not run and the frame keeps nothing", async ({
    annotate
  }) => {
    const fixture = sceneSkipFixture();
    const bytes = alloc(settled(fixture.frame), 1000);

    await annotate(`skip, 40 systems of another scene: ${bytes} B a frame`);
    expect(fixture.runs()).toBe(0);
    expect(bytes).toBeLessThanOrEqual(BUDGET.skipScene + NOISE_BYTES);
  });

  // Bug caught: the check before a run makes an array, a closure or an iterator per system.
  it("the check before 40 systems that run keeps nothing", async ({ annotate }) => {
    const fixture = skipCheckFixture();
    const bytes = alloc(settled(fixture.frame), 1000);

    await annotate(`skip check, 40 systems that run: ${bytes} B a frame`);
    expect(fixture.runs()).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(BUDGET.skipCheck + NOISE_BYTES);
  });
});
