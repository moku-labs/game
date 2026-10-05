/**
 * @file project — `openProject`, the one function of the project index a caller starts from. It
 * opens the root, builds the index and hands back the handle: the current index, `find`, `watch`,
 * `changed` and `close`.
 */
import { findKey } from "./find";
import { openSession, reindexPath, serialize } from "./session";
import type { ProjectApi, ProjectOptions } from "./types";
import { createHub } from "./watch";

/** The quiet period that closes a watch batch, when the options name none. */
const DEFAULT_DEBOUNCE_MS = 75;

/**
 * Opens the project index of a game: checks the root (it exists, it is a directory, its real
 * path), loads TypeScript, parses every source file and builds the index. Nothing is written to
 * disk and nothing is inferred from the working directory but the root itself.
 *
 * @param options - The game root, the manifest path and the quiet period of `watch`.
 * @returns The handle; close it when the game closes.
 * @throws {Error} When the root is missing or not a directory, or the `typescript` package is not
 *   installed: `[game] The project index needs the "typescript" package.`
 * @example
 * ```ts
 * // The editor opens the fixture game and answers where a node and a text style live.
 * const project = await openProject({ root: "tests/integration/merge-game" });
 * Object.keys(project.index.files).length; // 111
 * (await project.find("textStyle:ui.title"))[0]?.line; // 39, in "features/ui/styles.ts"
 * project.close();
 * ```
 */
export async function openProject(options: ProjectOptions): Promise<ProjectApi> {
  const session = await openSession(options);
  const hub = createHub(session, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);

  return {
    /**
     * The current index of the session; a batch or `changed` replaces it.
     *
     * @returns The index.
     */
    get index() {
      return session.index;
    },
    find: key => findKey(session, key),
    watch: onIndex => hub.add(onIndex),
    changed: file => serialize(session, () => reindexPath(session, file)),
    close: () => hub.close()
  };
}
