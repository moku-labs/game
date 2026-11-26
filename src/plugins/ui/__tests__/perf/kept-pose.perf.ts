import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { NOISE_BYTES } from "./budgets";
import { standingReposeCall, standingVisualCall } from "./kept-pose.fixture";

// ---------------------------------------------------------------------------
// Change 2026-11-26-f244-peek-pool, slice 1: what an element that stands costs a solve and a restyle. `visualOf`
// writes the element's kept `Shape` or `Text` in place, and `repose` reads the pose that stands into the layout's
// scratch and returns. Before the change each `visualOf` built a frozen value and a one-value list, a text its anchor
// and its box too, and each `repose` built a pose and a pivot. Measured on Node 24.21, warm: 0 B each.
// ---------------------------------------------------------------------------

describe("ui: the kept values of an element that stands, heap bytes per call", () => {
  it("visualOf of a filled row whose look stands keeps nothing", async ({ annotate }) => {
    // Bug caught: a `Shape` value and its list built again for a look that did not change.
    const bytes = alloc(standingVisualCall("shape"));

    await annotate(`visualOf of a standing shape: ${bytes} B`);
    expect(bytes).toBeLessThanOrEqual(NOISE_BYTES);
  });

  it("visualOf of a text whose look stands keeps nothing", async ({ annotate }) => {
    // Bug caught: a `Text` value, its anchor, its box spread and its list built again per restyle (the album's title).
    const bytes = alloc(standingVisualCall("text"));

    await annotate(`visualOf of a standing text: ${bytes} B`);
    expect(bytes).toBeLessThanOrEqual(NOISE_BYTES);
  });

  it("repose of an element that did not move keeps nothing", async ({ annotate }) => {
    // Bug caught: a rest pose or a pivot built before the check that the pose stands.
    const bytes = alloc(standingReposeCall());

    await annotate(`repose of a standing element: ${bytes} B`);
    expect(bytes).toBeLessThanOrEqual(NOISE_BYTES);
  });
});
