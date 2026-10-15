import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Display, Parent, Sprite, Transform } from "../../components";
import { withDeps } from "../../lifecycle";
import {
  clearHidden,
  type HiddenCtx,
  type HiddenReason,
  hiddenBy,
  layerHiddenBy,
  liftFor,
  onlyHiddenBy,
  setHidden,
  setLayerHidden,
  setObjectHidden,
  swapHidden
} from "../../sync/hidden";
import { createSyncState } from "../../sync/state";
import type { SyncState, View, ViewKind } from "../../sync/types";
import { type Drawn, OWNER, startDrawn, viewOf } from "../demand-harness";

// ---------------------------------------------------------------------------
// sync/hidden.ts (spec 22 O3, LEAD-FIXES-2 OQ23-1, OQ23-7, OQ26-1): the one
// writer of `renderable`. A wrong node is a double draw or a hole under a
// cover; a missed mark is a frozen screen; a missed restore after a picture is
// a view that never comes back.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A hidden context over a bare sync state, with a demand that only records. */
type Alone = {
  hctx: HiddenCtx;
  state: SyncState;
  demand: { mark: ReturnType<typeof vi.fn>; whole: ReturnType<typeof vi.fn> };
};

/**
 * The hidden writers over a fresh sync state and a recording demand.
 *
 * @returns The context and its handles.
 */
function alone(): Alone {
  const state = createSyncState({});
  const demand = { mark: vi.fn(), whole: vi.fn() };
  const hctx = { ctx: { state: { sync: state } }, deps: { demand } } as unknown as HiddenCtx;

  return { hctx, state, demand };
}

/**
 * A view of a real Pixi object as `sync` holds it, registered in the state: a wrapper, when given, holds the object.
 *
 * @param state - The sync state.
 * @param entity - The entity.
 * @param kind - The view kind.
 * @param wrapper - The wrapper of a parent, or nothing.
 * @returns The view.
 */
function held(state: SyncState, entity: Entity, kind: ViewKind, wrapper?: pixi.Container): View {
  const object = new pixi.Container();
  const view: View = { ...viewOf(object), kind, wrapper };

  wrapper?.addChild(object);
  state.views.set(entity, view);
  state.entityOf.set(object, entity);
  state.viewOfTop.set(wrapper ?? object, view);

  return view;
}

/** The whole renderer over real Pixi, and the hidden context the sync module builds from it. */
type Running = { drawn: Drawn; hctx: HiddenCtx; state: SyncState };

/**
 * Starts the renderer over real Pixi (the tree oracle checks every frame) with its own demand behind the writers.
 *
 * @returns The renderer, the context and the sync state.
 */
async function running(): Promise<Running> {
  const drawn = await startDrawn();

  return {
    drawn,
    hctx: { ctx: withDeps(drawn.mock.ctx), deps: drawn.mock.modules },
    state: drawn.mock.ctx.state.sync
  };
}

/**
 * The view sync built for an entity.
 *
 * @param state - The sync state.
 * @param entity - The entity.
 * @returns The view.
 */
function viewIn(state: SyncState, entity: Entity): View {
  const view = state.views.get(entity);

  if (view === undefined) throw new Error(`no view for ${entity}`);

  return view;
}

