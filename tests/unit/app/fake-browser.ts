/**
 * @file The browser the page and the local save see in a plain vitest run: a `localStorage` over
 * a map that can be told to refuse, a `matchMedia` list whose `change` a test fires, and a
 * `location`. Not a test file. Every stub goes through `vi.stubGlobal`, so `vi.unstubAllGlobals()`
 * takes it back.
 */
import { vi } from "vitest";

/** A `localStorage` over a map, and the switches that make it refuse. */
export type FakeStorage = {
  /** The object stubbed as `localStorage`. */
  storage: Storage;
  /** What is stored, by key. */
  items: Map<string, string>;
  /** Makes every `setItem` throw with this message, or lets it write again with `undefined`. */
  refuseWrites(message: string | undefined): void;
};

/**
 * Makes a `localStorage` over a map.
 *
 * @param items - What is stored before the test starts, by key.
 * @returns The storage, its map and the write switch.
 */
export function fakeStorage(items: Record<string, string> = {}): FakeStorage {
  const map = new Map(Object.entries(items));
  const refusal: { message: string | undefined } = { message: undefined };
  const storage = {
    get length() {
      return map.size;
    },
    // eslint-disable-next-line unicorn/no-null -- `Storage` answers a missing key with null.
    key: (index: number) => [...map.keys()][index] ?? null,
    // eslint-disable-next-line unicorn/no-null -- `Storage` answers a missing key with null.
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (refusal.message !== undefined) throw new Error(refusal.message);

      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    }
  } satisfies Storage;

  return {
    storage,
    items: map,
    refuseWrites: message => {
      refusal.message = message;
    }
  };
}

/** A `matchMedia` list for one query, and how a test changes it. */
export type FakeMedia = {
  /** The queries the page asked for, in order. */
  queries: string[];
  /** Sets `matches` and fires `change` at every listener. */
  change(matches: boolean): void;
};

/**
 * Stubs `matchMedia` with one list that every query gets.
 *
 * @param matches - What the list answers at first.
 * @returns The asked queries and the change trigger.
 */
export function stubMedia(matches: boolean): FakeMedia {
  const queries: string[] = [];
  const listeners: ((event: { matches: boolean }) => void)[] = [];
  const list = {
    matches,
    addEventListener: (_name: string, listener: (event: { matches: boolean }) => void) => {
      listeners.push(listener);
    }
  };

  vi.stubGlobal("matchMedia", (query: string) => {
    queries.push(query);

    return list;
  });

  return {
    queries,
    change: next => {
      list.matches = next;

      for (const listener of listeners) listener({ matches: next });
    }
  };
}

/**
 * Stubs `location` with the parts of a URL the page reads.
 *
 * @param href - The address of the page.
 */
export function stubLocation(href: string): void {
  const url = new URL(href);

  vi.stubGlobal("location", { href: url.href, search: url.search });
}
