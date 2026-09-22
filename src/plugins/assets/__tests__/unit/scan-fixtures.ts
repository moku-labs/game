/**
 * @file Test fixtures of the asset key scanner: real PNG and WebP header bytes and a temp tree.
 * The scanner reads the first 30 bytes of a file, so these headers are enough.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (const [index, char] of [...text].entries()) bytes[offset + index] = char.codePointAt(0) ?? 0;
}

function writeUint24Le(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
}

/** A PNG head: signature, IHDR length, IHDR, width and height as big-endian uint32. */
export function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40);
  const view = viewOf(bytes);

  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(8, 13);
  writeAscii(bytes, 12, "IHDR");
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;

  return bytes;
}

/** A lossy WebP head: `RIFF`, `WEBP`, the `VP8 ` chunk, the sync code and 14-bit sizes. */
export function webpVp8Bytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  const view = viewOf(bytes);

  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 24, true);
  writeAscii(bytes, 8, "WEBP");
  writeAscii(bytes, 12, "VP8 ");
  view.setUint32(16, 12, true);
  bytes.set([0x10, 0x00, 0x00], 20);
  bytes.set([0x9d, 0x01, 0x2a], 23);
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);

  return bytes;
}

/** A lossless WebP head: the `VP8L` chunk, the `0x2f` signature and 14 + 14 packed bits. */
export function webpVp8lBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  const view = viewOf(bytes);

  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 24, true);
  writeAscii(bytes, 8, "WEBP");
  writeAscii(bytes, 12, "VP8L");
  view.setUint32(16, 12, true);
  bytes[20] = 0x2f;
  view.setUint32(21, ((width - 1) | ((height - 1) << 14)) >>> 0, true);

  return bytes;
}

/** An extended WebP head: the `VP8X` chunk with the 24-bit canvas size. */
export function webpVp8xBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  const view = viewOf(bytes);

  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 24, true);
  writeAscii(bytes, 8, "WEBP");
  writeAscii(bytes, 12, "VP8X");
  view.setUint32(16, 10, true);
  bytes[20] = 0x10;
  writeUint24Le(bytes, 24, width - 1);
  writeUint24Le(bytes, 27, height - 1);

  return bytes;
}

/** A WebP head whose chunk is neither `VP8 `, `VP8L` nor `VP8X`. */
export function webpUnknownChunkBytes(): Uint8Array {
  const bytes = webpVp8Bytes(16, 16);

  writeAscii(bytes, 12, "ANIM");

  return bytes;
}

/** A BMFont file in the text format, naming one page file per line. */
export function bmfontText(...pages: string[]): string {
  const lines = pages.map((page, id) => `page id=${id} file="${page}"`);

  return ['info face="body" size=32', `common lineHeight=38 pages=${pages.length}`, ...lines].join(
    "\n"
  );
}

/** A BMFont file in the XML format. */
export function bmfontXml(...pages: string[]): string {
  const lines = pages.map((page, id) => `    <page id="${id}" file="${page}" />`);

  return ['<?xml version="1.0"?>', "<font>", "  <pages>", ...lines, "  </pages>", "</font>"].join(
    "\n"
  );
}

/** A BMFont file in the JSON format, the shape a msdf exporter writes. */
export function bmfontJson(...pages: string[]): string {
  return JSON.stringify({ pages, chars: [] });
}

/** Bytes that stand in for an audio file: only their number matters to the scanner. */
export function audioBytes(length: number): Uint8Array {
  return new Uint8Array(length);
}

/** Writes a temp game tree and returns its root. Keys are POSIX paths, values bytes or text. */
export async function makeTree(files: Record<string, string | Uint8Array>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "moku-assets-"));

  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"));

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  return root;
}

/** Deletes a tree made by `makeTree`. */
export async function removeTree(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
