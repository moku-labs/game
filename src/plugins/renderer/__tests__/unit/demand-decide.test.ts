import { afterEach, describe, expect, it, vi } from "vitest";
import { stopDemand } from "../../demand/state";
import type { DemandReason } from "../../demand/types";
import { box, demandAlone } from "../demand-harness";

// ---------------------------------------------------------------------------
// The decision of the render phase (spec 14 D4.2): why a frame is drawn, and
// that a frame with no reason is not. A missed reason is a frozen screen; a
// reason that never goes away is a phone that draws a still board for ever.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The demand module with its first frame drawn, so the next decision starts from a still tree.
 *
 * @param onDemand - `config.onDemand`.
 * @returns The module and its handles.
 */
function resting(onDemand = true): ReturnType<typeof demandAlone> {
  const alone = demandAlone({ onDemand });

  alone.demand.decide(false);

  return alone;
}

describe("demand.decide", () => {
  it("draws every frame while onDemand is off, whatever was marked", () => {
    const { demand } = resting(false);

    expect([demand.decide(false), demand.decide(false)]).toEqual([true, true]);
    expect(demand.frame().reason).toBe("always");
  });

  it("draws the first frame after the host came up, then nothing on a still tree", () => {
    const { demand } = demandAlone();

    expect(demand.decide(false)).toBe(true);
    expect(demand.frame().reason).toBe("first");
    expect(demand.decide(false)).toBe(false);
    expect(demand.frame()).toEqual({ drawn: false, reason: "none", marks: 0 });
  });

  it("draws nothing while the host is not ready, and the first frame once it is", () => {
    const { demand, host } = demandAlone();

    host.ready = false;

    expect(demand.decide(false)).toBe(false);

    host.ready = true;

    expect(demand.decide(false)).toBe(true);
    expect(demand.frame().reason).toBe("first");
  });

  it("draws the frame after a wake, and only that one", () => {
    const { demand, time } = resting();

    time.wakes += 1;

    expect(demand.decide(false)).toBe(true);
    expect(demand.frame().reason).toBe("wake");
    expect(demand.decide(false)).toBe(false);
  });

  it("draws while a capture waits", () => {
    const { demand } = resting();

    expect(demand.decide(true)).toBe(true);
    expect(demand.frame().reason).toBe("capture");
    expect(demand.decide(false)).toBe(false);
  });

  it("draws a requested frame once", () => {
    const { demand } = resting();

    demand.request();
    demand.request();

    expect(demand.decide(false)).toBe(true);
    expect(demand.frame().reason).toBe("request");
    expect(demand.decide(false)).toBe(false);
  });

  it.each<DemandReason>([
    "resize",
    "restore",
    "layers",
    "debug"
  ])("draws the frame of a whole-frame reason: %s", reason => {
    const { demand } = resting();

    demand.whole(reason);

    expect(demand.decide(false)).toBe(true);
    expect(demand.frame().reason).toBe(reason);
    expect(demand.decide(false)).toBe(false);
  });

  it("keeps every whole-frame reason of the frame, the first one as the reason", () => {
    const { demand, view } = resting();

    view(1, box(10, 10));
    demand.mark(1);
    demand.whole("resize");
    demand.whole("restore");

    expect([...demand.wholes()]).toEqual(["resize", "restore"]);

    demand.decide(false);

    expect(demand.frame().reason).toBe("resize");
    expect(demand.wholes().size).toBe(0);
  });

  it("draws the frame of a mark of a view that is drawn", () => {
    const { demand, view } = resting();

    view(1, box(10, 10));
    demand.mark(1);

    expect(demand.decide(false)).toBe(true);
    expect(demand.frame()).toEqual({ drawn: true, reason: "mark", marks: 1 });
  });

  it("drops the marks that did not count with the decision", () => {
    const { demand, view } = resting();
    const hidden = box(10, 10);

    view(1, hidden);
    hidden.visible = false;
    demand.mark(1);

    expect(demand.decide(false)).toBe(false);

    // Shown again with no new mark: the dropped mark does not come back.
    hidden.visible = true;

    expect(demand.decide(false)).toBe(false);
  });

  it("judges a mark of a view that has none yet at the decision", () => {
    const { demand, view } = resting();

    demand.mark(1);
    view(1, box(10, 10));

    expect(demand.decide(false)).toBe(true);
    expect(demand.frame().reason).toBe("mark");
  });

  it("counts a loose mark unless an ancestor hides it, whatever the view does itself", () => {
    const { demand, view, stage } = resting();
    const parent = box(0, 0);
    const label = box(10, 10);

    stage.addChild(parent);
    view(1, label, parent);
    label.alpha = 0;
    demand.markLoose(1);

    expect(demand.decide(false)).toBe(true);

    parent.alpha = 0;
    demand.markLoose(1);

    expect(demand.decide(false)).toBe(false);
  });

  it("frame() reports drawn, reason and the mark count of the last decision in one object", () => {
    const { demand, view } = resting();
    const frame = demand.frame();

    view(1, box(10, 10));
    view(2, box(60, 10));
    demand.mark(1);
    demand.mark(1);
    demand.markLoose(2);
    demand.decide(false);

    expect(demand.frame()).toBe(frame);
    expect(frame).toEqual({ drawn: true, reason: "mark", marks: 2 });
  });

  it("marks nothing while the renderer is inert, and invalidate skips an entity without a view", () => {
    const { demand, ctx, view } = resting();

    demand.invalidate(9);

    expect(demand.marked().size).toBe(0);

    view(1, box(10, 10));
    ctx.state.sync.root = undefined;
    demand.mark(1);
    demand.markLoose(1);

    expect(demand.marked().size).toBe(0);
    expect(demand.decide(false)).toBe(false);
  });

  it("stopDemand forgets the marks, the reasons and the first frame", () => {
    const { demand, ctx, view } = resting();

    view(1, box(10, 10));
    demand.mark(1);
    demand.whole("resize");
    stopDemand(ctx.state.demand);

    expect(demand.marked().size).toBe(0);
    expect(demand.wholes().size).toBe(0);
    expect(demand.decide(false)).toBe(true);
    expect(demand.frame().reason).toBe("first");
  });
});
