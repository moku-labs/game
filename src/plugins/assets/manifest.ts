/**
 * @file assets plugin — the manifest: parsing, the key index and the URL of a file. Pure
 * functions over plain JSON, so the scanner, the plugin and the editor read the same contract.
 */
import type {
  AssetKind,
  AtlasFrame,
  CreateTextureOptions,
  FontPage,
  Manifest,
  ManifestBundle,
  ManifestFile,
  NineSlice,
  Tier
} from "./types";

const TIERS: readonly string[] = ["boot", "core", "scene", "feature", "lazy"];

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
 * Reads the reserved atlas placement of a file.
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
function parsePages(value: unknown): readonly FontPage[] | undefined {
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
 * Reads one file entry. Unknown fields are dropped.
 *
 * @param raw - One element of the `files` array.
 * @returns The file, or `undefined` when the element is not an object.
 */
function parseFile(raw: unknown): ManifestFile | undefined {
  if (!isRecord(raw)) return undefined;

  const kind = parseKind(raw.kind);
  const pages = parsePages(raw.pages);
  const nine = parseNine(raw.nine);
  const atlas = parseAtlas(raw.atlas);
  const file: ManifestFile = {
    key: stringAt(raw, "key"),
    path: stringAt(raw, "path"),
    width: numberAt(raw, "width"),
    height: numberAt(raw, "height"),
    mb: numberAt(raw, "mb")
  };

  return {
    ...file,
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
 * Reads one bundle entry, with its files sorted by key.
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

  return {
    feature: stringAt(raw, "feature"),
    tier: parseTier(name, raw.tier),
    mb: numberAt(raw, "mb"),
    files
  };
}

/**
 * Reads a manifest as the scanner wrote it. Bundles come out sorted by name and files by key,
 * unknown fields are ignored and an unsupported version is refused.
 *
 * @param raw - The parsed JSON, or the inline manifest of a test.
 * @returns The manifest.
 * @throws {Error} When the value is not a manifest, its version is not 1 or a tier is unknown.
 * @example
 * ```ts
 * const manifest = parseManifest({ version: 1, bundles: {} });
 * manifest.bundles; // {}
 * ```
 */
export function parseManifest(raw: unknown): Manifest {
  if (!isRecord(raw)) {
    throw new Error(
      "[game] assets: the manifest is not an object.\n" +
        '  Point "manifest" at a manifest.json, or pass the parsed object.'
    );
  }

  if (raw.version !== 1) {
    throw new Error(
      `[game] assets: manifest version ${String(raw.version)} is not supported (expected 1).\n` +
        `  Rebuild the manifest with "bun run assets:keys".`
    );
  }

  const source = isRecord(raw.bundles) ? raw.bundles : {};
  const bundles: Record<string, ManifestBundle> = {};

  for (const name of Object.keys(source).toSorted((left, right) => left.localeCompare(right))) {
    bundles[name] = parseBundle(name, source[name]);
  }

  return { version: 1, bundles };
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
 * @param path - The path of the file, relative to the scan root.
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

/**
 * Looks for a file that is packed in an atlas. This version loads loose files only, so such a
 * bundle fails with a message that names the file.
 *
 * @param bundle - Name of the bundle.
 * @param files - Its files.
 * @returns The message, or `undefined` when every file is loose.
 * @example
 * ```ts
 * atlasProblem("ui", []); // undefined
 * ```
 */
export function atlasProblem(bundle: string, files: readonly ManifestFile[]): string | undefined {
  for (const file of files) {
    if (file.atlas === undefined) continue;

    return (
      `[game] assets: file "${file.path}" of bundle "${bundle}" is packed in an atlas, ` +
      "which this version cannot load.\n" +
      '  Rebuild the manifest with "bun run assets:keys".'
    );
  }

  return undefined;
}
