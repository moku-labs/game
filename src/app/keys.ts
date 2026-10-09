/**
 * @file The keys watch of a game folder, behind `moku-game dev` and the editor's `watchKeys`: it
 * keeps `generated/` fresh while a dev page is open. A file event is only a trigger. When the
 * events stop for a quiet period, a batch walks the game and reads the size and the time stamp of
 * every asset file and every `strings/<locale>.json`; it runs the scan of `moku-game keys` only
 * when they differ from the batch before. After a scan it writes `.moku/assets-stamp.ts` from the
 * asset files, so the dev page reloads and shows the new bytes of an image. One scan runs at a
 * time, and a failed scan never stops the watch. A batch that scanned is followed by one more
 * walk: the platform reports only the first path of a burst of writes, so a save made in the same
 * instant as the scan's own writes under `generated/` may never be reported. The scan, `fs.watch`
 * and the console come in as seams, so a test drives it. Node and Bun only: the bin bundles it.
 */
import { createHash } from "node:crypto";
import { type Dirent, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { BrandConsole } from "@moku-labs/common/cli";
import { isSkippedFolder } from "../project/paths";
import { createBatcher, type TreeWatcher, type WatchFunction, watchTree } from "../project/watch";
import { keysArguments } from "./build";
import { writeIfChanged } from "./files";
import { ASSETS_STAMP, assetsStamp } from "./generate";
import type { ResolvedGameConfig } from "./types";

/** The running keys watch of one game folder, as `watchKeys` answers it. */
export type KeysWatcher = {
  /**
   * Stops watching. A scan that is running finishes; no later one starts. A second call does
   * nothing.
   *
   * @example
   * ```ts
   * // The editor closes the game it has open.
   * const keys = await watchKeys("games/timber");
   * keys.close(); // a later save of features/home/strings/en.json rewrites nothing in generated/
   * ```
   */
  close(): void;
};

/** What `watchKeys` is started with. */
export type WatchKeysOptions = {
  /**
   * Called with the scanner's message when a scan fails: bad JSON in a strings file, a key two
   * files claim, a refused file. The watch goes on and the next save scans again. It is the only
   * printer of a scan error. Default: a warning on the branded console, `[game] keys: <message>`.
   *
   * @param message - The message of the scanner; one line per problem when it found several.
   * @example
   * ```ts
   * // The editor shows a failed scan in its own log, not in the terminal.
   * const keys = await watchKeys("games/timber", { onError: message => log.warn(message) });
   * // features/home/strings/en.json saved without its closing brace: under Bun log.warn gets
   * // "[game] i18n: features/home/strings/en.json could not be read: JSON Parse error: Expected '}'.\n  Fix the message or use a supported ICU feature."
   * ```
   */
  onError?: (message: string) => void;
};

/**
 * The part of the branded console the keys watch writes through: the same part as the command
 * line. Named here, so the types `@moku-labs/game/cli` ships do not reach the command line's.
 */
export type KeysUi = Pick<BrandConsole, "info" | "warn" | "error" | "line">;

/** The seams of the keys watch. `src/cli.ts` gives the real ones, a test gives stubs. */
export type KeysSeams = {
  /**
   * Runs the asset scanner's command line with the string tools, as `moku-game keys` does, and
   * writes its lines through the given console; answers its exit code.
   */
  scan: (argv: string[], ui: KeysUi) => Promise<number>;
  /** `fs.watch`, or a stand-in a test drives. */
  watch: WatchFunction;
  /** The real console: the lines of the first scan, the line of a later one, the default warning. */
  ui: KeysUi;
};

/** The size and the time stamp of every watched input of one walk, by root-relative path. */
type Inputs = ReadonlyMap<string, string>;

/** One walk of a game folder. */
type Walk = {
  /** The stamp `<size>:<mtimeMs>` of every asset file and every strings file. */
  inputs: Map<string, string>;
  /** Every folder walked, relative to the game with `/`; `""` is the game folder. */
  folders: string[];
};

/** What one keys watch holds while it runs. */
type Watch = {
  /** The real path of the game folder. */
  readonly root: string;
  /** The resolved config, read once at start: a changed layer needs a restart. */
  readonly settings: ResolvedGameConfig;
  /** The scan and the console. */
  readonly seams: KeysSeams;
  /** Gets the message of a failed scan. */
  readonly onError: (message: string) => void;
  /** The watcher of the game folder. */
  readonly tree: TreeWatcher;
  /** Asks for one more batch after the quiet period. It does nothing after `close`. */
  readonly again: () => void;
  /** The inputs of the batch before; `undefined` until the first scan. */
  inputs: Inputs | undefined;
  /** The lock: the batch that runs now, or the last one. Every batch awaits it first. */
  scanning: Promise<void>;
  /** True after `close`. */
  closed: boolean;
};

/** The quiet period that closes a batch of file events. */
const QUIET_MS = 100;

/** The asset files the scanner reads, by extension. */
const ASSET_FILE = /\.(?:png|webp|fnt|mp3|m4a)$/i;

/** A strings file: a `.json` directly in a `strings/` folder. */
const STRINGS_FILE = /(?:^|\/)strings\/[^/]+\.json$/;

/**
 * Lists one folder of the walk.
 *
 * @param folder - The absolute folder.
 * @returns Its entries; none when it cannot be read or vanished during the walk.
 */
function entriesOf(folder: string): Dirent[] {
  try {
    return readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Tells whether a file is an input of the scan: an asset file, or a strings file.
 *
 * @param file - The path relative to the game, with `/`.
 * @returns True for a file the watch stamps.
 * @example
 * ```ts
 * isInput("features/home/strings/en.json"); // true
 * ```
 */
function isInput(file: string): boolean {
  return ASSET_FILE.test(file) || STRINGS_FILE.test(file);
}

/**
 * Reads one folder of the walk and the folders below it, outside the skipped ones: every asset
 * file and every strings file joins the inputs with its stamp. Symlinks are not followed.
 *
 * @param root - The real game folder.
 * @param folder - The folder, relative to the game; `""` is the game folder.
 * @param walk - The inputs and the folders so far.
 */
function readFolder(root: string, folder: string, walk: Walk): void {
  walk.folders.push(folder);

  for (const entry of entriesOf(path.join(root, folder))) {
    const inGame = folder === "" ? entry.name : `${folder}/${entry.name}`;

    if (entry.isDirectory() && !isSkippedFolder(entry.name)) readFolder(root, inGame, walk);
    if (!entry.isFile() || !isInput(inGame)) continue;

    const stats = statSync(path.join(root, inGame), { throwIfNoEntry: false });

    // Gone between the listing and the stat: the next walk does not list it.
    if (stats !== undefined) walk.inputs.set(inGame, `${stats.size}:${stats.mtimeMs}`);
  }
}

/**
 * Walks a game folder for the inputs of the scan.
 *
 * @param root - The real game folder.
 * @returns The stamps of the inputs, and the folders on the way.
 */
function walkInputs(root: string): Walk {
  const walk: Walk = { inputs: new Map(), folders: [] };

  readFolder(root, "", walk);

  return walk;
}

/**
 * Lists the inputs that differ between two walks: added, removed, or saved again.
 *
 * @param before - The stamps of the walk before.
 * @param after - The stamps of this walk.
 * @returns The root-relative paths, sorted.
 * @example
 * ```ts
 * changedPaths(new Map([["a.png", "3:1"]]), new Map([["a.png", "4:2"], ["b.png", "1:1"]])); // ["a.png", "b.png"]
 * ```
 */
function changedPaths(before: Inputs, after: Inputs): string[] {
  const files = new Set([...before.keys(), ...after.keys()]);

  return [...files].filter(file => before.get(file) !== after.get(file)).toSorted();
}

/**
 * Hashes the asset files of a walk: their paths, sizes and time stamps. The strings files stay
 * out, so a strings save leaves the hash as it is.
 *
 * @param inputs - The stamps of a walk.
 * @returns The SHA-1 as 40 hex digits.
 * @example
 * ```ts
 * assetsHash(new Map([["features/home/strings/en.json", "9:1"]])); // "da39a3ee5e6b4b0d3255bfef95601890afd80709": no asset file
 * ```
 */
function assetsHash(inputs: Inputs): string {
  const assets = [...inputs]
    .filter(([file]) => ASSET_FILE.test(file))
    .map(([file, stamp]) => `${file}:${stamp}`)
    .toSorted();

  // eslint-disable-next-line sonarjs/hashing -- the version of the asset files the page reloads on, not a secret
  return createHash("sha1").update(assets.join("\n")).digest("hex");
}

/**
 * The line of a later scan that worked: the first changed input, and how many more.
 *
 * @param changed - The changed inputs, sorted, at least one.
 * @returns The line.
 * @example
 * ```ts
 * changeLine(["features/ui/assets/a.png", "features/ui/assets/b.png"]); // "keys: features/ui/assets/a.png and 1 more"
 * ```
 */
function changeLine(changed: readonly string[]): string {
  const more = changed.length - 1;

  return more === 0 ? `keys: ${changed[0]}` : `keys: ${changed[0]} and ${more} more`;
}

/**
 * The console a scan is handed. It records the scanner's errors and prints none: `onError` is
 * their only printer. The first scan prints its other lines as `moku-game keys` does; a later
 * scan drops them, the batch prints one line of its own.
 *
 * @param ui - The real console.
 * @param errors - Takes every error line of the scan.
 * @param first - True for the first scan of the watch.
 * @returns The console of one scan.
 */
function scanUi(ui: KeysUi, errors: string[], first: boolean): KeysUi {
  return {
    info: message => {
      if (first) ui.info(message);
    },
    warn: message => {
      if (first) ui.warn(message);
    },
    line: text => {
      if (first) ui.line(text);
    },
    error: message => {
      errors.push(message);
    }
  };
}

/**
 * The message of a scan that answered an exit code other than 0: the error lines it printed, one
 * per line, or the code itself when it printed none.
 *
 * @param code - The exit code of the scan, not 0.
 * @param errors - The error lines the scan printed.
 * @returns The message for `onError`.
 * @example
 * ```ts
 * failureText(1, []); // "the scan exited with code 1."
 * ```
 */
function failureText(code: number, errors: readonly string[]): string {
  return errors.length > 0 ? errors.join("\n") : `the scan exited with code ${code}.`;
}

/**
 * Runs the scan of `moku-game keys` for the game as it is on disk now. The flags are read again
 * for every scan: `--pseudo` depends on a `strings/en.json` being there.
 *
 * @param watch - The watch.
 * @param first - True for the first scan of the watch.
 * @returns The message of a failed scan, or `undefined` when it worked.
 */
async function failureOf(watch: Watch, first: boolean): Promise<string | undefined> {
  const errors: string[] = [];

  try {
    const argv = keysArguments(watch.root, watch.settings, false);
    const code = await watch.seams.scan(argv, scanUi(watch.seams.ui, errors, first));

    return code === 0 ? undefined : failureText(code, errors);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Runs the scan and says how it went: a failure goes to `onError`, a later scan that worked
 * prints one line. The first scan printed the scanner's own lines.
 *
 * @param watch - The watch.
 * @param changed - The changed inputs, sorted.
 * @param first - True for the first scan of the watch.
 */
async function scanAndReport(
  watch: Watch,
  changed: readonly string[],
  first: boolean
): Promise<void> {
  const failure = await failureOf(watch, first);

  if (failure !== undefined) watch.onError(failure);
  else if (!first) watch.seams.ui.info(changeLine(changed));
}

/**
 * One batch: walks the game, and scans when an input differs from the batch before; the first
 * batch always scans. Then it writes the stamp of the asset files, asks for one trailing batch,
 * and arms the folder watchers with the folders of the walk. A batch that did not scan asks for
 * nothing, so the trailing batch of a quiet game ends the chain.
 *
 * @param watch - The watch.
 */
async function runBatch(watch: Watch): Promise<void> {
  const walk = walkInputs(watch.root);
  const first = watch.inputs === undefined;
  const changed = changedPaths(watch.inputs ?? new Map(), walk.inputs);

  // Recorded before the scan: a file that breaks the scan is scanned once, not in a loop.
  watch.inputs = walk.inputs;

  if (first || changed.length > 0) {
    await scanAndReport(watch, changed, first);
    // The stamp follows the asset files alone, so it is rewritten only when one of them changed.
    writeIfChanged(
      path.join(watch.root, ".moku", ASSETS_STAMP),
      assetsStamp(assetsHash(walk.inputs))
    );
    // One more walk: a save in the same instant as these writes may not have been reported.
    watch.again();
  }

  if (!watch.closed) watch.tree.rearm(walk.folders);
}

/**
 * Runs one batch after the batch before it ended: two scans never write `generated/` at the same
 * time. A batch the batcher starts during the first scan waits here.
 *
 * @param watch - The watch.
 * @returns Resolves when the batch ended.
 */
function serialized(watch: Watch): Promise<void> {
  const batch = watch.scanning.then(() => runBatch(watch));

  watch.scanning = batch.catch(() => {
    // A batch that broke still unlocks the next one.
  });

  return batch;
}

/**
 * Starts the keys watch of a checked game: watches the folder, runs the scan of `moku-game keys`
 * once, and resolves after it, so `generated/` is fresh before a page is served. The watcher
 * starts first: a save the platform reports during the first scan starts a batch after it. Then
 * every batch of file events outside the skipped folders scans again when an asset file or a
 * strings file changed. A failed scan, the first one too, goes to `onError` and the watch goes on.
 *
 * @param root - The game folder, absolute.
 * @param settings - The resolved config.
 * @param seams - The scan, `fs.watch` and the console.
 * @param options - Where the message of a failed scan goes.
 * @returns The running watch.
 * @throws {Error} When the game folder is gone, or the first batch breaks outside the scan.
 */
export async function watchKeysAt(
  root: string,
  settings: ResolvedGameConfig,
  seams: KeysSeams,
  options: WatchKeysOptions = {}
): Promise<KeysWatcher> {
  // The real path and the error sink. The platform reports events under the real path, and a
  // temp folder is often a symlink. Without an `onError` a failed scan is a console warning.
  const real = realpathSync(root);
  const onError = options.onError ?? (message => seams.ui.warn(`[game] keys: ${message}`));

  // The batcher, the tree watcher and the state of the watch. The batcher names `watch` before
  // it is made, and reads it only at call time: when a batch runs, long after this stanza.
  const batcher = createBatcher(QUIET_MS, () => serialized(watch));
  const tree = watchTree(real, () => batcher.poke(), seams.watch);
  const watch: Watch = {
    root: real,
    settings,
    seams,
    onError,
    tree,
    again: () => batcher.poke(),
    inputs: undefined,
    scanning: Promise.resolve(),
    closed: false
  };

  // Close: no later batch starts and the watcher lets go. A second call does nothing.
  const close = (): void => {
    if (watch.closed) return;

    watch.closed = true;
    batcher.cancel();
    tree.close();
  };

  // The first scan runs now. A watcher left open would keep the process alive, so a batch that
  // breaks closes it.
  try {
    await serialized(watch);
  } catch (error) {
    close();
    throw error;
  }

  return { close };
}
