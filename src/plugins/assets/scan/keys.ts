/**
 * @file assets plugin, build time — the key rule. An asset key is the feature name, a dot and the
 * path inside `assets/` with every "/" turned into a dot; the extension and the `{tag=value}`
 * groups are dropped, unless a group is malformed: then the name stays whole and the scan notes
 * why. Pure and free of the file system, so the editor applies the same rule later.
 */
import type { AssetKind, NineSlice } from "../types";

const TEXTURE = /\.(?:png|webp)$/i;

const FONT = /\.fnt$/i;

const AUDIO = /\.mp3$/i;

const TAG_GROUPS = /^(?:\{[^{}]*\})*$/;

const WHOLE_NUMBER = /^\d+$/;

/**
 * Which number of a nine tag each side takes, in the order left, top, right, bottom, by how many
 * numbers the tag carries: `{nine=N}`, `{nine=H,V}` and `{nine=L,T,R,B}`.
 */
const NINE_SIDES: Readonly<Record<number, readonly [number, number, number, number]>> = {
  1: [0, 0, 0, 0],
  2: [0, 1, 0, 1],
  4: [0, 1, 2, 3]
};

/**
 * A file name after its extension and its tags were read.
 */
export type ParsedName = {
  /**
   * The name without the extension and without the tag groups; the whole name without the
   * extension when a tag is malformed.
   */
  stem: string;
  /** The four borders of a nine tag, or `undefined` when the name carries none or a bad one. */
  nine: NineSlice | undefined;
  /** The one line the scan notes when a tag is malformed, or `undefined`. */
  note: string | undefined;
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
 * Reads the borders of a nine tag: one number for every side, two for the horizontal and the
 * vertical sides, or four in the order left, top, right, bottom.
 *
 * @param value - What stood behind the `=`.
 * @returns The four borders, or `undefined` when the value is none of the three forms.
 * @example
 * ```ts
 * readNine("24,12"); // { left: 24, top: 12, right: 24, bottom: 12 }
 * ```
 */
function readNine(value: string): NineSlice | undefined {
  const numbers = value.split(",");
  const sides = NINE_SIDES[numbers.length];

  if (sides === undefined || !numbers.every(number => WHOLE_NUMBER.test(number))) return undefined;

  const side = (at: number): number => Number(numbers[at]);

  return {
    left: side(sides[0]),
    top: side(sides[1]),
    right: side(sides[2]),
    bottom: side(sides[3])
  };
}

/**
 * Reads one tag group.
 *
 * @param content - What stood between the braces.
 * @param file - Path of the file, for the message.
 * @returns The borders the group describes, or `undefined` when the group is malformed: not
 *   `name=value`, or a nine value of none of the three forms.
 * @throws {Error} When the tag is `name=value` but its name is not `nine`.
 */
function readTag(content: string, file: string): NineSlice | undefined {
  const equals = content.indexOf("=");

  if (equals <= 0) return undefined;

  const name = content.slice(0, equals);

  if (name !== "nine") throw problem(`"${file}" has the unknown tag "${name}".`);

  return readNine(content.slice(equals + 1));
}

/**
 * Says in one line why a file keeps its whole name.
 *
 * @param file - Path of the file.
 * @param content - What stood between the braces of the malformed group.
 * @returns The note.
 * @example
 * ```ts
 * malformedNote("features/ui/assets/bar{nine=1,2,3}.png", "nine=1,2,3");
 * // 'kept the whole name of "features/ui/assets/bar{nine=1,2,3}.png": the tag "{nine=1,2,3}" is not {nine=N}, {nine=H,V} or {nine=L,T,R,B}.'
 * ```
 */
function malformedNote(file: string, content: string): string {
  return (
    `kept the whole name of "${file}": the tag "{${content}}" is not ` +
    "{nine=N}, {nine=H,V} or {nine=L,T,R,B}."
  );
}

/**
 * Splits a file name into the name the key is built from and the metadata its tags carry. A
 * malformed tag is not a problem: the name stays whole, so the key shows the mistake, and one note
 * says why.
 *
 * @param fileName - Name of the file, with its extension.
 * @param file - Path of the file, for the messages.
 * @returns The stem, the nine-slice borders and the note of a malformed tag.
 * @throws {Error} When a brace is not a trailing tag group, a tag is unknown, the name is only
 *   tags, the name before the tags carries a "." that would fake a folder, or a malformed tag
 *   carries a "." that cannot stay in the whole name.
 * @example
 * ```ts
 * parseTags("panel{nine=48}.png", "features/ui/assets/panel{nine=48}.png");
 * // { stem: "panel", nine: { left: 48, top: 48, right: 48, bottom: 48 }, note: undefined }
 * parseTags("sign{nine=30,10,40,20}.png", "features/ui/assets/sign{nine=30,10,40,20}.png").nine;
 * // { left: 30, top: 10, right: 40, bottom: 20 }
 * ```
 */
export function parseTags(fileName: string, file: string): ParsedName {
  // Cut the name into the part before the tags and the trailing tag groups.
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

  // Read every group; well-formed tags leave the name and become metadata.
  const contents = tags === "" ? [] : tags.slice(1, -1).split("}{");
  const borders = contents.map(content => readTag(content, file));
  const malformed = contents.find((_content, at) => borders[at] === undefined);

  if (malformed === undefined) return { stem, nine: borders.at(-1), note: undefined };

  // A malformed tag keeps the whole name, unless its "." would make that name no key at all.
  const dotted = contents.find(content => content.includes("."));

  if (dotted !== undefined) {
    throw problem(
      `"${file}" has the malformed tag "{${dotted}}", whose "." cannot stay in a key. ` +
        "Use {nine=N}, {nine=H,V} or {nine=L,T,R,B} with whole numbers."
    );
  }

  return { stem: base, nine: undefined, note: malformedNote(file, malformed) };
}

/**
 * Builds the asset key of one file.
 *
 * @param feature - Name of the feature folder.
 * @param relative - POSIX path of the file inside the feature's `assets/`.
 * @param file - Path of the file from the scan root, for the messages.
 * @returns The asset key.
 * @throws {Error} When a folder or the file name carries a "." that would fake a folder, or a tag
 *   is unknown.
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
