import { describe, expect, it, vi } from "vitest";
import { Pressed } from "../../../input/components";
import type { ViewportSize } from "../../../renderer/viewport/types";
import { Box, LocalWrite } from "../../components";
import { asError, asHandle, asTagHandle } from "../../errors";
import { forgetInstances } from "../../jsx/instances";
import { Fragment, jsx } from "../../jsx/runtime";
import { createJsxState } from "../../jsx/state";
import { applyTap } from "../../jsx/tap";
import type { Element, Instance } from "../../jsx/types";
import { beginExit } from "../../layout/exit";
import { rectOfTarget } from "../../layout/guide";
import { createNode, detachNode, freeNode, placeChildren } from "../../layout/nodes";
import { solveRoot } from "../../layout/solve";
import { createLayoutState } from "../../layout/state";
import { createStylesApi } from "../../styles/api";
import type { UiCtx } from "../../types";

/**
 * Builds the smallest element the layout helpers need.
 *
 * @param patch - What to change about it.
 * @returns The element.
 */
function elementOf(patch: Partial<Element> = {}): Element {
  return {
    entity: 1,
    identity: "0|row@0|row",
    type: "row",
    key: "bar",
    parentType: undefined,
    root: 0,
    node: { type: "row", props: {}, children: [] },
    style: {},
    is: { pressed: false, disabled: false, active: false, selected: false },
    rect: { x: 0, y: 0, w: 0, h: 0 },
    previous: { x: 0, y: 0, w: 0, h: 0 },
    moved: false,
    handles: [],
    motion: undefined,
    parent: undefined,
    children: [],
    instance: undefined,
    live: false,
    dropKey: undefined,
    ...patch
  };
}

// ─── the two conversions ──────────────────────────────────────

describe("errors", () => {
  it("keeps an Error and wraps anything else", () => {
    const thrown = new Error("boom");

    expect(asError(thrown)).toBe(thrown);
    expect(asError("boom").message).toBe("boom");
  });

  it("reads a component and a tag as the handle the ecs takes", () => {
    expect(asHandle(Box).componentName).toBe("Box");
    expect(asTagHandle(Pressed).componentName).toBe("Pressed");
  });
});

// ─── the Yoga lifetime before the module is there ─────────────

describe("the node lifetime while Yoga is still loading", () => {
  it("creates nothing and touches nothing", () => {
    const state = createLayoutState();
    const element = elementOf();

    expect(createNode(state, element)).toBeUndefined();
    expect(state.nodes).toBe(0);

    detachNode(state, element);
    freeNode(state, element);
    placeChildren(state, element, [elementOf({ entity: 2 })]);

    expect(state.byEntity.size).toBe(0);
  });

  it("solves nothing without a root node", () => {
    const state = createLayoutState();

    expect(solveRoot(state, elementOf(), { x: 0, y: 0, w: 100, h: 100 }, () => undefined)).toBe(
      false
    );
    expect(state.solves).toBe(0);
  });
});

// ─── exit of an element that never went live ──────────────────

describe("beginExit", () => {
  it("drops the key registration and tags nothing when the element never went live", () => {
    const state = createLayoutState();
    const drop = vi.fn();
    const tag = vi.fn();
    const ctx = { deps: { world: { ecs: { tag } } } } as unknown as UiCtx;

    beginExit(ctx, state, elementOf({ dropKey: drop, live: false }));

    expect(drop).toHaveBeenCalledOnce();
    expect(tag).not.toHaveBeenCalled();
  });
});

/**
 * Builds a context whose ecs answers with the components of one entity.
 *
 * @param components - Component name to stored value.
 * @returns The context the guide reads.
 */
function ctxWith(components: Record<string, object>): UiCtx {
  return {
    deps: {
      world: {
        ecs: {
          get: (_entity: number, component: { componentName: string }) =>
            components[component.componentName],
          has: (_entity: number, component: { componentName: string }) =>
            components[component.componentName] !== undefined
        }
      }
    }
  } as unknown as UiCtx;
}

/**
 * Builds the context `applyTap` reads, with one element and one stored write.
 *
 * @param element - The element the tap landed on.
 * @param write - What `LocalWrite` holds, or nothing.
 * @param warn - The spy the warning lands in.
 * @returns The context.
 */
function tapCtx(element: Element, write: object | undefined, warn: () => void): UiCtx {
  const state = createJsxState();

  state.elements.set(element.entity, element);

  return {
    state: { jsx: state },
    log: { warn },
    deps: {
      world: { ecs: { get: () => write } },
      time: { wake: () => undefined }
    }
  } as unknown as UiCtx;
}

