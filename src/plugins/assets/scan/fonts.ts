/**
 * @file assets plugin, build time — the page images a BMFont file names. A `.fnt` and its pages
 * are one asset, so the scanner has to read the file to know which images belong to it. Pure and
 * free of the file system: the three formats a font exporter writes are all text.
 */

/** `page id=0 file="body_0.png"` in the text format, `<page id="0" file="body_0.png"/>` in XML. */
const PAGE_FILE = /\bpage\b[^\n>]*?\bfile\s*=\s*"([^"]+)"/g;

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
 * Tells whether a parsed JSON value is an object, so its fields can be read.
 *
 * @param value - A value of the parsed font.
 * @returns `true` for an object or an array, `false` for `null` and every primitive.
 */
function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * Tells whether a parsed BMFont JSON value carries a list of pages.
 *
 * @param font - The parsed file.
 * @returns `true` when `font.pages` is an array.
 */
function hasPageList(font: unknown): font is { pages: unknown[] } {
  return isObject(font) && "pages" in font && Array.isArray(font.pages);
}

/**
 * Reads the file name of one BMFont JSON page: the page itself when it is a name, its `file`
 * field when it is an object with a name there.
 *
 * @param page - One entry of the `pages` list.
 * @returns The file name, or `undefined` when the page names none.
 */
function pageFile(page: unknown): string | undefined {
  if (typeof page === "string") return page;
  if (isObject(page) && "file" in page && typeof page.file === "string") return page.file;

  return undefined;
}

/**
 * Parses a BMFont JSON file.
 *
 * @param source - The file contents.
 * @param message - The problem to throw when the JSON cannot be read.
 * @returns The parsed file, still to be narrowed.
 * @throws {Error} When the JSON cannot be read.
 */
function parseFont(source: string, message: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    throw problem(message);
  }
}

/**
 * Reads the page names of a BMFont JSON file. A page is a file name, or an object with one.
 *
 * @param source - The file contents.
 * @param file - Path of the file, for the message.
 * @returns The page file names, in the order the font declares them.
 * @throws {Error} When the JSON cannot be read.
 */
function jsonPages(source: string, file: string): string[] {
  const font = parseFont(source, `the font "${file}" is not readable BMFont JSON.`);

  if (!hasPageList(font)) return [];

  return font.pages.map(page => pageFile(page)).filter(page => page !== undefined);
}

/**
 * Reads the page images one `.fnt` file names, whichever of the three BMFont formats it is in.
 *
 * @param source - The file contents.
 * @param file - Path of the file from the scan root, for the messages.
 * @returns The page file names, relative to the folder of the font, in declaration order.
 * @throws {Error} When the file names no page, or its JSON cannot be read.
 * @example
 * ```ts
 * pagesOfFont('page id=0 file="body_0.png"', "features/ui/assets/body.fnt"); // ["body_0.png"]
 * ```
 */
export function pagesOfFont(source: string, file: string): readonly string[] {
  const text = source.trimStart();
  const pages = text.startsWith("{")
    ? jsonPages(text, file)
    : [...source.matchAll(PAGE_FILE)].map(match => match[1] ?? "");

  if (pages.length === 0) throw problem(`the font "${file}" declares no page.`);

  return pages;
}

/**
 * Renames the pages of a BMFont JSON file, in declaration order. A page is a file name, or an
 * object with one; the object keeps its other fields.
 *
 * @param source - The file contents, starting with `{`.
 * @param names - The new page names, one per declared page.
 * @returns The file as compact JSON.
 * @throws {Error} When the JSON cannot be read.
 */
function renameJsonPages(source: string, names: readonly string[]): string {
  const font = parseFont(source, "a font to rename is not readable BMFont JSON.");

  if (!hasPageList(font)) return JSON.stringify(font);

  const pages = font.pages.map((page, index) => {
    const name = names[index];

    if (name === undefined) return page;
    if (typeof page === "string") return name;

    return isObject(page) ? { ...page, file: name } : { file: name };
  });

  // `pages` already is a key of the font, so the spread keeps it where the file had it.
  return JSON.stringify({ ...font, pages });
}

/**
 * Points a `.fnt` file at new page images, in the order it declares them: the packer renames
 * every page to its hashed name and rewrites the font, so nothing renames a page behind it. In
 * the text and XML formats only the `file="…"` of each page line changes; a JSON font is written
 * back compact.
 *
 * @param source - The file contents.
 * @param names - The new page names, relative to the folder of the font, one per declared page.
 * @returns The rewritten file contents.
 * @throws {Error} When a JSON font cannot be read.
 * @example
 * ```ts
 * renamePages('page id=0 file="body_0.png"', ["ui.body-0-c81f3e2d55.png"]);
 * // 'page id=0 file="ui.body-0-c81f3e2d55.png"'
 * ```
 */
export function renamePages(source: string, names: readonly string[]): string {
  const text = source.trimStart();

  if (text.startsWith("{")) return renameJsonPages(text, names);

  let index = 0;

  return source.replaceAll(PAGE_FILE, (line: string, file: string) => {
    const name = names[index] ?? file;

    index += 1;

    // The match ends with the old name and its closing quote.
    return `${line.slice(0, line.length - file.length - 1)}${name}"`;
  });
}
