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

  // Bug: the refusal builds its warning's detail, or walks the subtree through an array (as `holdsDisplay` does), at
  // every step.
  it("allocates nothing for 10 kept views and a filtered view with a glow inside, stepped (F68)", async () => {
    expect(bytesPerCall(await keptBlendBoard(10), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptBlend + NOISE
    );
  });
});
