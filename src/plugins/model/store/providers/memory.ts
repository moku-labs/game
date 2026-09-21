/**
 * @file model/store — in-memory player state provider. The default seam and the test double.
 */
import type { Json } from "../../types";
import type { PlayerStateProvider, ProviderCall, SaveDoc } from "../types";

/** Seed of a save built by `saveOf` when the caller does not pin one. */
const defaultSeed = 1;

/**
 * Creates an in-memory provider that persists nothing and records every call.
 * It is the default when a game configures no `playerProvider`, and the double every test uses:
 * `provider.calls` is the whole persistence protocol of one run, in order.
 *
 * @param fixture - Save returned by `load()`. Omitted: a new player.
 * @param fixture.state - The saved document.
 * @param fixture.version - Schema version of the saved document.
 * @returns A provider that records its calls.
 * @example
 * ```ts
 * const provider = memory({ state: saveOf({ coins: 5 }, 42), version: 1 });
 * ```
 */
export function memory(fixture?: {
  state: SaveDoc;
  version: number;
}): PlayerStateProvider & { calls: ProviderCall[] } {
  const calls: ProviderCall[] = [];

  return {
    calls,

    /**
     * Reads the save. Without a fixture the player is new.
     *
     * @returns The fixture, or `null` for a new player.
     * @example
     * ```ts
     * const saved = await provider.load();
     * ```
     */
    load: async (): Promise<{ state: Json; version: number } | null> => {
      calls.push({ method: "load" });

      // eslint-disable-next-line unicorn/no-null -- `null` is the provider contract for a new player.
      return fixture ? { state: fixture.state, version: fixture.version } : null;
    },

    /**
     * Records a rest-point commit. Nothing is written anywhere.
     *
     * @param patches - Doc patches since the last commit.
     * @param version - Schema version this build writes.
     * @example
     * ```ts
     * provider.commit(patches, 1);
     * ```
     */
    commit: (patches, version): void => {
      calls.push({ method: "commit", patches, version });
    },

    /**
     * Records a durable commit. It resolves at once: there is no disk behind it.
     *
     * @param patches - Doc patches since the last commit.
     * @param txId - Id of the transaction that left the barrier node.
     * @param version - Schema version this build writes.
     * @returns Resolves immediately.
     * @example
     * ```ts
     * await provider.commitDurable(patches, "tx-1", 1);
     * ```
     */
    commitDurable: async (patches, txId, version): Promise<void> => {
      calls.push({ method: "commitDurable", patches, txId, version });
    },

    /**
     * Records a flush.
     *
     * @returns Resolves immediately.
     * @example
     * ```ts
     * await provider.flush();
     * ```
     */
    flush: async (): Promise<void> => {
      calls.push({ method: "flush" });
    }
  };
}

/**
 * Builds a save document from a player tree, with no rng streams drawn yet.
 * Short fixtures in tests read as `saveOf({ coins: 5 })` instead of spelling out the rng branch.
 *
 * @param player - Player tree of the save.
 * @param seed - Rng seed of the save.
 * @returns The save document.
 * @example
 * ```ts
 * const provider = memory({ state: saveOf({ coins: 5 }, 42), version: 1 });
 * ```
 */
export function saveOf(player: Json, seed: number = defaultSeed): SaveDoc {
  return { player, rng: { seed, streams: {} } };
}