/**
 * Builds one component instance record.
 *
 * @param identity - The identity it is kept under.
 * @returns The instance.
 */
function instanceOf(identity: string): Instance {
  return { identity, component: "Panel", local: {}, props: {}, dirty: false };
}

// ─── the rect a guide cuts its hole over ──────────────────────

describe("rectOfTarget", () => {
  it("reads the Box of a ui element", () => {
    const ctx = ctxWith({ Box: { x: 1, y: 2, w: 3, h: 4 } });

    expect(rectOfTarget(ctx, 1)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("reads the transform and the size of a panel", () => {
    const ctx = ctxWith({
      Transform: { x: 10, y: 20 },
      NineSlice: { texture: "ui.panel", width: 30, height: 40 }
    });

    expect(rectOfTarget(ctx, 1)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it("reads the transform of a sprite and answers nothing for a view with no size", () => {
    expect(rectOfTarget(ctxWith({ Transform: { x: 5, y: 6 }, Sprite: {} }), 1)).toEqual({
      x: 5,
      y: 6,
      w: 0,
      h: 0
    });
    expect(rectOfTarget(ctxWith({ Transform: { x: 5, y: 6 } }), 1)).toBeUndefined();
    expect(rectOfTarget(ctxWith({}), 1)).toBeUndefined();
  });
});

// ─── styles before the first viewport ─────────────────────────

describe("the styles module before a frame ran", () => {
  it("resolves against a zero viewport and takes the first one it sees", () => {
    const ctx = {
      config: { tapTargetPt: 44, breakpoints: { tall: 2, wide: 1.5 } },
      state: {
        styles: {
          flags: { portrait: true, landscape: false, tall: false, wide: false },
          viewport: undefined
        }
      }
    } as unknown as UiCtx;
    const styles = createStylesApi(ctx);
    const viewport: ViewportSize = {
      width: 1080,
      height: 1920,
      scale: 1,
      orientation: "portrait",
      safeArea: { top: 7, right: 0, bottom: 0, left: 0 }
    };

    expect(styles.viewport()).toBeUndefined();
    expect(
      styles.resolveElement({ padding: "safeArea.top" }, ctx.state.styles.flags as never)
    ).toEqual({
      padding: 0
    });
    expect(styles.useViewport(viewport)).toBe(true);
    expect(styles.useViewport(viewport)).toBe(false);
    expect(styles.viewport()).toBe(viewport);
  });
});

// ─── a local write with nowhere to go ─────────────────────────

describe("applyTap", () => {
  it("warns when the button stands outside every component", () => {
    const warn = vi.fn();
    const element = elementOf({ type: "button", key: "stray", live: true });

    applyTap(tapCtx(element, { patch: { tab: "video" } }, warn), element.entity);

    expect(warn).toHaveBeenCalledWith("ui:local-write-without-component", { key: "stray" });
  });

  it("does nothing for an unknown entity, a disabled button or a button with no write", () => {
    const warn = vi.fn();
    const element = elementOf({ type: "button", live: true });

    applyTap(tapCtx(element, undefined, warn), element.entity);
    applyTap(tapCtx(element, { patch: {} }, warn), 999);
    applyTap(
      tapCtx(
        elementOf({
          type: "button",
          is: { pressed: false, disabled: true, active: false, selected: false }
        }),
        { patch: {} },
        warn
      ),
      1
    );

    expect(warn).not.toHaveBeenCalled();
    expect(LocalWrite.componentName).toBe("LocalWrite");
  });
});

// ─── instances of a subtree that left ─────────────────────────

describe("forgetInstances", () => {
  it("drops the instance of the identity and of everything under it", () => {
    const state = createJsxState();

    state.instances.set("0|a|Panel", instanceOf("0|a|Panel"));
    state.instances.set("0|a|Panel|b|Row", instanceOf("0|a|Panel|b|Row"));
    state.instances.set("0|c|Panel", instanceOf("0|c|Panel"));

    forgetInstances(state, "0|a|Panel");

    expect([...state.instances.keys()]).toEqual(["0|c|Panel"]);
  });
});

// ─── a plain function component with several roots ────────────

describe("the runtime with a function that returns many nodes", () => {
  it("lifts the results into the parent", () => {
    const Many = () => [jsx("row", {}), jsx("text", {})];
    const node = jsx("column", { children: jsx(Many, {}) });

    expect(node.children.map(child => child.type)).toEqual(["row", "text"]);
  });

  it("builds a fragment when it is called directly", () => {
    expect(Fragment({ children: ["a", "b"] }).children).toHaveLength(2);
  });
});