describe("sync hidden", () => {
  it("two reasons hide a view until both are gone", () => {
    const { hctx, state } = alone();
    const view = held(state, 1, "Sprite");

    setHidden(hctx, 1, view, "cover", true);
    setHidden(hctx, 1, view, "freeze", true);
    setHidden(hctx, 1, view, "cover", false);

    expect(view.object.renderable).toBe(false);
    expect(hiddenBy(view, "freeze")).toBe(true);
    expect(hiddenBy(view, "cover")).toBe(false);

    setHidden(hctx, 1, view, "kept", true);
    setHidden(hctx, 1, view, "freeze", false);

    expect(view.object.renderable).toBe(false);

    setHidden(hctx, 1, view, "kept", false);

    expect(view.object.renderable).toBe(true);
    expect(view.hiddenTop).toBe(0);
  });

  it("an empty visual hides the object and keeps the wrapper's children drawn", () => {
    const { hctx, state } = alone();
    const view = held(state, 1, "Shape", new pixi.Container());
    const child = new pixi.Container();

    view.wrapper?.addChild(child);
    setHidden(hctx, 1, view, "empty", true);

    expect(view.object.renderable).toBe(false);
    expect(view.wrapper?.renderable).toBe(true);
    expect(child.renderable).toBe(true);
    expect(view.hiddenSelf).toBe(1);
  });

  it("a view without a wrapper carries every reason on its object; a wrapper made later takes the subtree reasons", async () => {
    const { drawn, hctx, state } = await running();
    const parent = drawn.spawn(Transform(), Sprite({ texture: "board.cell" }));

    drawn.frame();

    const view = viewIn(state, parent);
    const reasons: HiddenReason[] = ["empty", "alpha", "cover", "freeze", "kept"];

    for (const reason of reasons) setHidden(hctx, parent, view, reason, true);

    expect(view.object.renderable).toBe(false);

    drawn.mock.world.ecs.spawn(OWNER, [
      Transform(),
      Sprite({ texture: "board.cell" }),
      Parent({ entity: parent })
    ]);
    drawn.frame();

    const wrapper = view.wrapper;

    expect(wrapper?.renderable).toBe(false);
    expect(view.object.renderable).toBe(false);
    expect(wrapper === undefined ? undefined : state.viewOfTop.get(wrapper)).toBe(view);
    expect(state.viewOfTop.get(view.object)).toBeUndefined();

    // Only "empty" stays on the object: with it gone the visual is drawn, the subtree still is not.
    setHidden(hctx, parent, view, "empty", false);
    drawn.frame();

    expect(view.object.renderable).toBe(true);
    expect(wrapper?.renderable).toBe(false);

    for (const reason of reasons) setHidden(hctx, parent, view, reason, false);
    drawn.frame();

    expect(wrapper?.renderable).toBe(true);
  });

  it("alpha 0 of a text hides its object and keeps its children drawn", () => {
    const { hctx, state } = alone();
    const view = held(state, 1, "adapter", new pixi.Container());
    const child = new pixi.Container();

    view.wrapper?.addChild(child);
    setHidden(hctx, 1, view, "alpha", true);

    expect(view.object.renderable).toBe(false);
    expect(view.wrapper?.renderable).toBe(true);
    expect(child.renderable).toBe(true);
    expect(hiddenBy(view, "alpha")).toBe(true);
  });

  it.each<HiddenReason>([
    "cover",
    "freeze",
    "kept"
  ])("%s of a text with children hides its whole subtree", reason => {
    const { hctx, state } = alone();
    const view = held(state, 1, "adapter", new pixi.Container());

    setHidden(hctx, 1, view, reason, true);

    expect(view.wrapper?.renderable).toBe(false);
    expect(view.object.renderable).toBe(true);
    expect(hiddenBy(view, reason)).toBe(true);
  });

  it("a Display view takes no empty and no alpha, and the subtree reasons hide its top", () => {
    const { hctx, state, demand } = alone();
    const view = held(state, 1, "Display");

    setHidden(hctx, 1, view, "empty", true);
    setHidden(hctx, 1, view, "alpha", true);

    expect(view.object.renderable).toBe(true);
    expect(view.hiddenSelf + view.hiddenTop).toBe(0);
    expect(demand.mark).not.toHaveBeenCalled();

    setHidden(hctx, 1, view, "cover", true);

    expect(view.object.renderable).toBe(false);
  });

  it("a change marks the entity before the write; the same reason again writes and marks nothing", () => {
    const { hctx, state, demand } = alone();
    const view = held(state, 7, "Sprite");
    const seen: boolean[] = [];
    const writes = vi.spyOn(view.object, "renderable", "set");

    demand.mark.mockImplementation(() => seen.push(view.object.renderable));
    setHidden(hctx, 7, view, "cover", true);

    expect(demand.mark).toHaveBeenCalledWith(7);
    expect(seen).toEqual([true]);
    expect(view.object.renderable).toBe(false);

    setHidden(hctx, 7, view, "cover", true);
    setHidden(hctx, 7, view, "freeze", false);

    expect(demand.mark).toHaveBeenCalledTimes(1);

    // A second reason changes the mask and marks, but the object is hidden already: no write.
    setHidden(hctx, 7, view, "freeze", true);

    expect(demand.mark).toHaveBeenCalledTimes(2);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it("swapHidden changes the mask and renderable and marks nothing", () => {
    const { hctx, state, demand } = alone();
    const view = held(state, 1, "Sprite", new pixi.Container());

    swapHidden(hctx, view, "kept", true);

    expect(view.wrapper?.renderable).toBe(false);
    expect(hiddenBy(view, "kept")).toBe(true);

    swapHidden(hctx, view, "kept", false);

    expect(view.wrapper?.renderable).toBe(true);
    expect(view.hiddenTop).toBe(0);
    expect(demand.mark).not.toHaveBeenCalled();
    expect(demand.whole).not.toHaveBeenCalled();
  });

  it("a layer container and an engine object are hidden by their own masks and mark the whole frame", () => {
    const { hctx, state, demand } = alone();
    const container = new pixi.Container();
    const dim = new pixi.Graphics();
    const seen: boolean[] = [];

    state.layers.set("board", { container, sort: "none", hidden: 0 });
    demand.whole.mockImplementation(() => seen.push(container.renderable));
    setLayerHidden(hctx, "board", "cover", true);
    setLayerHidden(hctx, "board", "cover", true);
    setLayerHidden(hctx, "sky", "cover", true);

    expect(demand.whole.mock.calls).toEqual([["overlay"]]);
    expect(seen).toEqual([true]);
    expect(container.renderable).toBe(false);
    expect(layerHiddenBy(hctx, "board", "cover")).toBe(true);
    expect(layerHiddenBy(hctx, "board", "freeze")).toBe(false);

    setLayerHidden(hctx, "board", "freeze", true);
    setLayerHidden(hctx, "board", "cover", false);

    expect(container.renderable).toBe(false);

    setLayerHidden(hctx, "board", "freeze", false);

    expect(container.renderable).toBe(true);

    demand.whole.mockClear();
    setObjectHidden(hctx, dim, "cover", true);
    setObjectHidden(hctx, dim, "freeze", true);
    setObjectHidden(hctx, dim, "cover", false);

    expect(dim.renderable).toBe(false);
    expect(onlyHiddenBy(hctx, dim, "freeze")).toBe(true);

    setObjectHidden(hctx, dim, "freeze", false);
    setObjectHidden(hctx, dim, "freeze", false);

    expect(dim.renderable).toBe(true);
    expect(demand.whole).toHaveBeenCalledTimes(4);
    expect(demand.mark).not.toHaveBeenCalled();
  });

  it("a layer's mask survives syncLayers for a container that stays, and a new container starts at 0", async () => {
    const { drawn, hctx, state } = await running();
    const items = state.layers.get("items")?.container;

    setLayerHidden(hctx, "items", "cover", true);
    drawn.frame();
    drawn.mock.world.projection.setLayers([
      { name: "items", sort: "order" },
      { name: "lift", sort: "none" }
    ]);
    drawn.frame();

    expect(state.layers.get("items")?.container).toBe(items);
    expect(state.layers.get("items")?.hidden).toBe(4);
    expect(items?.renderable).toBe(false);
    expect(layerHiddenBy(hctx, "lift", "cover")).toBe(false);
    expect(state.layers.get("lift")?.container?.renderable).toBe(true);

    setLayerHidden(hctx, "items", "cover", false);
    drawn.frame();

    expect(items?.renderable).toBe(true);
  });

  it("liftFor draws an entry hidden by freeze, keeps one also hidden by cover hidden, hides the others for the call, and restores every node from its mask without a mark, also when draw throws", () => {
    const { hctx, state, demand } = alone();
    const frozen = held(state, 1, "Sprite");
    const covered = held(state, 2, "Sprite");
    const other = held(state, 3, "Sprite");
    const parent = held(state, 4, "Shape", new pixi.Container());
    const layer = new pixi.Container();
    const quad = new pixi.Sprite();

    state.layers.set("board", { container: layer, sort: "none", hidden: 0 });
    setHidden(hctx, 1, frozen, "freeze", true);
    setHidden(hctx, 2, covered, "freeze", true);
    setHidden(hctx, 2, covered, "cover", true);
    setHidden(hctx, 4, parent, "empty", true);
    setLayerHidden(hctx, "board", "freeze", true);
    setObjectHidden(hctx, quad, "freeze", true);
    demand.mark.mockClear();
    demand.whole.mockClear();

    const lift = [frozen.object, covered.object, layer, quad, parent.wrapper ?? parent.object];
    const hide = [other.object, parent.object];
    const during: boolean[] = [];
    const picture = liftFor(hctx, lift, hide, "freeze", () => {
      during.push(...[...lift, ...hide].map(node => node.renderable));

      return "picture";
    });

    expect(picture).toBe("picture");
    expect(during).toEqual([true, false, true, true, true, false, false]);

    const restored = (): boolean[] => [...lift, ...hide].map(node => node.renderable);

    expect(restored()).toEqual([false, false, false, false, true, true, false]);
    expect(() =>
      liftFor(hctx, lift, hide, "freeze", () => {
        throw new Error("lost device");
      })
    ).toThrow("lost device");
    expect(restored()).toEqual([false, false, false, false, true, true, false]);
    expect(demand.mark).not.toHaveBeenCalled();
    expect(demand.whole).not.toHaveBeenCalled();
    expect(onlyHiddenBy(hctx, frozen.object, "freeze")).toBe(true);
    expect(onlyHiddenBy(hctx, covered.object, "freeze")).toBe(false);
    expect(onlyHiddenBy(hctx, layer, "freeze")).toBe(true);
  });

  it("a pooled object comes back renderable", async () => {
    const { drawn, hctx, state } = await running();
    const first = drawn.spawn(Transform(), Sprite({ texture: "board.cell" }));
    const game = new pixi.Container();
    const own = new pixi.Container();
    const shown = drawn.spawn(Transform(), Display({ object: game }));
    const mine = drawn.spawn(Transform(), Display({ object: own }));

    drawn.frame();
    // The game hid this object itself: the engine never hid it, so it hands it back as it was.
    own.renderable = false;

    const object = viewIn(state, first).object;

    setHidden(hctx, first, viewIn(state, first), "cover", true);
    setHidden(hctx, shown, viewIn(state, shown), "freeze", true);
    drawn.frame();
    drawn.mock.world.ecs.despawn(first);
    drawn.mock.world.ecs.despawn(shown);
    drawn.mock.world.ecs.despawn(mine);
    drawn.frame();

    expect(object.renderable).toBe(true);
    expect(game.renderable).toBe(true);
    expect(own.renderable).toBe(false);

    const second = drawn.spawn(Transform(), Sprite({ texture: "board.cell" }));

    drawn.frame();

    expect(viewIn(state, second).object).toBe(object);
    expect(object.renderable).toBe(true);
    expect(viewIn(state, second).hiddenTop).toBe(0);
  });

  it("a device restore and a stop hand a game's Display object back drawn", async () => {
    const { drawn, hctx, state } = await running();
    const object = new pixi.Container();
    const entity = drawn.spawn(Transform(), Display({ object }));

    drawn.frame();
    setHidden(hctx, entity, viewIn(state, entity), "cover", true);
    drawn.mock.modules.sync.rebuildAll();

    expect(object.renderable).toBe(true);
    expect(viewIn(state, entity).hiddenTop).toBe(0);

    setHidden(hctx, entity, viewIn(state, entity), "freeze", true);
    drawn.mock.stop();

    expect(object.renderable).toBe(true);
  });

  it("clearHidden zeroes both masks and draws the view again", () => {
    const { hctx, state } = alone();
    const view = held(state, 1, "Sprite", new pixi.Container());

    setHidden(hctx, 1, view, "empty", true);
    setHidden(hctx, 1, view, "cover", true);
    clearHidden(view);

    expect([view.hiddenSelf, view.hiddenTop]).toEqual([0, 0]);
    expect([view.object.renderable, view.wrapper?.renderable]).toEqual([true, true]);
  });
});
