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
 * Reads the page names of a BMFont JSON file. A page is a file name, or an object with one.
 *
 * @param source - The file contents.
 * @param file - Path of the file, for the message.
 * @returns The page file names, in the order the font declares them.
 * @throws {Error} When the JSON cannot be read.
 */
function jsonPages(source: string, file: string): string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch {
    throw problem(`the font "${file}" is not readable BMFont JSON.`);
  }

  const pages = (parsed as { pages?: unknown }).pages;

  if (!Array.isArray(pages)) return [];

  return pages
    .map(page => (typeof page === "string" ? page : (page as { file?: unknown }).file))
    .filter((page): page is string => typeof page === "string");
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
