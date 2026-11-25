import { afterEach, describe, expect, it, vi } from "vitest";
import * as apply from "../../layout/apply";
import { type AnchorApp, frames, mount, startAnchorApp } from "../anchor-app";

// ---------------------------------------------------------------------------
// Integration: the anchor pass and the kept style record of a Yoga node (F230
// U1). The pass sizes the anchor's own tree outside any style write; the node's
// kept record has to learn that size, or a style write that restores the old one
// is skipped. Real world, real Yoga, plain Bun, inert renderer.
// ---------------------------------------------------------------------------

/** The app of the running test, stopped after it. */
let running: AnchorApp | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await running?.stop();
  running = undefined;
});

describe("the anchor pass and the kept style record", () => {
  it("hands the kept record of the anchor's node the size it wrote onto it", async () => {
    // Bug caught: the pass writes the node's width and height without telling its kept record, so
    // a later style write of the old size is skipped and the node keeps the anchor's size.
    const keep = vi.spyOn(apply, "keepSize");

    running = await startAnchorApp();
    mount(running, ["board.strip", "board.pieces", "tutorial"]);
    frames(running, 2);

    // The window sits on the first seat, 116 by 120.
    expect(keep).toHaveBeenCalledWith(
      expect.any(Float64Array),
      expect.objectContaining({ w: 116, h: 120 })
    );
  });
});
