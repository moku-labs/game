/**
 * @file app — watches the installed engine and tells when the served engine or its patch changed:
 * the dev server restarts its child on a new engine, and the editor's dev server does the same
 * through `watchEngine` of `@moku-labs/game/cli`. Node and Bun only; the fingerprint is the one of
 * `./engine`.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createBatcher } from "../project/watch";
import type { CliDeps, Watcher } from "./cli";
import { type EngineFingerprint, engineFingerprint, installRootOf } from "./engine";

/**
 * One change the engine watch saw.
 *
 * @example
 * ```ts
 * // `bun patch --commit` rebuilt the engine's dist: the served engine changed.
 * const change: EngineChange = { before: { id: "0.14.12+1a2b3c", version: "0.14.12", dist: "1a2b3c…", folder: "/g/node_modules/@moku-labs/game" }, after: { id: "0.14.12+9c41e0", version: "0.14.12", dist: "9c41e0…", folder: "/g/node_modules/@moku-labs/game" }, restart: true };
 * ```
 */
export type EngineChange = {
  /** The fingerprint the watch had until this change. */
  before: EngineFingerprint;
  /** The fingerprint of the engine now installed. */
  after: EngineFingerprint;
  /** True when the served engine changed (version or dist): the page server must restart. False: only the patch file. */
  restart: boolean;
};

/**
 * The seams of the watch: the folder watcher and Bun's resolver, as `CliDeps` has them.
 *
 * @example
 * ```ts
 * // The dev parent passes its own seams: watchEngineAt(run.root, page.engine, deps, onChange).
 * const seams: EngineSeams = { watch: (folder, listener) => fs.watch(folder, listener), resolve: Bun.resolveSync };
 * ```
 */
export type EngineSeams = Pick<CliDeps, "watch" | "resolve">;

/** The quiet that closes one batch of engine events: an install writes many files. */
const ENGINE_QUIET_MS = 300;

/** The lock files of an install root, the first one found is watched. */
const LOCK_FILES = ["bun.lock", "bun.lockb"] as const;

/** The length of a hash as an engine id shows it. */
const SHORT_HASH = 6;

/**
 * Tells whether a path exists.
 *
 * @param file - The path.
 * @returns True for an existing file or folder.
 */
function exists(file: string): boolean {
  return statSync(file, { throwIfNoEntry: false }) !== undefined;
}

/**
 * Lists a folder and every folder under it.
 *
 * @param folder - The folder.
 * @returns The folders, `folder` first; none when it is missing.
 */
function foldersUnder(folder: string): string[] {
  if (statSync(folder, { throwIfNoEntry: false })?.isDirectory() !== true) return [];

  const inner = readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isDirectory());

  return [folder, ...inner.flatMap(entry => foldersUnder(path.join(folder, entry.name)))];
}

/**
 * The paths the watch opens for an engine: the scope folder (an install replaces the engine
 * folder), the engine folder, every folder of its `dist`, the folder of the patch, and the
 * `package.json` and lock file of the install root. An engine from its sources or an unidentified
 * one opens none.
 *
 * @param start - The fingerprint to watch.
 * @param root - The game folder.
 * @returns The existing paths, each once.
 */
function watchedPaths(start: EngineFingerprint, root: string): string[] {
  if (start.dist === "src" || start.dist === "unknown") return [];

  const installRoot = installRootOf(root);
  const rootFiles =
    installRoot === undefined
      ? []
      : [
          path.join(installRoot, "package.json"),
          ...LOCK_FILES.map(file => path.join(installRoot, file))
            .filter(file => exists(file))
            .slice(0, 1)
        ];
  const paths = [
    path.dirname(start.folder),
    start.folder,
    ...foldersUnder(path.join(start.folder, "dist")),
    ...(start.patch === undefined ? [] : [path.dirname(start.patch.file)]),
    ...rootFiles
  ];

  return [...new Set(paths)].filter(file => exists(file));
}

/**
 * The short hash of a patch, as an engine id shows it.
 *
 * @param patch - The patch, or `undefined` without one.
 * @returns The first six hex digits, or `none`.
 * @example
 * ```ts
 * patchName(undefined); // "none"
 * ```
 */
function patchName(patch: EngineFingerprint["patch"]): string {
  return patch === undefined ? "none" : patch.hash.slice(0, SHORT_HASH);
}

