import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AnchorPerf, startAnchorPerf } from "./anchor.fixture";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { bytesPerCall } from "./fixtures";

/** The window of the tutorial. */
const WINDOW = { projection: "tutorial", key: "window" };

describe("ui anchor pass: heap per frame", () => {
  let perf: AnchorPerf;

  beforeAll(async () => {
    perf = await startAnchorPerf();
  });

  afterAll(async () => {
    await perf.app.stop();
  });

  it("keeps two anchors on still targets within budget", async ({ annotate }) => {
    const bytes = bytesPerCall(perf.still);

    await annotate(`ui.anchor, two anchors, targets still: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.anchorStill + NOISE_BYTES);
  });

  it("follows a target moving between fractional places within budget", async ({ annotate }) => {
    const bytes = bytesPerCall(perf.moving);

    // The window really follows: the piece of 64 u stands at a fractional x after each call.
    perf.moving();

    const window = perf.app.ui.rectOf(WINDOW);

    await annotate(`ui.anchor, two anchors, one following a moving view: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.anchorMoving + NOISE_BYTES);
    expect([480.25, 481.75]).toContain(window?.x);
  });
});
