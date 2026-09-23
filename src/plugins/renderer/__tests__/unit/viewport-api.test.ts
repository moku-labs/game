import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function started(
  options: Parameters<typeof createMockRenderer>[0] & {
    insets?: Partial<Record<"top" | "right" | "bottom" | "left", number>>;
  }
): Promise<MockRenderer> {
  const mock = createMockRenderer(options);

  Object.assign(mock.dom?.insets ?? {}, options.insets);
  await mock.start();

  return mock;
}

describe("viewport size: both sides fit", () => {
  it("grows the reference width of a 768x1024 tablet, so the column keeps its height", async () => {
    const mock = await started({ width: 768, height: 1024 });
    const size = mock.api.viewport.size();

    expect(size.scale).toBeCloseTo(0.5333, 4);
    expect(size.width).toBeCloseTo(1440, 6);
    expect(size.height).toBeCloseTo(1920, 6);
    expect(mock.ctx.state.sync.root?.scale.x).toBeCloseTo(0.5333, 4);
  });

  it("fits the long side inside the safe area, and reports the safe area in the new units", async () => {
    const mock = await started({
      width: 375,
      height: 667,
      referenceLong: 2080,
      insets: { top: 20 }
    });
    const size = mock.api.viewport.size();

    expect(size.scale).toBeCloseTo(0.3111, 4);
    expect(size.width).toBeCloseTo(1205.6, 1);
    expect(size.safeArea.top).toBeCloseTo(64.3, 1);
    // What the layout gets between the insets is exactly the long side it asked for.
    expect(size.height - size.safeArea.top - size.safeArea.bottom).toBeCloseTo(2080, 6);
  });

  it("counts an inset only where it reaches into the frame", async () => {
    // A portrait game in a tall window: the frame starts 240 px down, below the 47 px notch.
    const mock = await started({ width: 1080, height: 3000, insets: { top: 47 } });
    const size = mock.api.viewport.size();

    expect(size.scale).toBe(1);
    expect(size.safeArea.top).toBe(0);
  });

  it("keeps the width of a phone that is narrow for its height", async () => {
    const mock = await started({ width: 390, height: 844 });
    const size = mock.api.viewport.size();

    expect(size.width).toBeCloseTo(1080, 6);
    expect(size.scale).toBeCloseTo(390 / 1080, 6);
  });
});

describe("viewport toScreen: reference units to client CSS pixels", () => {
  it("scales a point of a 390x844 phone into the page", async () => {
    const mock = await started({ width: 390, height: 844 });
    const point = mock.api.viewport.toScreen({ x: 540, y: 960 });

    expect(point.x).toBeCloseTo(195, 6);
    expect(point.y).toBeCloseTo(346.6667, 4);
  });

  it("adds the frame offset of the bars and the place of the canvas on the page", async () => {
    // A portrait game in a 1920x1080 window: an 810x1080 frame, 555 px of bar on the left.
    const mock = await started({ width: 1920, height: 1080 });

    mock.pixi.last().canvas.rect = { left: 10, top: 20, width: 1920, height: 1080 };

    expect(mock.api.viewport.toScreen({ x: 0, y: 0 })).toEqual({ x: 565, y: 20 });
    expect(mock.api.viewport.toScreen({ x: 720, y: 960 })).toEqual({ x: 970, y: 560 });
  });

  it("is the inverse of toReference", async () => {
    const mock = await started({ width: 1920, height: 1080 });

    mock.pixi.last().canvas.rect = { left: 10, top: 20, width: 1920, height: 1080 };

    const screen = mock.api.viewport.toScreen({ x: 312, y: 1480 });
    const back = mock.api.viewport.toReference(screen.x, screen.y);

    expect(back.x).toBeCloseTo(312, 9);
    expect(back.y).toBeCloseTo(1480, 9);
  });

  it("is the identity over reference units while inert, as a fresh object", () => {
    const mock = createMockRenderer({ dom: false });
    const point = { x: 120, y: 340 };
    const screen = mock.api.viewport.toScreen(point);

    expect(screen).toEqual({ x: 120, y: 340 });
    expect(screen).not.toBe(point);
  });
});
