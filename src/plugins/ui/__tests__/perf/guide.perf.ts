import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Shape, Transform } from "../../../renderer/components";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { bytesPerCall } from "./fixtures";
import { type GuidePerf, startGuidePerf } from "./guide.fixture";

describe("ui guide pass: heap per frame", () => {
  let perf: GuidePerf;

  beforeAll(async () => {
    perf = await startGuidePerf();
  });

  afterAll(async () => {
    await perf.app.stop();
  });

  it("keeps a guide on a still target within budget", async ({ annotate }) => {
    const bytes = bytesPerCall(perf.still);

    await annotate(`ui.guide, a veil of four on a still view: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.guideStill + NOISE_BYTES);
  });

  it("follows a target moving between fractional places within budget", async ({ annotate }) => {
    const bytes = bytesPerCall(perf.moving);

    // The window really follows: the piece of 64 u stands at a fractional x after each call.
    perf.moving();

    const window = perf.app.ui.rectOf({ projection: "guide.pieces", key: "piece" });
    // The veil really follows: the rectangle left of the window ends where the piece begins.
    const left = [...perf.app.world.ecs.query(Shape, Transform)].find(
      ([, shape, pose]) => shape.alpha === 0.6 && pose.x === 0 && pose.y > 0 && shape.w < 1080
    );

    await annotate(`ui.guide, a veil of four on a moving view: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.guideMoving + NOISE_BYTES);
    expect([480.25, 481.75]).toContain(window?.x);
    expect(left?.[1].w).toBe(window?.x);
  });
});
