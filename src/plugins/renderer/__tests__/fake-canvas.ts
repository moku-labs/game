/* eslint-disable unicorn/no-null -- `getContext` answers `null` for a kind it does not have, as the browser does */
/**
 * @file renderer plugin — a fake `OffscreenCanvas`, 2D context, `ImageData` and image codec for the
 * capture tests. Not a test file: the projects only collect `*.test.ts`. A fake picture is a data
 * URL whose base64 holds JSON: its size, its RGBA bytes and the drawing calls that made it, so a
 * test reads back what `monitor/picture.ts` drew.
 */
import { vi } from "vitest";

/** One drawing call the fake context recorded, in call order. */
export type FakeOp =
  | { op: "drawImage"; x: number; y: number; w: number; h: number; from: string }
  | { op: "fillRect"; x: number; y: number; w: number; h: number; fill: string }
  | { op: "fillText"; text: string; x: number; y: number; font: string; fill: string }
  | { op: "putImageData"; x: number; y: number };

/** What a fake picture holds. */
export type FakePicture = { width: number; height: number; data: number[]; ops: FakeOp[] };

/** An opaque black pixel. */
const BLACK: readonly number[] = [0, 0, 0, 255];

/**
 * Writes a fake picture as a data URL.
 *
 * @param width - Pixels across.
 * @param height - Pixels down.
 * @param pixel - The RGBA of a pixel by its index; opaque black when left out.
 * @returns The PNG data URL of the fake codec.
 */
export function fakePictureUrl(
  width: number,
  height: number,
  pixel: (index: number) => readonly number[] = () => BLACK
): string {
  const data: number[] = [];

  for (let index = 0; index < width * height; index += 1) data.push(...pixel(index));

  const picture: FakePicture = { width, height, data, ops: [] };

  return `data:image/png;base64,${Buffer.from(JSON.stringify(picture)).toString("base64")}`;
}

/**
 * Reads a fake picture back out of its data URL.
 *
 * @param url - A data URL the fake codec wrote.
 * @returns The picture.
 */
export function readFakePicture(url: string): FakePicture {
  const json = Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString("utf8");

  return JSON.parse(json) as FakePicture;
}

/** A decoded fake picture, what `createImageBitmap` answers. */
export class FakeBitmap {
  public readonly width: number;
  public readonly height: number;
  public readonly data: Uint8ClampedArray<ArrayBuffer>;
  /** A short name for the op record: `width x height`. */
  public readonly name: string;

  public constructor(picture: FakePicture) {
    this.width = picture.width;
    this.height = picture.height;
    this.data = new Uint8ClampedArray(picture.data);
    this.name = `${picture.width}x${picture.height}`;
  }
}

/** The fake `ImageData`. */
export class FakeImageData {
  public readonly data: Uint8ClampedArray<ArrayBuffer>;
  public readonly width: number;
  public readonly height: number;

  public constructor(data: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

/** The fake 2D context: it keeps the pixels of a whole-picture draw and records every call. */
export class FakeContext2D {
  public font = "10px sans-serif";
  public fillStyle = "#000000";
  public textBaseline = "alphabetic";
  public readonly ops: FakeOp[] = [];
  private readonly canvas: FakeOffscreenCanvas;

  public constructor(canvas: FakeOffscreenCanvas) {
    this.canvas = canvas;
  }

  /**
   * Draws a bitmap. A draw at the origin in the bitmap's own size copies its pixels.
   *
   * @param image - The bitmap.
   * @param x - Left.
   * @param y - Top.
   * @param w - Drawn width; the bitmap's own when left out.
   * @param h - Drawn height; the bitmap's own when left out.
   */
  public drawImage(image: FakeBitmap, x: number, y: number, w?: number, h?: number): void {
    const width = w ?? image.width;
    const height = h ?? image.height;

    this.ops.push({ op: "drawImage", x, y, w: width, h: height, from: image.name });

    if (x === 0 && y === 0 && width === image.width && height === image.height) {
      this.canvas.data.set(image.data.subarray(0, this.canvas.data.length));
    }
  }

  /** Clears every pixel to transparent black. */
  public clearRect(): void {
    this.canvas.data.fill(0);
  }

  /**
   * Reads the pixels of the whole canvas.
   *
   * @param _x - Left, always 0 here.
   * @param _y - Top, always 0 here.
   * @param width - Width.
   * @param height - Height.
   * @returns A copy of the pixels.
   */
  public getImageData(_x: number, _y: number, width: number, height: number): FakeImageData {
    return new FakeImageData(new Uint8ClampedArray(this.canvas.data), width, height);
  }

  /**
   * Writes pixels over the whole canvas.
   *
   * @param image - The pixels.
   * @param x - Left.
   * @param y - Top.
   */
  public putImageData(image: FakeImageData, x: number, y: number): void {
    this.ops.push({ op: "putImageData", x, y });
    this.canvas.data.set(image.data.subarray(0, this.canvas.data.length));
  }

  /**
   * Records a filled rectangle.
   *
   * @param x - Left.
   * @param y - Top.
   * @param w - Width.
   * @param h - Height.
   */
  public fillRect(x: number, y: number, w: number, h: number): void {
    this.ops.push({ op: "fillRect", x, y, w, h, fill: this.fillStyle });
  }

  /**
   * Records a text draw.
   *
   * @param text - The text.
   * @param x - Left.
   * @param y - Top.
   */
  public fillText(text: string, x: number, y: number): void {
    this.ops.push({ op: "fillText", text, x, y, font: this.font, fill: this.fillStyle });
  }

  /**
   * Measures a text: every character is half an em wide in the current font.
   *
   * @param text - The text.
   * @returns Its width.
   */
  public measureText(text: string): { width: number } {
    return { width: (text.length * Number.parseFloat(this.font)) / 2 };
  }
}

/** The fake `OffscreenCanvas`: its encode writes a fake picture with the recorded calls. */
export class FakeOffscreenCanvas {
  public readonly width: number;
  public readonly height: number;
  public readonly data: Uint8ClampedArray<ArrayBuffer>;
  public readonly context: FakeContext2D;

  public constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    this.context = new FakeContext2D(this);
  }

  /**
   * Answers the 2D context, `null` for any other kind.
   *
   * @param kind - The context kind.
   * @returns The context.
   */
  public getContext(kind: string): FakeContext2D | null {
    return kind === "2d" ? this.context : null;
  }

  /**
   * Encodes the canvas as a fake picture.
   *
   * @param options - The type asked for.
   * @param options.type - The MIME type.
   * @returns The blob.
   */
  public async convertToBlob(options?: { type?: string }): Promise<Blob> {
    const picture: FakePicture = {
      width: this.width,
      height: this.height,
      data: [...this.data],
      ops: this.context.ops
    };

    return new Blob([JSON.stringify(picture)], { type: options?.type ?? "image/png" });
  }
}

/**
 * Puts the fake canvas, `ImageData` and `createImageBitmap` on `globalThis`.
 * `vi.unstubAllGlobals()` takes them down again.
 */
export function installFakeCanvas(): void {
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  vi.stubGlobal("ImageData", FakeImageData);
  vi.stubGlobal(
    "createImageBitmap",
    async (blob: Blob) => new FakeBitmap(JSON.parse(await blob.text()) as FakePicture)
  );
}
