import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderer api", () => {
  it("groups the API by module", () => {
    const mock = createMockRenderer({ dom: false });

    expect(Object.keys(mock.api).toSorted()).toEqual(["host", "sync", "viewport"]);
    expect(Object.keys(mock.api.host).toSorted()).toEqual(["canvas", "kind", "pixi", "ready"]);
    expect(Object.keys(mock.api.sync).toSorted()).toEqual([
      "displayOf",
      "displays",
      "fonts",
      "hitTest",
      "textures"
    ]);
    expect(Object.keys(mock.api.sync.textures).toSorted()).toEqual([
      "create",
      "destroy",
      "invalidate",
      "provide"
    ]);
    expect(Object.keys(mock.api.sync.displays)).toEqual(["provide"]);
    expect(Object.keys(mock.api.sync.fonts).toSorted()).toEqual(["install", "installed"]);
  });

  it("answers nothing about a renderer that never started", () => {
    const mock = createMockRenderer({ dom: false });

    expect(mock.api.host.ready()).toBe(false);
    expect(mock.api.host.kind()).toBe("none");
    expect(mock.api.host.canvas()).toBeUndefined();
    expect(mock.api.sync.hitTest(10, 10, () => true)).toBeUndefined();
    expect(mock.api.sync.displayOf(1)).toBeUndefined();
  });

  it("maps a pointer to itself while inert", () => {
    const mock = createMockRenderer({ dom: false });

    expect(mock.api.viewport.toReference(120, 340)).toEqual({ x: 120, y: 340 });
  });

  it("answers the aspect.min frame while inert", () => {
    const mock = createMockRenderer({ dom: false });

    expect(mock.api.viewport.size()).toEqual({
      width: 1080,
      height: 1440,
      scale: 1,
      orientation: "portrait",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
    });
  });

  it("turns the aspect.min frame round for a landscape game", () => {
    const mock = createMockRenderer({ dom: false, orientation: "landscape" });

    expect(mock.api.viewport.size()).toEqual({
      width: 1440,
      height: 1080,
      scale: 1,
      orientation: "landscape",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
    });
  });

  it("returns a fresh size object every call", () => {
    const mock = createMockRenderer({ dom: false });

    expect(mock.api.viewport.size()).not.toBe(mock.api.viewport.size());
  });

  it("takes texture providers while inert and removes them once", () => {
    const mock = createMockRenderer({ dom: false });
    const off = mock.api.sync.textures.provide(() => undefined);

    expect(mock.ctx.state.sync.providers).toHaveLength(1);
    off();
    off();
    expect(mock.ctx.state.sync.providers).toHaveLength(0);
  });

  it("refuses to make a texture while nothing can draw", () => {
    const mock = createMockRenderer({ dom: false });

    expect(() => mock.api.sync.textures.create({ width: 8, height: 8 } as never)).toThrow(
      "[game] renderer.sync.textures.create needs a ready renderer.\n" +
        "  Check app.renderer.host.ready() first."
    );
  });

  it("invalidates nothing while inert", () => {
    const mock = createMockRenderer({ dom: false });

    mock.api.sync.textures.invalidate(["board.cell"]);

    expect(mock.ctx.state.sync.invalidated.size).toBe(0);
  });
});
