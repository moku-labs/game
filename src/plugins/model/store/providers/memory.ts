/**
 * @file model/store — in-memory player state provider. The default seam and the test double.
 */
import type { Json } from "../../types";
import { applyTo } from "../drafts";
import type { JsonDocument, Patch, PlayerStateProvider, ProviderCall, SaveDoc } from "../types";

/** Seed of a save built by `saveOf` when the caller does not pin one. */
const defaultSeed = 1;

/** The document the provider holds, and the schema version it was written with. */
type Held = { document: JsonDocument | undefined; version: number };

/** The base a patch applies to when the provider was never handed a document. */
const noDocument: JsonDocument = {};

/**
 * Creates an in-memory provider that keeps what it was committed and records every call.
 * It is the default when a game configures no `playerProvider`, and the double every test uses:
 * `provider.calls` is the whole persistence protocol of one run, in order. The document lives as
 * long as the provider does, so a second app over the same instance reads what the first one
 * wrote, and nothing survives the process.
 *
 * `load()` reads the fixture, or everything committed since; without either, the player is new.
 * `commitDurable()` resolves at once: there is no disk behind it.
 *
 * @param fixture - The save `load()` starts from. Omitted: a new player.
 * @param fixture.state - The saved document.
 * @param fixture.version - Schema version of the saved document.
 * @returns A provider that keeps its document and records its calls.
 * @example
 * ```ts
 * // A new player is saved at once. One roll reaches the provider at the next rest node.
 * const provider = memory();
 * const game = await createHeadless(createGame(provider));
 *
 * await game.walk([{ at: "home", intent: "roll" }]);
 * provider.calls.map(call => call.method); // ["load", "commit", "commit"]
 * ```
 */
export function memory(fixture?: {
  state: SaveDoc;
  version: number;
}): PlayerStateProvider & { calls: ProviderCall[] } {
  const calls: ProviderCall[] = [];
  const held: Held = { document: fixture?.state, version: fixture?.version ?? 0 };
  /**
   * Applies the patches of one commit to the held document.
   *
   * @param patches - Doc patches since the last commit.
   * @param version - Schema version this build writes.
   * @throws {Error} When a patch names a path the held document does not have.
   */
  const hold = (patches: Patch[], version: number): void => {
    held.document = applyTo(held.document ?? noDocument, patches);
    held.version = version;
  };

  return {
    calls,

    load: async (): Promise<{ state: Json; version: number } | null> => {
      calls.push({ method: "load" });

      const document = held.document;

      // eslint-disable-next-line unicorn/no-null -- `null` is the provider contract for a new player.
      if (document === undefined) return null;

      return { state: document, version: held.version };
    },

    commit: (patches, version): void => {
      calls.push({ method: "commit", patches, version });
      hold(patches, version);
    },

    commitDurable: async (patches, txId, version): Promise<void> => {
      calls.push({ method: "commitDurable", patches, txId, version });
      hold(patches, version);
    },

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
 * // A returning player with 5 coins. The test starts from this save, not from `initialPlayer`.
 * saveOf({ coins: 5 }, 42); // { player: { coins: 5 }, rng: { seed: 42, streams: {} } }
 * const provider = memory({ state: saveOf({ coins: 5 }, 42), version: 1 });
 * ```
 */
export function saveOf(player: Json, seed: number = defaultSeed): SaveDoc {
  return { player, rng: { seed, streams: {} } };
}
