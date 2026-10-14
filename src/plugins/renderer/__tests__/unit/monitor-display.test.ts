import { afterEach, describe, expect, it, vi } from "vitest";
import type { PerfDisplay } from "../../monitor/log-types";
import { frameAt } from "../../monitor/ring";
import { linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the `display` event (spec 11 R11.3, editor review point 5): the screen
// of the moment, written on a resize, a turn of the screen and a restore.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Yields the microtask queue, so a restore inside the renderer can finish. */
async function tick(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

/** The `display` events a listener got. */
function displays(lines: Parameters<typeof linesOf>[0]): PerfDisplay[] {
  return linesOf(lines, "event")
    .filter(line => line.name === "display")
    .map(line => line.detail as unknown as PerfDisplay);
}

describe("the display event", () => {
  it("is written once for a frame that resized, with canvas, resolution, insets, backend and orientation", async () => {
    const agent = await startAgent({ dpr: 2 });
    const lines = agent.listen();

    agent.frame({ at: 0 });
    agent.mock.ctx.state.viewport.resizePending = true;
    agent.frame({ at: 16 });
    agent.frame({ at: 32 });

    expect(displays(lines)).toEqual([
      {
        dpr: 2,
        resolution: 2,
        maxResolution: 2,
        canvas: { w: 0, h: 0 },
        css: { w: 0, h: 0 },
        safeArea: { t: 0, r: 0, b: 0, l: 0 },
        backend: "webgpu",
        orientation: "portrait"
      }
    ]);
  });

  it("is written when the screen turned", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const canvas = agent.mock.pixi.last().canvas;

    agent.frame({ at: 0 });
    canvas.width = 1920;
    canvas.height = 1080;
    agent.frame({ at: 16 });
    agent.frame({ at: 32 });

    expect(displays(lines).map(display => display.orientation)).toEqual(["landscape"]);
  });

  it("is written in the first frame after a restore of the device", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    agent.mock.pixi.last().lose("unknown");
    await tick();
    agent.frame({ at: 0 });

    expect(displays(lines)).toHaveLength(1);
    expect(linesOf(lines, "event").map(line => line.name)).toEqual([
      "device-lost",
      "device-restored",
      "display"
    ]);
  });

  it("writes a resolution event and marks the frame that applied the change", async () => {
    const agent = await startAgent({ dpr: 2 });
    const lines = agent.listen();

    agent.mock.api.monitor.setResolution(1.5);
    agent.frame({ at: 0 });

    expect(linesOf(lines, "event").find(line => line.name === "resolution")).toMatchObject({
      detail: { from: 2, to: 1.5, reason: "debug" }
    });
    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.changed.map(entry => entry.kind)).toEqual([
      "resize",
      "resolution"
    ]);
  });
});
