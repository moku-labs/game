/**
 * @file The saves of the page: `localSave` keeps the player in `localStorage`, `pageSave` picks
 * the save `config.save` names. The store save is the system shell's (`storeSave` of
 * `./system`): this file imports no system code, so a web-only page bundles none. Not exported
 * from any entry: the page is the one caller.
 */

import { applyTo } from "../plugins/model/store/drafts";
import { memory } from "../plugins/model/store/providers/memory";
import type { JsonDocument, Patch, PlayerStateProvider } from "../plugins/model/store/types";
import type { Json } from "../plugins/model/types";
import type { SaveKind, SystemShell } from "./types";

/** What `localStorage` holds under the key: the whole document and its schema version. */
type Stored = { state: JsonDocument; version: number };

/** Where `pageSave` finds what the save needs: the key prefix, the shell, the late reporter. */
type SaveWhere = {
  /** The key prefix: the native identifier, or `"moku-game"`. */
  namespace: string;
  /** The system shell, when the page has one. */
  shell: SystemShell | undefined;
  /** Where a problem goes: the app's warn log once the app exists. */
  report: (problem: string) => void;
};

/**
 * Tells whether a JSON value is an object, not an array or `null`.
 *
 * @param value - A JSON value.
 * @returns True for a JSON object.
 * @example
 * ```ts
 * isDocument([1, 2]); // false
 * ```
 */
function isDocument(value: Json | undefined): value is JsonDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the stored text as a save: the document and its schema version.
 *
 * @param text - What `localStorage` holds under the key.
 * @returns The save, or `undefined` when the text is not JSON or not a save.
 * @example
 * ```ts
 * parseStored('{ "state": {}, "version": 1 }'); // { state: {}, version: 1 }
 * ```
 */
function parseStored(text: string): Stored | undefined {
  try {
    const value = JSON.parse(text) as Json;

    if (!isDocument(value) || !isDocument(value.state) || typeof value.version !== "number") {
      return undefined;
    }

    return { state: value.state, version: value.version };
  } catch {
    return undefined;
  }
}

/**
 * Says what a failed write threw, without a closing period: the sentence adds its own.
 *
 * @param thrown - What `setItem` threw.
 * @returns The message.
 * @example
 * ```ts
 * reasonOf(new Error("The quota has been exceeded.")); // "The quota has been exceeded"
 * ```
 */
function reasonOf(thrown: unknown): string {
  const message = thrown instanceof Error ? thrown.message : String(thrown);

  return message.endsWith(".") ? message.slice(0, -1) : message;
}

/**
 * Tries `localStorage` once: a write and a removal of a probe key.
 *
 * @param key - The key of the save.
 * @returns The storage, or `undefined` when the page has none or it refuses.
 */
function probeStorage(key: string): Storage | undefined {
  try {
    const storage = globalThis.localStorage;

    storage.setItem(`${key}:probe`, "1");
    storage.removeItem(`${key}:probe`);

    return storage;
  } catch {
    return undefined;
  }
}

/**
 * Makes the save that keeps the player in `localStorage` under one key. Each commit applies its
 * patches to the held document and writes the whole value at once: the value is small and the
 * write is synchronous, so nothing is pending and `flush` has nothing to do. A page with no
 * `localStorage`, or one that refuses a write (private mode, site data off), gets a memory save
 * and a report.
 *
 * @param key - The key of the save, `<namespace>:save`.
 * @param report - Where a problem goes: the app's warn log once the app exists.
 * @returns The save provider.
 */
export function localSave(key: string, report: (problem: string) => void): PlayerStateProvider {
  const storage = probeStorage(key);

  if (storage === undefined) {
    report(
      "[game] localStorage is not available, so the save lives in memory.\n  Progress is lost when the page closes."
    );

    return memory();
  }

  const held: { document: JsonDocument | undefined } = { document: undefined };

  /**
   * Applies one commit to the held document and writes the whole value.
   *
   * @param patches - The patches of the commit.
   * @param version - The schema version this build writes.
   * @returns The sentence of a failed write, or `undefined` when the value is written.
   */
  const write = (patches: Patch[], version: number): string | undefined => {
    const document = applyTo(held.document ?? {}, patches);
    const value: Stored = { state: document, version };

    held.document = document;

    try {
      storage.setItem(key, JSON.stringify(value));

      return undefined;
    } catch (error) {
      return `[game] The local save was not written: ${reasonOf(error)}.\n  Free browser storage; progress since the last write is lost on close.`;
    }
  };

  return {
    load: async () => {
      const text = storage.getItem(key);

      // eslint-disable-next-line unicorn/no-null -- `null` is the provider contract for a new player.
      if (text === null) return null;

      const stored = parseStored(text);

      if (stored === undefined) {
        throw new Error(
          `[game] The local save is not JSON.\n  Clear the site data or the key "${key}".`
        );
      }

      held.document = stored.state;

      return stored;
    },

    commit: (patches, version) => {
      const failure = write(patches, version);

      if (failure !== undefined) report(failure);
    },

    commitDurable: async (patches, _txId, version) => {
      const failure = write(patches, version);

      if (failure !== undefined) throw new Error(failure);
    },

    flush: () => Promise.resolve()
  };
}

/**
 * Picks the save `config.save` names: a fresh memory save, the local save under
 * `<namespace>:save`, or the system shell's store save.
 *
 * @param kind - The save kind of the resolved config.
 * @param where - The key prefix, the shell and the reporter.
 * @returns The save provider of the page.
 * @throws {Error} When the kind is `"store"` and the page has no shell with a store save.
 */
export function pageSave(kind: SaveKind, where: SaveWhere): PlayerStateProvider {
  switch (kind) {
    case "memory": {
      return memory();
    }
    case "local": {
      return localSave(`${where.namespace}:save`, where.report);
    }
    case "store": {
      if (where.shell?.save === undefined) {
        throw new Error(
          '[game] config.save is "store", but the page has no system shell.\n  Run moku-game dev or build again: it passes the shell when config.ts names save "store".'
        );
      }

      return where.shell.save;
    }
  }
}
