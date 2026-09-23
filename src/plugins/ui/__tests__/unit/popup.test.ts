import { describe, expect, it, vi } from "vitest";
import { popup } from "../../components";
import { defineComponent } from "../../jsx/component";
import { coverPopup, flowRests, releasePopup, settlePopups } from "../../jsx/popups";
import { createJsxState } from "../../jsx/state";
import type { PopupLink, Root } from "../../jsx/types";
import { readPayload } from "../../layout/popup";
import type { UiCtx } from "../../types";

// ─── `over`: the popup kept beneath ───────────────────────────

describe("popup options", () => {
  const Confirm = defineComponent("Confirm", {
    outcomes: { reset: {}, cancel: {} },
    view: () => ({ type: "panel", props: {}, children: [] })
  });

  it("puts the component kept beneath into the payload", () => {
    expect(popup(Confirm, {}, { over: "Settings" })).toEqual({
      kind: "popup",
      payload: { component: "Confirm", props: {}, over: "Settings" },
      answers: ["reset", "cancel"]
    });
  });

  it("leaves the payload without over when no option names one", () => {
    expect(popup(Confirm, {}, {}).payload).toStrictEqual({ component: "Confirm", props: {} });
    expect(popup(Confirm, {}).payload).toStrictEqual({ component: "Confirm", props: {} });
  });

  it("reads over back out of the payload, and nothing when it is not a string", () => {
    expect(readPayload({ component: "Confirm", props: {}, over: "Settings" }).over).toBe(
      "Settings"
    );
    expect(readPayload({ component: "Confirm", props: {}, over: 3 })).toStrictEqual({
      component: "Confirm",
      props: {}
    });
  });
});

// ─── the popup roots on their own ─────────────────────────────

/**
 * Builds the context the root functions read, with a spy on the log.
 *
 * @returns The context, the jsx state and the warn spy.
 */
function parts() {
  const state = createJsxState();
  const warn = vi.fn();
  const ctx = {
    log: { warn },
    deps: {
      world: { ecs: { tag: vi.fn(), untag: vi.fn() } },
      time: { wake: vi.fn() },
      flow: { state: () => ({ running: false, path: "", stack: [], pending: {}, mode: "live" }) }
    }
  } as unknown as UiCtx;

  return { ctx, state, warn };
}

describe("popup roots", () => {
  it("warns and covers nothing when over names no mounted popup", () => {
    const { ctx, state, warn } = parts();

    state.roots.set(5, rootOf({ entity: 5, name: "Confirm", popup: { close: vi.fn() } }));
    coverPopup(ctx, state, "Settings", 5);

    expect(warn).toHaveBeenCalledWith("ui:popup-over-missing", { over: "Settings" });
    expect(state.roots.get(5)?.popup?.over).toBeUndefined();
  });

  it("uncovers a live popup whose coverer is gone, and never unmounts it", () => {
    const { ctx, state } = parts();
    const unmount = vi.fn();

    state.roots.set(
      3,
      rootOf({ entity: 3, name: "Settings", covered: true, popup: { close: vi.fn() } })
    );
    settlePopups(ctx, state, unmount);

    expect(state.roots.get(3)?.covered).toBe(false);
    expect(unmount).not.toHaveBeenCalled();
  });

  it("ignores the abort of a handler that no longer owns the root", () => {
    const { ctx, state } = parts();
    const stale: PopupLink = { close: vi.fn() };

    state.roots.set(3, rootOf({ entity: 3, name: "Settings", popup: { close: vi.fn() } }));
    releasePopup(ctx, state, 3, stale);

    expect(stale.released).toBeUndefined();
    expect(state.roots.get(3)?.popup?.released).toBeUndefined();
  });

  it("counts a stopped loop, an empty stack and an open gate as rest", () => {
    const base = {
      running: true,
      path: "a",
      stack: [{ flow: "main", node: "a", input: {} }],
      mode: "live"
    } as const;

    expect(flowRests({ ...base, pending: {} })).toBe(false);
    expect(flowRests({ ...base, pending: { gate: ["play"] } })).toBe(true);
    expect(flowRests({ ...base, running: false, pending: {} })).toBe(true);
    expect(flowRests({ ...base, stack: [], pending: {} })).toBe(true);
  });
});

/**
 * Builds one root record.
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
