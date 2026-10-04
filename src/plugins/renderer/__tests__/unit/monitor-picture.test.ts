import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodePicture,
  diffPixels,
  drawLegend,
  encodePicture,
  legendPicture,
  numberLegend,
  pictureRect,
  sheetLayout
} from "../../monitor/picture";
import type { Point } from "../../types";
import {
  FakeOffscreenCanvas,
  fakePictureUrl,
  installFakeCanvas,
  readFakePicture
} from "../fake-canvas";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A 2D context of a fresh fake canvas, typed as the browser's.
 *
 * @returns The canvas and its context.
 */
function fakeContext() {
  const canvas = new FakeOffscreenCanvas(100, 100);

  return { canvas, context: canvas.context as unknown as OffscreenCanvasRenderingContext2D };
}

/**
 * A row of RGBA pixels.
 *
 * @param pixels - The pixels.
 * @returns The picture.
 */
function row(...pixels: number[][]) {
  return { width: pixels.length, height: 1, data: new Uint8ClampedArray(pixels.flat()) };
}

/**
 * A viewport map: the canvas at (10, 30) on the page, the frame 5 and 10 px into it, 0.5 CSS px a
 * reference unit.
 *
 * @param point - A point in reference units.
 * @returns The point in client CSS pixels.
 */
function halfScale(point: Point) {
  return { x: 10 + 5 + point.x * 0.5, y: 30 + 10 + point.y * 0.5 };
}

/**
 * A viewport map at a third of a CSS pixel a reference unit, the canvas at the origin.
 *
 * @param point - A point in reference units.
 * @returns The point in client CSS pixels.
 */
function thirdScale(point: Point) {
  return { x: point.x / 3, y: point.y / 3 };
}

/**
 * A 10 x 10 rect of a picture.
 *
 * @param x - Left.
 * @param y - Top.
 * @returns The rect.
 */
function rectAt(x: number, y: number) {
  return { x, y, w: 10, h: 10 };
}

describe("pictureRect", () => {
  it("brings a reference box through toScreen into picture pixels at resolution 3", () => {
    expect(
      pictureRect({ x: 100, y: 200, width: 64, height: 32 }, halfScale, { x: 10, y: 30 }, 3)
    ).toEqual({ x: 165, y: 330, w: 96, h: 48 });
  });

  it("rounds to whole picture pixels", () => {
    expect(
      pictureRect({ x: 1, y: 2, width: 10, height: 10 }, thirdScale, { x: 0, y: 0 }, 2)
    ).toEqual({ x: 1, y: 1, w: 7, h: 7 });
  });
});

describe("numberLegend", () => {
  it("numbers the views from 1, sorted by the top edge, then the left edge", () => {
    expect(
      numberLegend([
        { projection: "board.items", key: "c8", rect: rectAt(300, 500) },
        { projection: "hud", key: "coins", rect: rectAt(800, 40) },
        { projection: "board.items", key: "c7", rect: rectAt(100, 500) }
      ])
    ).toEqual([
      { n: 1, projection: "hud", key: "coins", rect: rectAt(800, 40) },
      { n: 2, projection: "board.items", key: "c7", rect: rectAt(100, 500) },
      { n: 3, projection: "board.items", key: "c8", rect: rectAt(300, 500) }
    ]);
  });

  it("answers an empty legend for no view", () => {
    expect(numberLegend([])).toEqual([]);
  });
});

describe("drawLegend", () => {
  it("draws a badge at the top-left corner of every rect, white on black, in order", () => {
    const { canvas, context } = fakeContext();

    drawLegend(
      context,
      [
        { n: 1, projection: "hud", key: "claim", rect: { x: 1140, y: 2310, w: 567, h: 164 } },
        { n: 12, projection: "hud", key: "coins", rect: { x: 40, y: 2400, w: 90, h: 40 } }
      ],
      2
    );

    // The number is 24 px at resolution 2, half an em a character in the fake, padded by 2 px.
    expect(canvas.context.ops).toEqual([
      { op: "fillRect", x: 1140, y: 2310, w: 12 + 4, h: 28, fill: "#000000" },
      { op: "fillText", text: "1", x: 1142, y: 2312, font: "24px sans-serif", fill: "#ffffff" },
      { op: "fillRect", x: 40, y: 2400, w: 24 + 4, h: 28, fill: "#000000" },
      { op: "fillText", text: "12", x: 42, y: 2402, font: "24px sans-serif", fill: "#ffffff" }
    ]);
    expect(canvas.context.textBaseline).toBe("top");
  });
});

