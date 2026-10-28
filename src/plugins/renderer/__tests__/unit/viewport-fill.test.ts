import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// F116: a phone with a fractional `devicePixelRatio` has a window of a fractional CSS size. The canvas covers it to
// the last device pixel on both axes, at any resolution, and the coordinate map reaches the same edge.

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Starts a renderer whose mount is a fractional CSS box. The browser rounds `clientWidth` and `clientHeight` to
 * whole CSS pixels; the box keeps the fractions.
 *
 * @param box - The CSS box of the mount.
 * @param box.width - Its CSS width.
 * @param box.height - Its CSS height.
 * @param dpr - What `devicePixelRatio` answers.
 * @param cap - The `maxResolution` of the game.
 * @returns The started mock.
 */
async function startedIn(
  box: { width: number; height: number },
  dpr: number,
  cap: number
): Promise<MockRenderer> {
  const mock = createMockRenderer({ dpr, config: { maxResolution: cap } });
  const mount = mock.dom?.mount;

  if (mount === undefined) throw new Error("the mock made no mount");

  mount.clientWidth = Math.floor(box.width);
  mount.clientHeight = Math.floor(box.height);
  mount.rect = { left: 0, top: 0, ...box };
  await mock.start();
  mock.pixi.last().canvas.rect = { left: 0, top: 0, ...box };

  return mock;
}

/**
 * The backing store Pixi makes of the last resize: it rounds `size × resolution` to device pixels.
 *
 * @param mock - A started mock.
 * @returns Width and height of the backing store, and the resolution it was made at.
 */
function backingStore(mock: MockRenderer): { width: number; height: number; resolution: number } {
  const renderer = mock.pixi.last().renderer;
  const last = renderer.resizes.at(-1);

  if (last === undefined) throw new Error("the renderer was never resized");

  return {
    width: Math.round(last.width * renderer.resolution),
    height: Math.round(last.height * renderer.resolution),
    resolution: renderer.resolution
  };
}

describe("viewport fill (F116): the canvas covers a fractional mount", () => {
  describe.each([
    { name: "dpr 2.77", dpr: 2.77, box: { width: 389.5, height: 844.5 }, store: [1079, 2340] },
    { name: "dpr 2.625", dpr: 2.625, box: { width: 411.3, height: 891.3 }, store: [1080, 2340] },
    { name: "dpr 3", dpr: 3, box: { width: 392.6, height: 850.6 }, store: [1178, 2552] }
  ])("$name", ({ dpr, box, store }) => {
    it("the backing store reaches the last device pixel of both sides", async () => {
      const mock = await startedIn(box, dpr, 3);

      expect(backingStore(mock)).toEqual({ width: store[0], height: store[1], resolution: dpr });
    });

    it("the canvas CSS box is the mount's box, fractions kept", async () => {
      const mock = await startedIn(box, dpr, 3);
      const { style } = mock.pixi.last().canvas;

      expect(style.width).toBe(`${box.width}px`);
      expect(style.height).toBe(`${box.height}px`);
    });

    it("toScreen of the frame's far corner is the mount's far corner", async () => {
      const mock = await startedIn(box, dpr, 3);
      const size = mock.api.viewport.size();
      const corner = mock.api.viewport.toScreen({ x: size.width, y: size.height });

      expect(corner.x).toBeCloseTo(box.width, 6);
      expect(corner.y).toBeCloseTo(box.height, 6);
    });
  });

  it("under the default cap of 2 the store still covers the fractional box", async () => {
    const mock = await startedIn({ width: 389.89, height: 844.77 }, 2.77, 2);

    expect(backingStore(mock)).toEqual({ width: 780, height: 1690, resolution: 2 });
    expect(mock.pixi.last().canvas.style.height).toBe("844.77px");
  });

  it("a window of whole device pixels, measured in 1/64 CSS px, gets no extra row", async () => {
    // The A26's 1080 × 2340 window at 2.77 in the browser's layout units: 2340.0008 device rows, the store keeps 2340.
    const mock = await startedIn({ width: 389.890_625, height: 844.765_625 }, 2.77, 3);

    expect(backingStore(mock)).toEqual({ width: 1080, height: 2340, resolution: 2.77 });
  });

  it("a resolution change covers the same fractional box at the new resolution", async () => {
    const mock = await startedIn({ width: 389.89, height: 844.77 }, 2.77, 3);

    mock.api.monitor.setResolution(2.625);
    mock.runPhase("input");
    mock.runPhase("render");

    expect(backingStore(mock)).toEqual({ width: 1024, height: 2218, resolution: 2.625 });
    expect(mock.pixi.last().canvas.style.height).toBe("844.77px");
  });
});
