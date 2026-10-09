/**
 * @file assets plugin — the manifest: parsing, the key index and the URL of a file. Pure
 * functions over plain JSON, so the scanner, the packer, the plugin and the editor read the same
 * contract. Version 1 (dev, loose files) and version 2 (packed, atlas pages) go through one path.
 */
import type {
  AssetKind,
  AtlasFrame,
  AtlasPage,
  CreateTextureOptions,
  FontPage,
  Manifest,
  ManifestBundle,
  ManifestFile,
  NineSlice,
  Tier
} from "./types";

const TIERS: readonly string[] = ["boot", "core", "scene", "feature", "lazy"];

/** The bytes of one megabyte. */
const BYTES_PER_MB = 1_048_576;

/** The bytes one pixel takes in GPU memory: RGBA, no mipmaps. */
const BYTES_PER_PIXEL = 4;

/** Megabytes are kept to three decimals: a value is rounded to a whole number of these parts. */
const PARTS_PER_MB = 1000;

/**
 * Creates an empty map. It lives in its own non-exported function because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @returns An empty map.
 */
function emptyMap<Key, Value>(): Map<Key, Value> {
  return new Map();
}

/**
 * Creates the manifest of a game that brought none: version 1, no bundles.
 *
 * @returns An empty manifest.
 * @example
 * ```ts
 * emptyManifest(); // { version: 1, bundles: {} }
 * ```
 */
export function emptyManifest(): Manifest {
  return { version: 1, bundles: {} };
}

/**
 * Tells whether a value is a plain object.
 *
 * @param value - Anything that came out of JSON.
 * @returns True for an object that is not an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads one number of a JSON object.
 *
 * @param source - The object to read.
 * @param key - Name of the field.
 * @returns The number, or `0` when the field is missing or not finite.
 * @example
 * ```ts
 * numberAt({ mb: 0.125 }, "mb"); // 0.125
 * ```
 */
