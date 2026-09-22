import { afterEach, describe, expect, it, vi } from "vitest";
import { clipToFrame, createSafeAreaProbe, readInsets } from "../../viewport/safe-area";
import { installFakeDom } from "../fake-dom";

afterEach(() => {
  vi.unstubAllGlobals();
});

const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe("viewport safe area", () => {
  it("reads the four paddings of the probe", () => {
    const dom = installFakeDom();

    dom.insets.top = 47;
    dom.insets.bottom = 34;

    const probe = dom.document.createElement("div");

    expect(readInsets(probe as unknown as HTMLElement)).toEqual({
      top: 47,
      right: 0,
      bottom: 34,
      left: 0
    });
  });

  it("makes no probe where there is no document", () => {
    expect(createSafeAreaProbe()).toBeUndefined();
  });

  it("reads zero when the browser answers nothing", () => {
    const dom = installFakeDom();
    const probe = dom.document.createElement("div");

    vi.stubGlobal("getComputedStyle", () => ({}));
    expect(readInsets(probe as unknown as HTMLElement)).toEqual(noInsets);

    vi.stubGlobal("getComputedStyle", undefined);
    expect(readInsets(probe as unknown as HTMLElement)).toEqual(noInsets);
  });

  it("reads zero when there is no probe", () => {
    expect(readInsets(undefined)).toEqual(noInsets);
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
});
