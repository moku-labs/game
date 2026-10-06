/**
 * @file project — the watcher of an open project. A platform event is only a trigger: Bun on macOS
 * reports every edit as `rename`, drops the destination of a move and names the `.tmp` of an
 * atomic save instead of the file. So events only poke a batcher; when the quiet period ends, the
 * batch walks the root (`syncWithDisk`) and finds what really changed. The watcher can also miss a
 * write made as it starts, so the handle walks once when watching starts and then every two
 * seconds as a backstop. The root is watched recursively; where the platform cannot, every folder
 * of the last walk gets its own watcher, re-armed after each walk. Every caller of `watch` shares
 * the one watcher of the handle.
 */
import { watch } from "node:fs";
import path from "node:path";
import { isSkippedPath } from "./paths";
import { type Session, serialize, syncWithDisk } from "./session";
import type { ProjectChange, ProjectIndex } from "./types";

/** A watcher of the platform, as `fs.watch` returns it. */
export type WatchHandle = {
  close(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
};

/** `fs.watch`, or a stand-in a test drives. */
export type WatchFunction = (
  folder: string,
  options: { recursive: boolean },
  listener: (event: string, file: string | null) => void
) => WatchHandle;

/** The watcher of one root. */
export type TreeWatcher = {
  /** Watches the folders of the last walk, root-relative; a no-op on a recursive watcher. */
  rearm(folders: readonly string[]): void;
  close(): void;
};

/** A debounce that runs one batch at a time. */
export type Batcher = {
  /** Notes an event: the batch runs after the quiet period, or at the longest wait. */
  poke(): void;
  /** Drops the pending batch; a running one finishes. */
  cancel(): void;
};

/** A caller of `watch`. */
export type IndexListener = (index: ProjectIndex, change: ProjectChange) => void;

/** The callers of `watch` of one handle, and their shared watcher. */
export type Hub = {
  /** Adds a caller and starts the watcher with the first one. */
  add(listener: IndexListener): () => void;
  /** Stops the watcher and drops every caller. */
  close(): void;
};

/** The longest a burst of events holds a batch back, at the least. */
const LONGEST_WAIT_MS = 1000;

/** The longest wait as a multiple of the quiet period, when that is longer. */
const LONGEST_WAIT_FACTOR = 10;

/**
 * How often a watching handle walks the root with no event: the platform watcher can miss a write
 * made as it starts, and drop events under load. A walk that finds the same bytes calls nobody.
 */
const BACKSTOP_MS = 2000;

/** The error `watch` throws on a closed handle. */
const CLOSED = "[game] The project is closed.\n  Open it again with openProject().";

/**
 * Watches every folder of the last walk with its own watcher, for a platform without recursive
 * watching.
 *
 * @param root - The real root.
 * @param listener - Gets every event.
 * @param onError - Called when a folder watcher errors.
 * @param watchFunction - `fs.watch`.
 * @returns The tree watcher.
 */
function watchFolders(
  root: string,
  listener: (event: string, file: string | null) => void,
  onError: () => void,
  watchFunction: WatchFunction
): TreeWatcher {
  const watchers = new Map<string, WatchHandle>();

  const arm = (folder: string): void => {
    try {
      const handle = watchFunction(path.join(root, folder), { recursive: false }, listener);

      // A watcher that errored is dropped and pokes a walk at once, which arms the folder again.
      handle.on("error", () => {
        handle.close();
        if (watchers.get(folder) === handle) watchers.delete(folder);
        onError();
      });
      watchers.set(folder, handle);
    } catch {
      // The folder vanished after the walk: the next walk does not list it.
    }
  };

  return {
    rearm: folders => {
      for (const [folder, handle] of watchers) {
        if (folders.includes(folder)) continue;
        handle.close();
        watchers.delete(folder);
      }

      for (const folder of folders) if (!watchers.has(folder)) arm(folder);
    },
    close: () => {
      for (const handle of watchers.values()) handle.close();
      watchers.clear();
    }
  };
}

/**
 * Watches a root: recursively when the platform can, else one watcher per folder. Events under
 * the skipped folders are ignored.
 *
 * @param root - The real root.
 * @param onEvent - Called on every event that may matter.
 * @param watchFunction - `fs.watch` by default.
 * @returns The tree watcher.
 */
export function watchTree(
  root: string,
  onEvent: () => void,
  watchFunction: WatchFunction = watch
): TreeWatcher {
  const listener = (_event: string, file: string | null): void => {
    if (file === null || !isSkippedPath(`${file}/`)) onEvent();
  };

  try {
    const handle = watchFunction(root, { recursive: true }, listener);

    handle.on("error", () => onEvent());

    return {
      rearm: () => {
        // A recursive watcher already sees every folder, new ones too.
      },
      close: () => handle.close()
    };
  } catch {
    return watchFolders(root, listener, onEvent, watchFunction);
  }
}

/**
 * Creates the debounce of a watcher: a batch runs once the events stop for `quietMs`, or after the
 * longest wait during an endless burst. One batch runs at a time; events during a batch queue one
 * more.
 *
 * @param quietMs - The quiet period that closes a batch.
 * @param run - The batch.
 * @returns The batcher.
 */
export function createBatcher(quietMs: number, run: () => Promise<void>): Batcher {
  const longestMs = Math.max(LONGEST_WAIT_MS, quietMs * LONGEST_WAIT_FACTOR);
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let longest: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = false;
  let cancelled = false;

  const clear = (): void => {
    clearTimeout(quiet);
    clearTimeout(longest);
    quiet = undefined;
    longest = undefined;
  };

  const fire = (): void => {
    clear();

    if (running) {
      pending = true;
      return;
    }

    const settle = (): void => {
      running = false;
      if (pending && !cancelled) poke();
      pending = false;
    };

    // A batch that fails leaves the index as it was; the next event starts another.
    running = true;
    run().then(settle, settle);
  };

  const poke = (): void => {
    if (cancelled) return;

    clearTimeout(quiet);
    quiet = setTimeout(fire, quietMs);
    longest ??= setTimeout(fire, longestMs);
  };

  return {
    poke,
    cancel: () => {
      cancelled = true;
      clear();
    }
  };
}

/**
 * Creates the callers' hub of one handle: the watcher starts with the first caller and stops with
 * the last; each batch that changed the index calls every caller once.
 *
 * @param session - The open project.
 * @param debounceMs - The quiet period.
 * @param watchFunction - `fs.watch` by default.
 * @param backstopMs - The period of the walk with no event, two seconds by default.
 * @returns The hub.
 */
export function createHub(
  session: Session,
  debounceMs: number,
  watchFunction: WatchFunction = watch,
  backstopMs = BACKSTOP_MS
): Hub {
  const listeners = new Set<{ readonly listener: IndexListener }>();
  let tree: TreeWatcher | undefined;
  let batcher: Batcher | undefined;
  let backstop: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const batch = async (): Promise<void> => {
    const change = await serialize(session, () => syncWithDisk(session));

    tree?.rearm(session.folders);
    if (change === undefined || closed) return;

    // eslint-disable-next-line unicorn/no-useless-spread -- a caller may stop itself while it is called
    for (const { listener } of [...listeners]) {
      try {
        listener(session.index, change);
      } catch {
        // A caller's error is its own: the other callers still hear the batch.
      }
    }
  };

  const stop = (): void => {
    clearInterval(backstop);
    tree?.close();
    batcher?.cancel();
    backstop = undefined;
    tree = undefined;
    batcher = undefined;
  };

  const start = (): void => {
    const started = createBatcher(debounceMs, batch);

    batcher = started;
    tree = watchTree(session.root, () => started.poke(), watchFunction);
    tree.rearm(session.folders);

    // Walk once now, for what changed since the index was built, and then on a backstop period,
    // for what the platform watcher missed.
    started.poke();
    backstop = setInterval(() => started.poke(), backstopMs);
  };

  return {
    add: listener => {
      if (closed) throw new Error(CLOSED);

      const entry = { listener };

      listeners.add(entry);
      if (tree === undefined) start();

      return () => {
        listeners.delete(entry);
        if (listeners.size === 0) stop();
      };
    },
    close: () => {
      closed = true;
      listeners.clear();
      stop();
    }
  };
}
