import { describe, expect, it } from "vitest";
import type { Pixels } from "../../scan/pack/encode";
import { cropPixels, trimBox } from "../../scan/pack/trim";

/** An image of `width × height` transparent pixels with an opaque rectangle drawn on it. */
function drawn(
  width: number,
  height: number,
  rect: { x: number; y: number; width: number; height: number }
): Pixels {
  const data = new Uint8Array(width * height * 4);

  for (let row = rect.y; row < rect.y + rect.height; row += 1) {
    for (let column = rect.x; column < rect.x + rect.width; column += 1) {
      data.set([200, 100, 50, 255], (row * width + column) * 4);
    }
  }

  return { width, height, data };
}

describe("trimBox", () => {
  it("keeps one transparent pixel around what is visible", () => {
    // Bug caught: cutting exactly at the visible pixels makes bilinear sampling at the sprite's edge
    // read the neighbour on the page, a visible line.
    const box = trimBox(drawn(40, 30, { x: 10, y: 8, width: 12, height: 6 }));

    expect(box).toEqual({ x: 9, y: 7, width: 14, height: 8 });
  });

  it("keeps no margin on a side where the visible pixels touch the edge of the image", () => {
    // Bug caught: growing the box past the image reads outside the pixels (a negative offset).
    const box = trimBox(drawn(20, 20, { x: 0, y: 5, width: 20, height: 4 }));

    expect(box).toEqual({ x: 0, y: 4, width: 20, height: 6 });
  });

  it("gives a 1×1 box at 0, 0 for an image with nothing visible", () => {
    // Bug caught: an empty box would write a page frame of 0 px, which no slice can cut.
    expect(trimBox(drawn(16, 16, { x: 0, y: 0, width: 0, height: 0 }))).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1
    });
  });

  it("gives the whole image when it has no transparent margin", () => {
    // Bug caught: trimming an opaque texture would shift it for nothing.
    expect(trimBox(drawn(8, 6, { x: 0, y: 0, width: 8, height: 6 }))).toEqual({
      x: 0,
      y: 0,
      width: 8,
      height: 6
    });
  });

  it("counts a pixel of alpha 1 as visible", () => {
    // Bug caught: a threshold above 0 would cut a faint glow off a texture.
    const data = new Uint8Array(10 * 10 * 4);

    data[(4 * 10 + 6) * 4 + 3] = 1;

    expect(trimBox({ width: 10, height: 10, data })).toEqual({ x: 5, y: 3, width: 3, height: 3 });
  });
});

describe("cropPixels", () => {
  it("copies the rows and columns of the box and nothing else", () => {
    // Bug caught: a wrong row stride or offset cuts the picture from the wrong place.
    const data = Uint8Array.from({ length: 4 * 3 * 4 }, (_, index) => index);
    const cut = cropPixels({ width: 4, height: 3, data }, { x: 1, y: 1, width: 2, height: 2 });

    expect(cut.width).toBe(2);
    expect(cut.height).toBe(2);
    // Pixel (1,1) is number 5 of the source: bytes 20..23; (2,1) bytes 24..27; (1,2) bytes 36..39.
    expect([...cut.data]).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 36, 37, 38, 39, 40, 41, 42, 43]);
  });
});
