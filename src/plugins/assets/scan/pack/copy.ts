/**
 * @file assets packer, build time — the files that are copied, not encoded: a font (its `.fnt`
 * rewritten to name its hashed pages, the pages byte for byte, so MSDF stays lossless), a sound
 * and a loose WebP texture (no second generation of loss). Copies are cheap and are not cached.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FontPage, ManifestFile } from "../../types";
import { renamePages } from "../fonts";
import { audioName, contentHash, fontName, fontPageName, looseName } from "./names";

/** One file of the pack folder: where it goes and what it holds. */
export type PackOutput = { path: string; bytes: Uint8Array };

/** A copied asset: its entry of the packed manifest and the files it writes. */
export type Copied = { file: ManifestFile; outputs: readonly PackOutput[] };

/**
 * Reads one source file of the scan.
 *
 * @param root - The game source root.
 * @param posixPath - The path of the manifest, relative to the root.
 * @returns The bytes.
 */
export async function readSource(root: string, posixPath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(root, ...posixPath.split("/"))));
}

/**
 * Reads the extension of a POSIX path, without the dot.
 *
 * @param posixPath - A path of the manifest.
 * @returns The extension, in lower case.
 * @example
 * ```ts
 * extensionOf("features/ui/assets/body_0.png"); // "png"
 * ```
 */
export function extensionOf(posixPath: string): string {
  return path.posix.extname(posixPath).slice(1).toLowerCase();
}

/**
 * Copies one font: every page byte for byte under its hashed name, then the `.fnt` rewritten to
 * name those pages, hashed by its new bytes.
 *
 * @param root - The game source root.
 * @param bundle - Name of the bundle.
 * @param file - The font of the scanned manifest, with its `path` and `pages`.
 * @param fontPath - The path of its `.fnt` file.
 * @returns The packed entry and the files to write.
 */
export async function copyFont(
  root: string,
  bundle: string,
  file: ManifestFile,
  fontPath: string
): Promise<Copied> {
  const outputs: PackOutput[] = [];
  const pages: FontPage[] = [];

  for (const [index, page] of (file.pages ?? []).entries()) {
    const bytes = await readSource(root, page.path);
    const name = fontPageName(bundle, file.key, index, contentHash(bytes), extensionOf(page.path));

    outputs.push({ path: name, bytes });
    pages.push({ ...page, path: name });
  }

  // The pages lie next to the font, so the font names them by their file name.
  const source = new TextDecoder().decode(await readSource(root, fontPath));
  const text = renamePages(
    source,
    pages.map(page => path.posix.basename(page.path))
  );
  const bytes = new TextEncoder().encode(text);
  const name = fontName(bundle, file.key, contentHash(bytes));

  outputs.push({ path: name, bytes });

  return { file: { ...file, path: name, pages }, outputs };
}

/**
 * Copies one sound byte for byte under its hashed name.
 *
 * @param root - The game source root.
 * @param bundle - Name of the bundle.
 * @param file - The sound of the scanned manifest.
 * @param soundPath - The path of its `.mp3` file.
 * @returns The packed entry and the file to write.
 */
export async function copyAudio(
  root: string,
  bundle: string,
  file: ManifestFile,
  soundPath: string
): Promise<Copied> {
  const bytes = await readSource(root, soundPath);
  const name = audioName(bundle, file.key, contentHash(bytes));

  return { file: { ...file, path: name }, outputs: [{ path: name, bytes }] };
}

/**
 * Copies one loose texture that already is a WebP, byte for byte under its hashed name.
 *
 * @param bundle - Name of the bundle.
 * @param file - The texture of the scanned manifest.
 * @param bytes - Its WebP bytes, as read from the source.
 * @returns The packed entry and the file to write.
 */
export function copyLoose(bundle: string, file: ManifestFile, bytes: Uint8Array): Copied {
  const name = looseName(bundle, file.key, contentHash(bytes), "webp");

  return { file: { ...file, path: name }, outputs: [{ path: name, bytes }] };
}
