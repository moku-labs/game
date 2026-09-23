import { describe, expect, it, vi } from "vitest";
import { createJsxState } from "../../jsx/state";
import { readTree, sortedRoots } from "../../jsx/tree";
import type { Element, JsxModule, Root } from "../../jsx/types";
import { createPopupHandler } from "../../layout/popup";
import { stepScroll } from "../../layout/scroll";
import { createLayoutState } from "../../layout/state";
import type { UiCtx } from "../../types";

/**
 * Builds one root record for the order tests.
 *
 * @param patch - What to change about it.
 * @returns The root.
 */
function rootOf(patch: Partial<Root>): Root {
  return {
    entity: 1,
    name: "hud",
    tree: { type: "row", props: {}, children: [] },
    layer: "ui",
    order: 0,
    dirty: false,
    needsSolve: false,
    element: undefined,
    popup: undefined,
    covered: false,
    ...patch
  };
}

/**
 * Builds one element record for the scroll tests.
 *
 * @param patch - What to change about it.
 * @returns The element.
 */
function elementOf(patch: Partial<Element>): Element {
  return {
    entity: 1,
    identity: "0|listBox@0|scroll",
    type: "scroll",
    key: "listBox",
    parentType: undefined,
    root: 0,
    node: { type: "scroll", props: {}, children: [] },
    style: {},
    is: {
      pressed: false,
      hover: false,
      focus: false,
      disabled: false,
      active: false,
      selected: false,
      covered: false
    },
    rect: { x: 0, y: 0, w: 100, h: 100 },
    previous: { x: 0, y: 0, w: 0, h: 0 },
    moved: false,
    fit: 1,
    rest: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
    handles: [],
    motion: undefined,
    parent: undefined,
    children: [],
    instance: undefined,
    live: true,
    entered: true,
    dropKey: undefined,
    ...patch
  };
}

/** What a popup root calls when it is gone. */
function close(): void {
  // The tests only check the order of the roots, so nothing has to happen here.
}

/**
 * Builds the context the scroll step reads.
 *
 * @param pressed - Whether the container is under the finger.
 * @param stored - What `Scroll` holds, or nothing.
 * @param set - The spy every write lands in.
 * @returns The context.
 */
function scrollCtx(pressed: boolean, stored: object | undefined, set: () => void): UiCtx {
  return {
    deps: {
      world: {
        ecs: {
          resource: () => ({ x: 0, y: 0 }),
          get: () => stored,
          has: () => pressed,
          set
        }
      }
    }
  } as unknown as UiCtx;
}

/**
 * Builds the context and the jsx module the popup handler drives.
 *
 * @param registered - The component names the registry knows.
 * @returns The context, the module and the two spies.
 */
function popupParts(registered: readonly string[]) {
  const state = createJsxState();

  for (const name of registered) state.components.set(name, { name } as never);

  const mountRoot = vi.fn();
  const unmountRoot = vi.fn();
  const jsx = { mountRoot, unmountRoot } as unknown as JsxModule;
  const ctx = {
    state: { jsx: state },
    deps: {
      world: { ecs: { spawn: () => 7 } },
      time: { wake: () => undefined }
    }
  } as unknown as UiCtx;

  return { ctx, jsx, mountRoot, unmountRoot };
}

/**
 * Builds the context the layout module reads, with spies for the three writes.
 *
 * @returns The context and the spies.
 */
function layoutParts() {
  const set = vi.fn();
  const setRest = vi.fn();
  const error = vi.fn();
  const handle = {
    entity: 1,
    key: "",
    get: () => undefined,
    rest: () => undefined,
    set: vi.fn(),
    tween: vi.fn(),
    toRest: vi.fn(() => ({
      finish: () => undefined,
      cancel: () => undefined,
      active: () => true
    })),
    all: vi.fn(),
    peer: () => undefined
  };
  const ctx = {
    state: { layout: createLayoutState() },
    log: { error, warn: vi.fn() },
    deps: {
      text: { measure: () => ({ width: 10, height: 10 }) },
      world: {
        ecs: { set },
        projection: { setRest, viewOf: () => handle }
      }
    }
  } as unknown as UiCtx;

  return { ctx, set, setRest, error, handle };
}

