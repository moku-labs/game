import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import {
  bytesPerCall,
  crowdWaitingBoard,
  cutZoomBoard,
  idleAwayBoard,
  keptAncestorFadeBoard,
  keptBlendBoard,
  keptBoard,
  keptFadeBoard,
  keptFractionalBoard,
  keptOwnFadeBoard,
  keptShadedBoard,
  keptSteppedBoard,
  keptUnderBoard,
  keptWhyBoard,
  keptZoomBoard
} from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the flush of the kept cache in a drawn frame where none of its pictures changed (E5 of change
// 2026-10-18-render-path-garbage): 10 quiet kept views cost nothing, in a calm frame and in one where a view elsewhere
// changed and every record steps; a filtered view with a glow inside, drawn live, costs nothing either (F68).
// ---------------------------------------------------------------------------

describe("the kept flush of a quiet board", () => {
  it("allocates nothing for 10 kept views in a calm frame", async () => {
    expect(bytesPerCall(await keptBoard(10), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptFlushQuiet + NOISE
    );
  });

  it("allocates nothing for 10 kept views stepped in a frame with a mark elsewhere", async () => {
    expect(bytesPerCall(await keptBoard(10, true), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptFlushStepped + NOISE
    );
  });

  it("allocates nothing while one of 10 kept views fades through a stack of alphas (F54)", async () => {
    expect(bytesPerCall(await keptFadeBoard(10), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptFade + NOISE
    );
  });

  // Bug: a kept view fading through its own alpha is retaken every frame (F120), or its step builds the quad's alpha.
  it("allocates nothing but Pixi's alpha writes while one of 10 kept views fades through its own alpha (F120)", async () => {
    expect(bytesPerCall(await keptOwnFadeBoard(10), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptOwnFade + NOISE
    );
  });

  it("allocates nothing while 10 kept views are drawn scaled under a camera zoom (F67)", async () => {
    expect(bytesPerCall(await keptZoomBoard(10), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptZoom + NOISE
    );
  });

  // Bug: the step of a picture kept under a translucent ancestor (F113) reads an ancestor's alpha, a boxed double (E4).
  it("allocates nothing while 10 kept views are stepped under a translucent root (F113)", async () => {
    expect(bytesPerCall(await keptAncestorFadeBoard(10), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptAncestorFade + NOISE
    );
  });

  // Bug: a cut take refused under a zoom is tried again every third frame, building its bounds each time (F113).
  it("allocates nothing while a still panorama cut to the canvas stands under a zoom (F113)", async () => {
    expect(bytesPerCall(await cutZoomBoard(), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptCutZoom + NOISE
    );
  });

  // Bug: a view whose take rendered nothing (off the canvas) is tried again every few frames, building its bounds (F114).
  it("allocates nothing for 10 views with an alpha filter off the canvas, stepped (F114)", async () => {
    expect(bytesPerCall(await idleAwayBoard(10), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptIdleAway + NOISE
    );
  });

  // Bug: counting the live views that wait for a first take (F119) walks their ancestors through an array or boxes a
  // number at every flush.
  it("allocates nothing for a crowd of 10 live views waiting for their first take, stepped (F119)", async () => {
    expect(bytesPerCall(await crowdWaitingBoard(10), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptCrowd + NOISE
    );
  });

  // Bug: the check of a step reads its numbers through an object, or a closure is made for what a record owes (F126).
  it("allocates nothing for 40 kept views stepped in the frames after a step of the resolution (F126)", async () => {
    expect(bytesPerCall(await keptSteppedBoard(40), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptFlushStepped + NOISE
    );
  });

  // Bug: a fractional resolution merged with `"inherit"` boxes per record, merged with `undefined` once a frame.
  it("allocates nothing for 40 kept views stepped at a fractional resolution", async () => {
    expect(bytesPerCall(await keptFractionalBoard(40), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptFlushStepped + NOISE
    );
  });

  // Bug: the same boxes on the frames after a step that ends on a fraction.
  it("allocates nothing for 40 kept views stepped after a step to a fractional resolution", async () => {
    expect(bytesPerCall(await keptSteppedBoard(40, 1.5), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptFlushStepped + NOISE
    );
  });

  // Bug: the step's bookkeeping for `why()` builds a string, an object or a closure for every live view of every frame.
  it("allocates nothing for 10 live views changed every frame, their reasons noted (F126)", async () => {
    expect(bytesPerCall(await keptWhyBoard(10), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptWhy + NOISE
    );
  });

  // Bug: a shaded view makes a size object and a label for its output, walks a frozen list with `for…of`, or an iterator
  // walks the ranges for every view that redraws: a mesh frame must cost what the spike measured, and no collection.
  it("allocates nothing for 40 shaded views whose numbers are written every frame (F126)", async () => {
    expect(bytesPerCall(await keptShadedBoard(40), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptShaded + NOISE
    );
  });

  // Bug: the walk up the ancestors of a view under a filter boxes a number or makes a closure per ancestor: it runs for
  // every view of every frame, and the ward holds a dozen.
  it("allocates nothing for 12 placed views under a filter whose numbers are written every frame (F126)", async () => {
    expect(bytesPerCall(await keptUnderBoard(12), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptUnder + NOISE
    );
  });

  // Bug: the refusal builds its warning's detail, or walks the subtree through an array (as `holdsDisplay` does), at
  // every step.
  it("allocates nothing for 10 kept views and a filtered view with a glow inside, stepped (F68)", async () => {
    expect(bytesPerCall(await keptBlendBoard(10), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptBlend + NOISE
    );
  });
});
