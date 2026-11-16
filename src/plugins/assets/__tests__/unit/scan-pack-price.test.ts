import { describe, expect, it } from "vitest";
import { glMb, PRICE_POINTS, pixelMb } from "../../scan/pack/price";

describe("glMb", () => {
  it("gives the measured value at a table point, the jump over 4 MiB included", () => {
    // Bug caught: a mistyped or reordered table prices a page wrong and picks the wrong page size.
    for (const [mib, gl] of PRICE_POINTS) expect(glMb(mib)).toBeCloseTo(gl, 10);

    expect(glMb(0.25)).toBe(0.644);
    expect(glMb(4)).toBe(5.03);
    expect(glMb(4.05)).toBe(6.3);
    expect(glMb(16)).toBe(21.7);
  });

  it("gives the mean halfway between two points", () => {
    // Bug caught: stepping to the next point instead of interpolating makes a layout just under a
    // heap boundary look as dear as one just over it.
    expect(glMb((1 + 1.373) / 2)).toBeCloseTo((2.34 + 2.37) / 2, 10);
    expect(glMb((4 + 4.05) / 2)).toBeCloseTo((5.03 + 6.3) / 2, 10);
  });

  it("stays proportional above 16 MiB and below the first point", () => {
    // Bug caught: a flat price past 16 MiB makes one 4096 page look free next to four 2048 pages.
    expect(glMb(32)).toBeCloseTo(43.4, 10);
    // Half the first point (0.0625 MiB → 0.0945) is half its price.
    expect(glMb(0.0625 / 2)).toBeCloseTo(0.0945 / 2, 10);
    expect(glMb(0)).toBe(0);
  });
});

describe("pixelMb", () => {
  it("counts RGBA pixels in MiB", () => {
    // Bug caught: counting 3 bytes a pixel, or 1000 000 bytes to the MiB, shifts every price.
    expect(pixelMb(1024, 1024)).toBe(4);
    expect(pixelMb(512, 256)).toBe(0.5);
  });
});