// ─── the order the readers walk the roots in ──────────────────

describe("sortedRoots", () => {
  it("puts the popups first, the highest order of them first", () => {
    const state = createJsxState();

    state.roots.set(1, rootOf({ entity: 1, layer: "board" }));
    state.roots.set(2, rootOf({ entity: 2, layer: "ui" }));
    state.roots.set(3, rootOf({ entity: 3, order: 1, popup: { close } }));
    state.roots.set(4, rootOf({ entity: 4, order: 9, popup: { close } }));

    expect(sortedRoots(state, ["board", "ui"]).map(root => root.entity)).toEqual([4, 3, 1, 2]);
  });

  it("puts a root of an unknown layer last", () => {
    const state = createJsxState();

    state.roots.set(1, rootOf({ entity: 1, layer: "nowhere" }));
    state.roots.set(2, rootOf({ entity: 2, layer: "ui" }));

    expect(sortedRoots(state, ["ui"]).map(root => root.entity)).toEqual([2, 1]);
  });

  it("wraps several roots under one screen node", () => {
    const state = createJsxState();

    for (const entity of [1, 2]) {
      const element = elementOf({ entity, type: "row", key: `root${entity}` });

      state.elements.set(entity, element);
      state.roots.set(entity, rootOf({ entity, element: entity }));
    }

    const tree = readTree(state, ["ui"]);

    expect(tree.type).toBe("screen");
    expect(tree.children).toHaveLength(2);
  });
});

// ─── the scroll step without a content element ────────────────

describe("stepScroll", () => {
  it("does nothing for a container with no content and forgets a released one", () => {
    const state = createLayoutState();
    const set = vi.fn();
    const container = elementOf({ children: [] });

    stepScroll(
      scrollCtx(true, { axis: "y", offset: 0, min: 0 }, set),
      state,
      [container],
      () => undefined
    );

    expect(set).not.toHaveBeenCalled();

    state.scrolling = container.entity;
    stepScroll(
      scrollCtx(false, { axis: "y", offset: 0, min: 0 }, set),
      state,
      [elementOf({ children: [2] })],
      () => elementOf({ entity: 2 })
    );

    expect(state.scrolling).toBeUndefined();
  });

  it("does nothing when the container carries no Scroll", () => {
    const state = createLayoutState();
    const set = vi.fn();

    stepScroll(scrollCtx(true, undefined, set), state, [elementOf({ children: [2] })], () =>
      elementOf({ entity: 2 })
    );

    expect(set).not.toHaveBeenCalled();
  });
});

// ─── the popup handler on its own ─────────────────────────────

describe("createPopupHandler", () => {
  it("refuses a component no feature registered", () => {
    const { ctx, jsx } = popupParts([]);
    const handler = createPopupHandler(ctx, createLayoutState(), jsx);

    expect(() =>
      handler(
        { kind: "popup", payload: { component: "RewardPopup", props: {} } },
        { signal: new AbortController().signal, mode: "live" }
      )
    ).toThrow(
      '[game] Popup "RewardPopup" is not registered.\n  Add it to the ui key of a feature.'
    );
  });

  it("never mounts in fast mode", () => {
    const { ctx, jsx, mountRoot } = popupParts(["RewardPopup"]);
    const handler = createPopupHandler(ctx, createLayoutState(), jsx);

    expect(
      handler(
        { kind: "popup", payload: { component: "RewardPopup", props: {} } },
        { signal: new AbortController().signal, mode: "fast" }
      )
    ).toBeUndefined();
    expect(mountRoot).not.toHaveBeenCalled();
  });

  it("unmounts at once when the signal already aborted", () => {
    const { ctx, jsx, mountRoot, unmountRoot } = popupParts(["RewardPopup"]);
    const controller = new AbortController();

    controller.abort();

    const handler = createPopupHandler(ctx, createLayoutState(), jsx);

    handler(
      { kind: "popup", payload: { component: "RewardPopup", props: {} } },
      { signal: controller.signal, mode: "live" }
    );

    expect(mountRoot).toHaveBeenCalledOnce();
    expect(unmountRoot).toHaveBeenCalledWith(7);
  });
});

