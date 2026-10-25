import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkMissedMarks } from "../../demand/check";
import { box, demandAlone } from "../demand-harness";

// ---------------------------------------------------------------------------
// The dev missed-mark check (spec 14 D6.2): on a skipped frame of a dev build
// it reads Pixi's change lists and warns once about a listed, shown view the
// engine never heard of. It never decides, never runs in production, and
// switches itself off on a Pixi without the lists. Real render groups.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A dev build with `onDemand`, its first frame drawn, a Display object listed by Pixi as changed
 * and never marked: a game wrote into it without `renderer.invalidate`.
 *
 * @returns The module, its handles and the object.
 */
function strayWrite(): ReturnType<typeof demandAlone> & { flame: pixi.Graphics } {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);

  const alone = demandAlone({ renderGroup: true });
  const flame = box(100, 100);

  flame.label = "Display#7 stove";
  alone.view(7, flame);
  alone.demand.settle(alone.demand.decide(false));
  // The write: Pixi lists the object, the renderer is told nothing.
  flame.x = 120;

  return { ...alone, flame };
}

describe("the dev missed-mark check", () => {
  it("warns renderer:missed-mark once for a write into a Display object without invalidate, naming the entity and label", () => {
    const { demand, log } = strayWrite();

    expect(demand.decide(false)).toBe(false);

    demand.settle(false);
    demand.decide(false);
    demand.settle(false);

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("renderer:missed-mark", {
      entity: 7,
      label: "Display#7 stove"
    });
  });

  it("warns nothing for a write marked since the last drawn frame", () => {
    const { ctx, stage, log, demand } = strayWrite();

    ctx.state.demand.sinceDraw.add(7);
    checkMissedMarks(ctx, ctx.state.demand, stage, demand.shown);

    expect(log.warn).not.toHaveBeenCalled();
  });

  it("warns nothing for a write under a hidden ancestor (F6)", () => {
    const { ctx, stage, log, demand, flame } = strayWrite();
    const parent = new pixi.Container();

    stage.addChild(parent);
    parent.addChild(flame);
    parent.alpha = 0;
    checkMissedMarks(ctx, ctx.state.demand, stage, demand.shown);

    expect(log.warn).not.toHaveBeenCalled();
  });

  it("never reads the lists in a production build, and never on a drawn frame", () => {
    const { demand } = strayWrite();
    const read = vi.spyOn(Reflect, "get");

    demand.settle(true);

    expect(read).not.toHaveBeenCalledWith(expect.anything(), "renderGroup");

    vi.stubGlobal("__MOKU_GAME_DEV__", false);
    demand.decide(false);
    demand.settle(false);

    expect(read).not.toHaveBeenCalledWith(expect.anything(), "renderGroup");
  });

  it("reads the lists of a render group nested in the stage too", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const { demand, view, stage, log } = demandAlone({ renderGroup: true });
    const panel = new pixi.Container({ isRenderGroup: true });
    const glint = box(10, 10);

    stage.addChild(panel);
    demand.settle(demand.decide(false));
    view(4, glint, panel);
    demand.decide(false);
    demand.settle(false);

    // Pixi's own label of a graphics it was given no other.
    expect(log.warn).toHaveBeenCalledWith("renderer:missed-mark", { entity: 4, label: "Graphics" });
  });

  it("names the view whose wrapper holds a written mask, and the child view for a write into a child (F69)", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const { demand, view, stage, log, ctx } = demandAlone({ renderGroup: true });
    const card = view(3, box(100, 100));
    const wrapper = new pixi.Container();
    const mask = box(100, 100);
    const clipped = new pixi.Container();
    const pin = box(10, 10);

    // As sync hangs a clipping parent: its object, its mask and its masked container in its wrapper.
    stage.addChild(wrapper);
    wrapper.addChild(card.object, mask, clipped);
    card.wrapper = wrapper;
    card.mask = mask;
    card.clipped = clipped;
    ctx.state.sync.viewOfTop.delete(card.object);
    ctx.state.sync.viewOfTop.set(wrapper, card);
    view(9, pin, clipped);
    demand.settle(demand.decide(false));
    pixi.updateRenderGroupTransforms(Reflect.get(stage, "renderGroup"), true);
    mask.x = 4;
    pin.x = 4;
    demand.decide(false);
    demand.settle(false);

    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith("renderer:missed-mark", { entity: 3, label: "Graphics" });
    expect(log.warn).toHaveBeenCalledWith("renderer:missed-mark", { entity: 9, label: "Graphics" });
  });

  it("switches itself off with one debug line on a Pixi without render group lists", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const { demand, view, log, ctx } = demandAlone();

    view(1, box(100, 100));
    demand.settle(demand.decide(false));
    demand.settle(demand.decide(false));
    demand.settle(demand.decide(false));

    expect(ctx.state.demand.check.off).toBe(true);
    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(log.debug).toHaveBeenCalledWith("renderer:demand-check-off", {
      reason: "Pixi's render group has no change lists"
    });
    expect(log.warn).not.toHaveBeenCalled();
  });
});
