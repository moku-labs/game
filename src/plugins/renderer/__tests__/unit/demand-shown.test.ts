import * as pixi from "pixi.js";
import { describe, expect, it } from "vitest";
import { Display, Parent, Shape, Transform } from "../../components";
import { ancestorsShown } from "../../demand/shown";
import type { HostModule } from "../../types";
import { box, demandAlone, OWNER, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// What "shown" means (F6, F18a): a view drawn in the frame as it stands. Real
// Pixi containers and a real Bounds on a 1080 x 1920 screen. A view judged
// hidden that is seen freezes on the screen; one judged seen that is not
// draws frames nobody sees.
// ---------------------------------------------------------------------------

/**
 * A glow-like filter of the given padding, with no program: the padding is all the predicate reads.
 *
 * @param padding - Its padding in px.
 * @returns The filter.
 */
function padded(padding: number): pixi.Filter {
  return new pixi.Filter({ resources: {}, padding } as unknown as pixi.FilterOptions);
}

describe("demand.shown", () => {
  it.each([
    ["an alpha of 0", (parent: pixi.Container) => (parent.alpha = 0)],
    ["visible false", (parent: pixi.Container) => (parent.visible = false)],
    ["renderable false", (parent: pixi.Container) => (parent.renderable = false)]
  ])("a view hidden by an ancestor's %s is not shown", (_name, hide) => {
    const { demand, view, stage } = demandAlone();
    const parent = new pixi.Container();

    stage.addChild(parent);
    view(1, box(10, 10), parent);

    expect(demand.shown(1)).toBe(true);

    hide(parent);

    expect(demand.shown(1)).toBe(false);
  });

  it("a view out of the drawn tree is not shown", () => {
    const { demand, view } = demandAlone();
    const loose = new pixi.Container();

    view(1, box(10, 10), loose);

    expect(demand.shown(1)).toBe(false);
    expect(demand.shown(2)).toBe(false);
  });

  it("a leaf fully off the screen is not shown; the same leaf with a filter whose padding reaches the screen is", () => {
    const { demand, view } = demandAlone();
    const light = view(1, box(1080 + 5, 100)).object;

    expect(demand.shown(1)).toBe(false);

    light.filters = [padded(10)];

    expect(demand.shown(1)).toBe(true);
  });

  it("an ancestor's filter padding counts for a leaf", () => {
    const { demand, view, stage } = demandAlone();
    const parent = new pixi.Container();

    stage.addChild(parent);
    view(1, box(-45, 100), parent);

    expect(demand.shown(1)).toBe(false);

    parent.filters = [padded(10)];

    expect(demand.shown(1)).toBe(true);
  });

  it("a disabled filter's padding still counts", () => {
    const { demand, view } = demandAlone();
    const filter = padded(10);
    const light = view(1, box(100, 1920 + 5)).object;

    filter.enabled = false;
    light.filters = [filter];

    expect(demand.shown(1)).toBe(true);
  });

  it("a view with children is never exempt off the screen", () => {
    const { demand, view, stage } = demandAlone();
    const panel = view(1, box(5000, 100)).object;
    const wrapped = view(2, box(5000, 300));
    const wrapper = new pixi.Container();

    // A Display object that holds children of its own: one may carry a filter Pixi's bounds leave out.
    panel.addChild(box(0, 0));
    // A view the renderer wrapped: its children hang in the wrapper, which carries the subtree.
    stage.addChild(wrapper);
    wrapper.addChild(wrapped.object);
    wrapped.wrapper = wrapper;

    expect(demand.shown(1)).toBe(true);
    expect(demand.shown(2)).toBe(true);
  });

  it("a view that draws nothing measurable is not shown", () => {
    const { demand, view } = demandAlone();

    view(1, new pixi.Container());

    expect(demand.shown(1)).toBe(false);
  });

  it("the ancestor rule ignores the view's own alpha and its place", () => {
    const { view, stage, views } = demandAlone();
    const parent = new pixi.Container();
    const host = { stage: () => stage } as unknown as HostModule;

    stage.addChild(parent);
    const label = view(1, box(5000, 10), parent).object;

    label.alpha = 0;

    expect(ancestorsShown(host, views, 1)).toBe(true);

    parent.visible = false;

    expect(ancestorsShown(host, views, 1)).toBe(false);
    expect(ancestorsShown(host, views, 2)).toBe(false);
  });
});

describe("demand.unseenBy", () => {
  it("answers where the walk stopped, and shown is unseenBy === shown", async () => {
    const drawn = await startDrawn();
    const { ecs } = drawn.mock.world;
    const seen = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 50, h: 50 }));
    const faded = drawn.spawn(Transform({ x: 200, y: 100 }), Shape({ w: 50, h: 50, alpha: 0 }));
    const panel = drawn.spawn(Transform({ x: 300, y: 100 }), Shape({ w: 200, h: 200, alpha: 0 }));
    const far = drawn.spawn(Transform({ x: 5000, y: 100 }), Shape({ w: 50, h: 50 }));
    const empty = drawn.spawn(Transform({ x: 400, y: 600 }), Shape({ w: 50, h: 50, fillAlpha: 0 }));
    const own = box(0, 0);

    own.alpha = 0;

    const game = drawn.spawn(Transform({ x: 500, y: 600 }), Display({ object: own }));

    drawn.frame();

    const glint = ecs.spawn(OWNER, [
      Parent({ entity: panel }),
      Transform(),
      Shape({ w: 20, h: 20 })
    ]);

    drawn.frames(2);

    const demand = drawn.mock.modules.demand;
    const table = [seen, faded, glint, far, empty, game, 9_999_999].map(entity => [
      demand.unseenBy(entity),
      demand.shown(entity)
    ]);

    expect(table).toEqual([
      ["shown", true],
      ["alpha-own", false],
      ["alpha-above", false],
      ["off-screen", false],
      ["other", false],
      ["other", false],
      ["other", false]
    ]);
    drawn.oracle.expectNoMissedFrame();
    drawn.mock.stop();
  });
});