/**
 * The warning lines `moku-game dev` prints for a change.
 *
 * @param change - The change.
 * @returns The lines, the first one a `[game]` message.
 * @example
 * ```ts
 * engineChangeLines({ before: { id: "0.14.12+1a2b3c", version: "0.14.12", dist: "1a2b3c", folder: "/e" }, after: { id: "0.14.12+9c41e0", version: "0.14.12", dist: "9c41e0", folder: "/e" }, restart: true }); // ["[game] dev: the engine changed (0.14.12+1a2b3c -> 0.14.12+9c41e0), restarting the dev server."]
 * ```
 */
export function engineChangeLines(change: EngineChange): readonly string[] {
  const { before, after } = change;

  if (!change.restart) {
    return [
      `[game] dev: the engine's patch changed (${patchName(before.patch)} -> ${patchName(after.patch)}), but the installed engine did not.`,
      "  Run bun install; the dev server restarts by itself when the engine changes."
    ];
  }

  const changed = `[game] dev: the engine changed (${before.id} -> ${after.id}), restarting the dev server.`;

  return before.version === after.version
    ? [changed]
    : [
        changed,
        `  This process keeps the tools of ${before.version} (the keys watch); restart moku-game dev to use ${after.version}'s.`
      ];
}

/** The running engine watch: the fingerprint it compares with, its open watchers. */
type EngineWatch = {
  /** The fingerprint of the last batch, or of the start. */
  current: EngineFingerprint;
  /** The open watchers. */
  watchers: Watcher[];
  /** True once `close()` ran. */
  closed: boolean;
  /** Closes the watchers and opens them again from `current`. */
  open?: () => void;
};

/**
 * Closes every open watcher of the watch.
 *
 * @param watch - The running watch.
 */
function closeWatchers(watch: EngineWatch): void {
  for (const watcher of watch.watchers.splice(0)) watcher.close();
}

/**
 * One batch: fingerprints the engine again, calls `onChange` when the served engine or its patch
 * changed, and opens the watchers again: a replaced folder killed its watcher, and a new `dist`
 * folder needs one. An engine that cannot be read goes to `onError`.
 *
 * @param root - The game folder.
 * @param watch - The running watch.
 * @param seams - The resolver.
 * @param onChange - Called with the change.
 * @param onError - Called when the engine cannot be read.
 */
function checkEngine(
  root: string,
  watch: EngineWatch,
  seams: EngineSeams,
  onChange: (change: EngineChange) => void,
  onError: ((message: string) => void) | undefined
): void {
  const before = watch.current;
  let after: EngineFingerprint;

  try {
    after = engineFingerprint(root, seams.resolve("@moku-labs/game/hot", root));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    onError?.(`[game] dev: the engine cannot be read (${reason}). Waiting for the next change.`);
    watch.open?.();
    return;
  }

  const restart = before.version !== after.version || before.dist !== after.dist;
  const repatched = before.patch?.hash !== after.patch?.hash;

  watch.current = after;
  watch.open?.();

  if (restart || repatched) onChange({ before, after, restart });
}

/**
 * Watches the engine's folders, its patch and the install root's lock. Every event waits for 300 ms
 * of quiet, then the engine is fingerprinted again: a new version or dist calls `onChange` with
 * `restart: true`, a new patch alone with `restart: false`, no change calls nothing. An engine that
 * cannot be read goes to `onError`, and the next event checks again. After each batch the watchers
 * open again from the current fingerprint.
 *
 * @param root - The game folder.
 * @param start - The fingerprint the server started with.
 * @param seams - The watcher and the resolver.
 * @param onChange - Called with each change.
 * @param onError - Called when the engine cannot be read; nothing by default.
 * @returns The running watch; `close()` ends it.
 */
export function watchEngineAt(
  root: string,
  start: EngineFingerprint,
  seams: EngineSeams,
  onChange: (change: EngineChange) => void,
  onError?: (message: string) => void
): Watcher {
  const watch: EngineWatch = { current: start, watchers: [], closed: false };
  const batcher = createBatcher(ENGINE_QUIET_MS, async () => {
    if (!watch.closed) checkEngine(root, watch, seams, onChange, onError);
  });

  watch.open = () => {
    closeWatchers(watch);

    for (const file of watchedPaths(watch.current, root)) {
      watch.watchers.push(seams.watch(file, () => batcher.poke()));
    }
  };
  watch.open();

  return {
    close: () => {
      if (watch.closed) return;

      watch.closed = true;
      batcher.cancel();
      closeWatchers(watch);
    }
  };
}
