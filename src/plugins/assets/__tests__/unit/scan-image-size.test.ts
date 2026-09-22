import { describe, expect, it } from "vitest";
import { HEADER_BYTES, readImageSize, textureMb } from "../../scan/image-size";
import {
  pngBytes,
  webpUnknownChunkBytes,
  webpVp8Bytes,
  webpVp8lBytes,
  webpVp8xBytes
} from "./scan-fixtures";

describe("HEADER_BYTES", () => {
  it("is the 30 bytes the four formats need", () => {
    expect(HEADER_BYTES).toBe(30);
  });
});

describe("readImageSize", () => {
  it("reads the IHDR of a PNG", () => {
    expect(readImageSize(pngBytes(128, 64), "a.png")).toEqual({ width: 128, height: 64 });
  });

  it("reads a lossy VP8 WebP", () => {
    expect(readImageSize(webpVp8Bytes(256, 128), "a.webp")).toEqual({ width: 256, height: 128 });
  });

  it("reads a lossless VP8L WebP", () => {
    expect(readImageSize(webpVp8lBytes(32, 16), "a.webp")).toEqual({ width: 32, height: 16 });
  });

  it("reads an extended VP8X WebP", () => {
    expect(readImageSize(webpVp8xBytes(1024, 512), "a.webp")).toEqual({
      width: 1024,
      height: 512
    });
  });

  it("refuses a head shorter than 30 bytes and names the file", () => {
    expect(() =>
      readImageSize(pngBytes(8, 8).subarray(0, 12), "features/ui/assets/cut.png")
    ).toThrow(/\[game] assets: "features\/ui\/assets\/cut\.png" is not a PNG or a WebP file/);
  });

  it("refuses a file that is neither PNG nor WebP", () => {
    expect(() => readImageSize(new Uint8Array(30), "features/ui/assets/fake.png")).toThrow(
      /"features\/ui\/assets\/fake\.png" is not a PNG or a WebP file/
    );
  });

  it("refuses a RIFF file that is not WEBP", () => {
    const bytes = webpVp8Bytes(16, 16);

    bytes[8] = "X".codePointAt(0) ?? 0;

    expect(() => readImageSize(bytes, "a.webp")).toThrow(/is not a PNG or a WebP file/);
  });

  it("refuses a WebP chunk it does not know", () => {
    expect(() => readImageSize(webpUnknownChunkBytes(), "features/ui/assets/anim.webp")).toThrow(
      /"features\/ui\/assets\/anim\.webp" carries the WebP chunk "ANIM"/
    );
  });

  it("refuses a VP8 frame without the sync code", () => {
    const bytes = webpVp8Bytes(16, 16);

    bytes[24] = 0;

    expect(() => readImageSize(bytes, "a.webp")).toThrow(/VP8 frame of "a\.webp" is damaged/);
  });

  it("refuses a VP8L frame without its signature", () => {
    const bytes = webpVp8lBytes(16, 16);

    bytes[20] = 0;

    expect(() => readImageSize(bytes, "a.webp")).toThrow(/VP8L frame of "a\.webp" is damaged/);
  });
});

describe("textureMb", () => {
  it("is width times height times four bytes, rounded to three decimals", () => {
    expect(textureMb(128, 128)).toBe(0.063);
    expect(textureMb(256, 128)).toBe(0.125);
    expect(textureMb(1024, 1024)).toBe(4);
  });

  it("is zero for an empty image", () => {
    expect(textureMb(0, 0)).toBe(0);
  });
});
