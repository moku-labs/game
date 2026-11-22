import { describe, expect, it } from "vitest";
import type { LeaveTransition } from "../../types";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";
import { playingTransition } from "./transition-fixtures";

// ---------------------------------------------------------------------------
// Perf: a frame of a scene switch's transition (spec 36): the step of the picture while it plays, per kind. The
// sprite, the mesh, its numbers and the shader are made at the first step; every frame after writes numbers only.
// ---------------------------------------------------------------------------

/** The kinds and their budget rows. */
const KINDS: ReadonlyArray<[LeaveTransition["kind"], keyof typeof BUDGET]> = [
  ["fade", "transitionFade"],
  ["slide", "transitionSlide"],
  ["wipe", "transitionWipe"],
  ["iris", "transitionIris"],
  ["dissolve", "transitionDissolve"]
];

describe("the step of a transition while it plays", () => {
  // Bug: a frame boxes the eased time, makes a shader, a size object or a uniform array, or copies the look, every
  // frame of the 400 ms after each swap.
  it.each(KINDS)("allocates its budget at most a frame for a %s", async (kind, row) => {
    const playing = await playingTransition(kind);

    expect(bytesPerCall(playing.step)).toBeLessThanOrEqual(BUDGET[row] + NOISE);
    // Still the transition: the picture drawn, not freed.
    expect(playing.mock.ctx.state.sync.leave.playing?.capture).toBe("playing");
  });
});