function numberAt(source: Record<string, unknown>, key: string): number {
  const value = source[key];

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Reads one string of a JSON object.
 *
 * @param source - The object to read.
 * @param key - Name of the field.
 * @returns The string, or `""` when the field is missing or not a string.
 * @example
 * ```ts
 * stringAt({ key: "ui.panel" }, "key"); // "ui.panel"
 * ```
 */
function stringAt(source: Record<string, unknown>, key: string): string {
  const value = source[key];

  return typeof value === "string" ? value : "";
}

/**
 * Reads the optional nine-slice metadata of a file.
 *
 * @param value - What the `nine` field carried.
 * @returns The four borders, or `undefined`.
 */
function parseNine(value: unknown): NineSlice | undefined {
  if (!isRecord(value)) return undefined;

  return {
    left: numberAt(value, "left"),
    top: numberAt(value, "top"),
    right: numberAt(value, "right"),
    bottom: numberAt(value, "bottom")
  };
}

/**
 * Reads the atlas placement of a packed file.
 *
 * @param value - What the `atlas` field carried.
 * @returns The frame, or `undefined`.
 */
function parseAtlas(value: unknown): AtlasFrame | undefined {
  if (!isRecord(value)) return undefined;

  return {
    page: stringAt(value, "page"),
    x: numberAt(value, "x"),
    y: numberAt(value, "y"),
    width: numberAt(value, "width"),
    height: numberAt(value, "height")
  };
}

/**
 * Reads the kind of a file. Only `font` and `audio` are recorded: a texture is the default and
 * says nothing, which is why a manifest written before fonts and audio still loads.
 *
 * @param value - What the `kind` field carried.
 * @returns The kind, or `undefined` for a texture and for anything unknown.
 */
function parseKind(value: unknown): AssetKind | undefined {
  return value === "font" || value === "audio" ? value : undefined;
}

/**
 * Reads the page images a font file names.
 *
 * @param value - What the `pages` field carried.
 * @returns The pages in the order the font declares them, or `undefined`.
 */
function parseFontPages(value: unknown): readonly FontPage[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value
    .filter(entry => isRecord(entry))
    .map(entry => ({
      path: stringAt(entry, "path"),
      width: numberAt(entry, "width"),
      height: numberAt(entry, "height"),
      mb: numberAt(entry, "mb")
    }));
}

/**
 * Reads the atlas pages of a packed bundle, sorted by id.
 *
 * @param value - What the `pages` field of the bundle carried.
 * @returns The pages, or `undefined` for a bundle with no `pages` array.
 */
function parseAtlasPages(value: unknown): readonly AtlasPage[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value
    .filter(entry => isRecord(entry))
    .map(entry => ({
      id: stringAt(entry, "id"),
      path: stringAt(entry, "path"),
      width: numberAt(entry, "width"),
      height: numberAt(entry, "height"),
      mb: numberAt(entry, "mb")
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Reads one file entry. Unknown fields are dropped; a `path` that is not a string is absent, as
 * on a texture packed in an atlas.
 *
 * @param raw - One element of the `files` array.
 * @returns The file, or `undefined` when the element is not an object.
 */
function parseFile(raw: unknown): ManifestFile | undefined {
  if (!isRecord(raw)) return undefined;

  const kind = parseKind(raw.kind);
  const pages = parseFontPages(raw.pages);
  const nine = parseNine(raw.nine);
  const atlas = parseAtlas(raw.atlas);
  const path = typeof raw.path === "string" ? raw.path : undefined;

  return {
    key: stringAt(raw, "key"),
    ...(path === undefined ? {} : { path }),
    width: numberAt(raw, "width"),
    height: numberAt(raw, "height"),
    mb: numberAt(raw, "mb"),
    ...(kind === undefined ? {} : { kind }),
    ...(pages === undefined ? {} : { pages }),
    ...(nine === undefined ? {} : { nine }),
    ...(atlas === undefined ? {} : { atlas })
  };
}

/**
 * Tells what one file of a bundle is. A file that names no kind is a texture, so a manifest of
 * an older game reads the same way.
 *
 * @param file - One file of a bundle.
 * @returns The kind of the file.
 * @example
 * ```ts
 * kindOf({ key: "ui.panel", path: "p.png", width: 8, height: 8, mb: 0 }); // "texture"
 * ```
 */
export function kindOf(file: ManifestFile): AssetKind {
  return file.kind ?? "texture";
}

/**
 * Reads the tier of a bundle.
 *
 * @param name - Bundle name, for the message.
 * @param value - What the `tier` field carried.
 * @returns The tier.
 * @throws {Error} When the tier is not one of the five.
 */
function parseTier(name: string, value: unknown): Tier {
  if (typeof value === "string" && TIERS.includes(value)) return value as Tier;

  throw new Error(
    `[game] assets: bundle "${name}" has the unknown tier "${String(value)}".\n` +
      `  Use one of ${TIERS.join(", ")}.`
  );
}

/**
 * Reads one bundle entry, with its pages sorted by id and its files sorted by key.
 *
 * @param name - Bundle name.
 * @param raw - What the manifest carried under that name.
 * @returns The bundle.
 * @throws {Error} When the entry is not an object or its tier is unknown.
 */
function parseBundle(name: string, raw: unknown): ManifestBundle {
  if (!isRecord(raw)) {
    throw new Error(
      `[game] assets: bundle "${name}" of the manifest is not an object.\n` +
        `  Rebuild the manifest with "bun run assets:keys".`
    );
  }

  const files = (Array.isArray(raw.files) ? raw.files : [])
    .map(entry => parseFile(entry))
    .filter((file): file is ManifestFile => file !== undefined)
    .toSorted((left, right) => left.key.localeCompare(right.key));

  const pages = parseAtlasPages(raw.pages);

  return {
    feature: stringAt(raw, "feature"),
    tier: parseTier(name, raw.tier),
    mb: numberAt(raw, "mb"),
    ...(pages === undefined ? {} : { pages }),
    files
  };
}

/**
 * Reads the version of a manifest: `1` from the scanner, `2` from the packer.
 *
 * @param value - What the `version` field carried.
 * @returns The version.
 * @throws {Error} When it is neither.
 */
function parseVersion(value: unknown): Manifest["version"] {
  if (value === 1 || value === 2) return value;

  throw new Error(
    `[game] assets: manifest version ${String(value)} is not supported (expected 1 or 2).\n` +
      `  Rebuild the manifest with "bun run assets:keys".`
  );
}

/**
 * Reads a manifest as the scanner (version 1) or the packer (version 2) wrote it. Bundles come
 * out sorted by name, pages by id and files by key, unknown fields are ignored and any other
 * version is refused.
 *
 * @param raw - The parsed JSON, or the inline manifest of a test.
 * @returns The manifest.
 * @throws {Error} When the value is not a manifest, its version is not 1 or 2, or a tier is unknown.
 * @example
 * ```ts
 * parseManifest({ version: 2, bundles: {} }); // { version: 2, bundles: {} }
 * ```
 */
export function parseManifest(raw: unknown): Manifest {
  if (!isRecord(raw)) {
    throw new Error(
      "[game] assets: the manifest is not an object.\n" +
        '  Point "manifest" at a manifest.json, or pass the parsed object.'
    );
  }

  const version = parseVersion(raw.version);
  const source = isRecord(raw.bundles) ? raw.bundles : {};
  const bundles: Record<string, ManifestBundle> = {};

  for (const name of Object.keys(source).toSorted((left, right) => left.localeCompare(right))) {
    bundles[name] = parseBundle(name, source[name]);
  }

  return { version, bundles };
}

/**
 * Builds the asset key index: which bundle carries which key.
 *
 * @param manifest - The parsed manifest.
 * @returns Asset key to bundle name.
 * @example
 * ```ts
 * const index = indexKeys(parseManifest(json));
 * index.get("ui.panel"); // "ui"
 * ```
 */
export function indexKeys(manifest: Manifest): Map<string, string> {
  const index = emptyMap<string, string>();

  for (const [name, bundle] of Object.entries(manifest.bundles)) {
    for (const file of bundle.files) index.set(file.key, name);
  }

  return index;
}

/**
 * Works out the prefix of every file URL: the configured one, the folder of the manifest URL, or
 * the site root for an inline manifest.
 *
 * @param baseUrl - What the config carried.
 * @param source - What the config named as the manifest.
 * @returns The prefix, always ending in a slash.
 * @example
 * ```ts
 * resolveBaseUrl(undefined, "/assets/manifest.json"); // "/assets/"
 * ```
 */
export function resolveBaseUrl(
  baseUrl: string | undefined,
  source: string | Manifest | undefined
): string {
  if (baseUrl !== undefined) return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  if (typeof source === "string") {
    const cut = source.lastIndexOf("/");

    return cut === -1 ? "/" : source.slice(0, cut + 1);
  }

  return "/";
}

/**
 * Joins the prefix and the POSIX path of a file.
 *
 * @param base - The prefix, ending in a slash.
 * @param path - The path of the file: relative to the scan root in a dev manifest, to the pack
 *   folder in a packed one.
 * @returns The URL to fetch.
 * @example
 * ```ts
 * fileUrl("/assets/", "features/ui/assets/panel.png"); // "/assets/features/ui/assets/panel.png"
 * ```
 */
export function fileUrl(base: string, path: string): string {
  return `${base}${path.startsWith("/") ? path.slice(1) : path}`;
}

/**
 * Works out what an image costs in texture memory: `width × height × 4` bytes as megabytes,
 * rounded to 3 decimals. It is the number the scanner writes for a texture and for a font page;
 * the dev hot swap writes it again for a file that came back with another size.
 *
 * @param width - Width of the image in pixels.
 * @param height - Height of the image in pixels.
 * @returns The megabytes.
 * @example
 * ```ts
 * textureMb(256, 128); // 0.125
 * ```
 */
export function textureMb(width: number, height: number): number {
  return (
    Math.round(((width * height * BYTES_PER_PIXEL) / BYTES_PER_MB) * PARTS_PER_MB) / PARTS_PER_MB
  );
}

/**
 * Adds up megabytes, rounded to 3 decimals: the pages of a font give the font, the files and the
 * atlas pages of a bundle give the bundle.
 *
 * @param parts - The records to add up.
 * @returns The sum.
 * @example
 * ```ts
 * sumMb([{ mb: 0.125 }, { mb: 0.063 }, { mb: 0.021 }]); // 0.209
 * ```
 */
export function sumMb(parts: readonly { mb: number }[]): number {
  let total = 0;

  for (const part of parts) total += part.mb;

  return Math.round(total * PARTS_PER_MB) / PARTS_PER_MB;
}

/**
 * Turns the nine-slice metadata of a file into the options `renderer.sync.textures.create` takes.
 *
 * @param file - One file of a bundle.
 * @returns The options, or `undefined` for a plain file.
 * @example
 * ```ts
 * nineOf({ key: "ui.panel", path: "p.png", width: 256, height: 128, mb: 0.125,
 *   nine: { left: 48, top: 48, right: 48, bottom: 48 } }); // { nine: [48, 48, 48, 48] }
 * ```
 */
export function nineOf(file: ManifestFile): CreateTextureOptions | undefined {
  const nine = file.nine;

  if (nine === undefined) return undefined;

  return { nine: [nine.left, nine.top, nine.right, nine.bottom] };
}