describe("sheetLayout", () => {
  it("lays 2 frames of a 1080 x 1920 canvas side by side, scaled to fit 2048 px", () => {
    const layout = sheetLayout(2, 1080, 1920);
    const scale = 2048 / 2160;

    expect(layout).toMatchObject({ columns: 2, rows: 1, width: 2 * 1024 + 3 * 8, height: 1836 });
    expect(layout.scale).toBeCloseTo(scale, 9);
    expect(layout.cells).toEqual([
      { x: 8, y: 8, w: 1024, h: 1820 },
      { x: 1040, y: 8, w: 1024, h: 1820 }
    ]);
  });

  it("lays 5 frames in 3 columns and 2 rows, at full size when they fit", () => {
    const layout = sheetLayout(5, 400, 300);

    expect(layout).toMatchObject({ columns: 3, rows: 2, scale: 1, width: 1232, height: 624 });
    expect(layout.cells).toEqual([
      { x: 8, y: 8, w: 400, h: 300 },
      { x: 416, y: 8, w: 400, h: 300 },
      { x: 824, y: 8, w: 400, h: 300 },
      { x: 8, y: 316, w: 400, h: 300 },
      { x: 416, y: 316, w: 400, h: 300 }
    ]);
  });

  it("lays the 6 frames of a motion in 3 columns and 2 rows", () => {
    expect(sheetLayout(6, 1170, 2532)).toMatchObject({ columns: 3, rows: 2 });
  });

  it("lays 12 frames of a phone canvas in 4 columns and 3 rows", () => {
    const layout = sheetLayout(12, 1170, 2532);

    expect(layout).toMatchObject({ columns: 4, rows: 3, width: 4 * 512 + 5 * 8 });
    expect(layout.height).toBe(3 * 1108 + 4 * 8);
    expect(layout.cells).toHaveLength(12);
    expect(layout.cells.at(-1)).toEqual({ x: 8 + 3 * 520, y: 8 + 2 * 1116, w: 512, h: 1108 });
  });
});

describe("diffPixels", () => {
  it("fades a matching pixel to grey: 255 - (255 - grey) × 0.4", () => {
    const picture = row([10, 20, 30, 255], [255, 255, 255, 255]);

    expect([...diffPixels(picture, picture)]).toEqual([160, 160, 160, 255, 255, 255, 255, 255]);
  });

  it("paints a pixel red when one channel differs by more than 24", () => {
    const current = row([125, 100, 100, 255], [124, 100, 100, 255], [100, 100, 100, 255]);
    const earlier = row([100, 100, 100, 255], [100, 100, 100, 255], [100, 100, 100, 230]);

    // 25 over: red. 24 over: the same pixel. The alpha 25 under: red.
    expect([...diffPixels(current, earlier)]).toEqual([
      255, 0, 0, 255, 196, 196, 196, 255, 255, 0, 0, 255
    ]);
  });

  it("refuses two pictures of different sizes", () => {
    expect(() => diffPixels(row([0, 0, 0, 255]), row([0, 0, 0, 255], [0, 0, 0, 255]))).toThrow(
      "[game] game.capture: the pictures differ in size.\n  Capture both at the same canvas size."
    );
  });
});

describe("decodePicture and encodePicture", () => {
  it("decodes a PNG data URL and encodes a canvas back into one", async () => {
    installFakeCanvas();

    const bitmap = await decodePicture(fakePictureUrl(3, 2));
    const canvas = new OffscreenCanvas(3, 2);

    expect([bitmap.width, bitmap.height]).toEqual([3, 2]);

    const url = await encodePicture(canvas);

    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect(readFakePicture(url)).toMatchObject({ width: 3, height: 2 });
  });
});

describe("the 2D context", () => {
  it("refuses to draw when OffscreenCanvas gives no 2D context", async () => {
    installFakeCanvas();
    vi.stubGlobal(
      "OffscreenCanvas",
      class extends FakeOffscreenCanvas {
        public override getContext(): null {
          // eslint-disable-next-line unicorn/no-null -- the browser answers `null` for no context
          return null;
        }
      }
    );

    await expect(legendPicture(fakePictureUrl(2, 2), [], 1)).rejects.toThrow(
      "[game] game.capture got no 2D context from OffscreenCanvas.\n  Capture in a browser that draws 2D on an OffscreenCanvas."
    );
  });
});
