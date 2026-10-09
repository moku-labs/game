/**
 * @file The file write of the files `moku-game` generates for a game. The dev page and the stamp
 * of the keys watch go through it: a file the dev server watches is touched only when its text
 * changed. Node and Bun only: the bin bundles it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Writes a file only when its text changed, so a second run wakes no watcher.
 *
 * @param file - The absolute path.
 * @param text - The text.
 */
export function writeIfChanged(file: string, text: string): void {
  if (existsSync(file) && readFileSync(file, "utf8") === text) return;

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
