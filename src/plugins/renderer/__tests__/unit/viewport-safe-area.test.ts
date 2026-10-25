import { afterEach, describe, expect, it, vi } from "vitest";
import { watchSafeArea } from "../../viewport/resize";
import { clipToFrame, createSafeAreaProbes, readInsets } from "../../viewport/safe-area";
import { createViewportState } from "../../viewport/state";
import type { SafeAreaProbes, ViewportCtx } from "../../viewport/types";
import { installFakeDom } from "../fake-dom";

afterEach(() => {
  vi.unstubAllGlobals();
});

const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Creates the two probes on the fake document.
 *
 * @returns The probes; the test fails without a document.
 */
function probes(): SafeAreaProbes {
  const created = createSafeAreaProbes();

  if (created === undefined) throw new Error("the fake document made no probes");

  return created;
}

describe("viewport safe area", () => {
  it("reads top and left from the start probe and right and bottom from the end probe", () => {
    const dom = installFakeDom();

    Object.assign(dom.insets, { top: 47, right: 12, bottom: 34, left: 5 });

    expect(readInsets(probes())).toEqual({ top: 47, right: 12, bottom: 34, left: 5 });
  });

  it("declares each inset as its custom property with the env() fallback", () => {
    installFakeDom();

    const { start, end } = probes();

    expect(start.style.width).toBe(
      "var(--moku-safe-left, var(--moku-device-safe-left, env(safe-area-inset-left, 0px)))"
    );
    expect(start.style.height).toBe(
      "var(--moku-safe-top, var(--moku-device-safe-top, env(safe-area-inset-top, 0px)))"
    );
    expect(end.style.width).toBe(
      "var(--moku-safe-right, var(--moku-device-safe-right, env(safe-area-inset-right, 0px)))"
    );
    expect(end.style.height).toBe(
      "var(--moku-safe-bottom, var(--moku-device-safe-bottom, env(safe-area-inset-bottom, 0px)))"
    );
  });

  it("makes no probe and watches nothing where there is no document", () => {
    const state = createViewportState();
    const vctx = { ctx: { state: { viewport: state } } } as unknown as ViewportCtx;

    state.probes = createSafeAreaProbes();
    watchSafeArea(vctx);

    expect(state.probes).toBeUndefined();
    expect(state.cleanups).toHaveLength(0);
    expect(readInsets(state.probes)).toEqual(noInsets);
  });

  it("reads zero when the browser answers nothing or has no getComputedStyle", () => {
    installFakeDom();

    const both = probes();

    vi.stubGlobal("getComputedStyle", () => ({}));
    expect(readInsets(both)).toEqual(noInsets);

    vi.stubGlobal("getComputedStyle", undefined);
    expect(readInsets(both)).toEqual(noInsets);
  });

  it("divides the overlapping part by the scale", () => {
    const frame = { x: 0, y: 0, width: 810, height: 1080 };

    expect(
      clipToFrame({
        insets: { top: 47, right: 0, bottom: 34, left: 0 },
        frame,
        canvas: { left: 0, top: 0 },
        window: { width: 810, height: 1080 },
        scale: 0.5
      })
    ).toEqual({ top: 94, right: 0, bottom: 68, left: 0 });
  });

  it("drops an inset the bars already cover", () => {
    const frame = { x: 555, y: 0, width: 810, height: 1080 };

    expect(
      clipToFrame({
        insets: { top: 0, right: 0, bottom: 0, left: 20 },
        frame,
        canvas: { left: 0, top: 0 },
        window: { width: 1920, height: 1080 },
        scale: 1
      }).left
    ).toBe(0);
  });

  it("keeps the part of an inset that reaches into the frame", () => {
    const frame = { x: 10, y: 0, width: 800, height: 1080 };

    expect(
      clipToFrame({
        insets: { top: 0, right: 0, bottom: 0, left: 30 },
        frame,
        canvas: { left: 0, top: 0 },
        window: { width: 810, height: 1080 },
        scale: 1
      }).left
    ).toBe(20);
  });

  it("answers zero for a frame with no size", () => {
    expect(
      clipToFrame({
        insets: { top: 47, right: 0, bottom: 34, left: 0 },
        frame: { x: 0, y: 0, width: 0, height: 0 },
        canvas: { left: 0, top: 0 },
        window: { width: 0, height: 0 },
        scale: 0
      })
    ).toEqual(noInsets);
  });

  // Found by A Memory Missing's headless page: measured against a 0 × 0 window the whole frame was
  // unsafe, so every grow area laid out at height 0 and views counted as off screen.
  it("cuts nothing on a page with no window size", () => {
    expect(
      clipToFrame({
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        frame: { x: 0, y: 0, width: 390, height: 844 },
        canvas: { left: 0, top: 0 },
        window: { width: 0, height: 0 },
        scale: 1
      })
    ).toEqual(noInsets);
  });
});