// ─── the layout module driven without Yoga ────────────────────

describe("createLayoutApi", () => {
  it("writes the Box of a live element and the rest of every element", async () => {
    const { ctx, set, setRest } = layoutParts();
    const { createLayoutApi } = await import("../../layout/api");
    const layout = createLayoutApi(ctx);

    layout.commit(elementOf({ live: false }), undefined);

    expect(set).not.toHaveBeenCalled();
    expect(setRest).toHaveBeenCalled();

    layout.commit(elementOf({ live: true }), { x: 0, y: 0, w: 0, h: 0 });

    expect(set).toHaveBeenCalledOnce();
  });

  it("plays the enter and change hooks and keeps their handles", async () => {
    const { ctx, handle } = layoutParts();
    const { createLayoutApi } = await import("../../layout/api");
    const layout = createLayoutApi(ctx);
    const moved = elementOf({
      motion: {
        enter: view => view.toRest({ componentName: "Transform" } as never),
        change: { Box: view => view.toRest({ componentName: "Transform" } as never) }
      }
    });

    layout.enter(moved);
    layout.change(moved, { x: 0, y: 0, w: 0, h: 0 });

    expect(handle.toRest).toHaveBeenCalledTimes(2);
    expect(moved.handles).toHaveLength(2);
    expect(layout.settled(moved)).toBe(false);
  });

  it("does nothing for an element with no hooks and reports a throwing one", async () => {
    const { ctx, error } = layoutParts();
    const { createLayoutApi } = await import("../../layout/api");
    const layout = createLayoutApi(ctx);
    const plain = elementOf({});

    layout.enter(plain);
    layout.change(plain, { x: 0, y: 0, w: 0, h: 0 });

    expect(plain.handles).toHaveLength(0);
    expect(layout.settled(plain)).toBe(true);

    layout.enter(
      elementOf({
        motion: {
          enter: () => {
            throw new Error("bad hook");
          }
        }
      })
    );

    expect(error).toHaveBeenCalledOnce();
    expect(layout.counters()).toEqual({ nodes: 0, measured: 0, solves: 0 });
    expect(layout.loaded()).toBe(false);
  });
});

// ─── how a finding names an element ───────────────────────────

describe("nameOf", () => {
  it("is the key, or the type when the markup wrote none", async () => {
    const { nameOf } = await import("../../jsx/lint");

    expect(nameOf(elementOf({ key: "claim" }))).toBe("claim");
    expect(nameOf(elementOf({ key: undefined, type: "button" }))).toBe("button");
  });
});

// ─── the component registry ───────────────────────────────────

describe("the component registry", () => {
  it("refuses a second component of the same name", async () => {
    const { createJsxApi } = await import("../../jsx/api");
    const ctx = {
      state: { jsx: createJsxState() },
      log: { warn: vi.fn(), error: vi.fn() },
      deps: {
        world: {
          ecs: { changed: () => [], resource: () => ({}) },
          projection: { layers: () => [] }
        },
        renderer: { viewport: { size: () => ({ scale: 1 }) } },
        time: { wake: () => undefined }
      }
    } as unknown as UiCtx;
    const jsx = createJsxApi(ctx, {
      styles: {
        flagsOf: vi.fn(),
        resolveElement: vi.fn(),
        viewport: vi.fn(),
        useViewport: vi.fn()
      },
      layout: { counters: () => ({ nodes: 0, measured: 0, solves: 0 }) } as never
    } as never);
    const Settings = { name: "Settings", isUiComponent: true } as never;

    jsx.register(Settings);

    expect(() => jsx.register(Settings)).toThrow(
      '[game] Component "Settings" is defined twice.\n  Use one defineComponent() call and import it.'
    );
    expect(jsx.find("nothing")).toBeUndefined();
    expect(jsx.tree().type).toBe("screen");
  });
});
