/**
 * @file assets plugin, build time — the key rule. An asset key is the feature name, a dot and the
 * path inside `assets/` with every "/" turned into a dot; the extension and the `{tag=value}`
 * groups are dropped. Pure and free of the file system, so the editor applies the same rule later.
 */
import type { AssetKind, NineSlice } from "../types";

const TEXTURE = /\.(?:png|webp)$/i;

const FONT = /\.fnt$/i;

const AUDIO = /\.mp3$/i;

const TAG_GROUPS = /^(?:\{[^{}]*\})*$/;

const WHOLE_NUMBER = /^\d+$/;

/**
 * A file name after its extension and its tags were read.
 */
export type ParsedName = {
  /** The name without the extension and without the tag groups. */
  stem: string;
  /** The four borders of a `{nine=N}` tag, or `undefined` when the name carries none. */
  nine: NineSlice | undefined;
};

/**
 * Wraps a scanner problem in the message shape of the framework.
 *
 * @param message - One sentence naming the file.
 * @returns The error to throw.
 */
function problem(message: string): Error {
  return new Error(`[game] assets: ${message}`);
}

/**
 * Tells what the scanner makes of a file: one texture per PNG or WebP, one font per `.fnt` with
 * the pages it names, one sound per MP3. Everything else is left out with a note.
 *
 * @param fileName - Name of the file, with its extension.
 * @returns The kind of the asset, or `undefined` when the scanner reads no such file.
 * @example
 * ```ts
 * assetKindOf("body.fnt"); // "font"
 * assetKindOf("theme.ogg"); // undefined
 * ```
 */
export function assetKindOf(fileName: string): AssetKind | undefined {
  if (TEXTURE.test(fileName)) return "texture";
  if (FONT.test(fileName)) return "font";
  if (AUDIO.test(fileName)) return "audio";

  return undefined;
}

/**
 * Tells whether the scanner reads this file.
 *
 * @param fileName - Name of the file, with its extension.
 * @returns True for a PNG, a WebP, a `.fnt` or an MP3.
 * @example
 * ```ts
 * isAssetFile("star-on.webp"); // true
 * isAssetFile("notes.md"); // false
 * ```
 */
export function isAssetFile(fileName: string): boolean {
  return assetKindOf(fileName) !== undefined;
}

/**
 * Reads the borders of a `{nine=N}` tag.
 *
 * @param value - What stood behind the `=`.
 * @param file - Path of the file, for the message.
 * @returns The four borders.
 * @throws {Error} When the value is not a whole number.
 */
function readNine(value: string, file: string): NineSlice {
  if (!WHOLE_NUMBER.test(value)) {
    throw problem(`"${file}" has the nine tag "${value}", which is not a whole number.`);
  }

  const border = Number(value);

  return { left: border, top: border, right: border, bottom: border };
}

/**
 * Reads one tag group.
 *
 * @param content - What stood between the braces.
 * @param file - Path of the file, for the message.
 * @returns The borders the group describes.
 * @throws {Error} When the group is not `name=value`, or its name is not `nine`.
 */
function readTag(content: string, file: string): NineSlice {
  const equals = content.indexOf("=");

  if (equals <= 0) throw problem(`"${file}" has the malformed tag "{${content}}".`);

  const name = content.slice(0, equals);

  if (name !== "nine") throw problem(`"${file}" has the unknown tag "${name}".`);

  return readNine(content.slice(equals + 1), file);
}

/**
 * Splits a file name into the name the key is built from and the metadata its tags carry.
 *
 * @param fileName - Name of the file, with its extension.
 * @param file - Path of the file, for the messages.
 * @returns The stem and the nine-slice borders.
 * @throws {Error} When a brace is not a trailing tag group, a tag is unknown or malformed, the
 *   name is only tags, or the name carries a "." that would fake a folder.
 * @example
 * ```ts
 * parseTags("panel{nine=48}.png", "features/ui/assets/panel{nine=48}.png");
 * // { stem: "panel", nine: { left: 48, top: 48, right: 48, bottom: 48 } }
 * ```
 */
export function parseTags(fileName: string, file: string): ParsedName {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const open = base.indexOf("{");
  const stem = open === -1 ? base : base.slice(0, open);
  const tags = open === -1 ? "" : base.slice(open);

  if (stem.includes("}") || !TAG_GROUPS.test(tags)) {
    throw problem(`the name of "${file}" has a brace that is not a tag group.`);
  }

  if (stem === "") throw problem(`"${file}" has no name before its tags.`);
  if (stem.includes(".")) {
    throw problem(`"${file}" has a "." in "${stem}", which would fake a folder.`);
  }

  const contents = tags === "" ? [] : tags.slice(1, -1).split("}{");
  const borders = contents.map(content => readTag(content, file));

  return { stem, nine: borders.at(-1) };
}

/**
 * Builds the asset key of one file.
 *
 * @param feature - Name of the feature folder.
 * @param relative - POSIX path of the file inside the feature's `assets/`.
 * @param file - Path of the file from the scan root, for the messages.
 * @returns The asset key.
 * @throws {Error} When a folder or the file name carries a "." that would fake a folder, or a tag
 *   is unknown or malformed.
 * @example
 * ```ts
 * keyOf("ui", "button/primary.png", "features/ui/assets/button/primary.png"); // "ui.button.primary"
 * ```
 */
export function keyOf(feature: string, relative: string, file: string): string {
  const cut = relative.lastIndexOf("/");
  const folders = cut === -1 ? [] : relative.slice(0, cut).split("/");

  for (const folder of folders) {
    if (folder.includes(".")) {
      throw problem(`"${file}" has a "." in "${folder}", which would fake a folder.`);
    }
  }

  return [feature, ...folders, parseTags(relative.slice(cut + 1), file).stem].join(".");
}
