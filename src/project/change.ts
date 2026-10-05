/**
 * @file project — what a batch changed, from the keys before and after it. A key that left one
 * file and appeared in another is a move; a key gone from every file is removed. A watcher learns
 * both from the change instead of diffing two indexes.
 */
import type { ProjectChange, ProjectIndex } from "./types";

/**
 * The files that define a key, each once, in the order of its anchors.
 *
 * @param entry - The symbol entry.
 * @param entry.def - Its definitions.
 * @returns The paths.
 */
function pathsOf(entry: ProjectIndex["symbols"][string]): string[] {
  return [...new Set(entry.def.map(anchor => anchor.path))];
}

/**
 * Compares the index before a batch with the index after it.
 *
 * @param before - The index before the batch.
 * @param after - The index after the batch.
 * @param files - The paths whose bytes changed, appeared or vanished.
 * @returns The change: the new revision, the files sorted, the moves and the removed keys.
 */
export function diffIndexes(
  before: ProjectIndex,
  after: ProjectIndex,
  files: readonly string[]
): ProjectChange {
  const moved: ProjectChange["moved"] = [];
  const removed: string[] = [];

  for (const [key, entry] of Object.entries(before.symbols)) {
    const now = after.symbols[key];

    if (now === undefined) {
      removed.push(key);
      continue;
    }

    // Pair the files the key left with the files it arrived in, in order.
    const was = pathsOf(entry);
    const is = pathsOf(now);
    const left = was.filter(file => !is.includes(file));
    const arrived = is.filter(file => !was.includes(file));

    for (const [index, from] of left.entries()) {
      const to = arrived[index];

      if (to !== undefined) moved.push({ key, from, to });
    }
  }

  return { revision: after.revision, files: files.toSorted(), moved, removed };
}
