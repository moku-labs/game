/**
 * @file model/store — type definitions.
 */
import type { RngState, RngView } from "../rng/types";
import type { Json, Root } from "../types";

/**
 * JSON patch produced by a commit.
 *
 * @example
 * ```ts
 * const patch: Patch = { op: "replace", path: ["player", "coins"], value: 12 };
 * ```
 */
export type Patch = { op: "add" | "remove" | "replace"; path: (string | number)[]; value?: Json };

/**
 * The persisted document.
 *
 * @example
 * ```ts
 * const doc: SaveDoc = { player: { coins: 0 }, rng: { seed: 42, streams: {} } };
 * ```
 */
export type SaveDoc = { player: Json; rng: RngState };

/**
 * A JSON object: what a save seam holds, and the only shape a patch can be applied to.
 */
export type JsonDocument = { [key: string]: Json };

/**
 * The save seam implemented by the application layer. `state` is the whole SaveDoc.
 *
 * @example
 * ```ts
 * // A server save: the server holds the document and applies the patches it is sent.
 * const serverSave = (url: string): PlayerStateProvider => {
 *   const queue: { patches: Patch[]; version: number }[] = [];
 *
 *   const send = async (batch: typeof queue, txId?: string): Promise<void> => {
 *     if (batch.length === 0) return;
 *     await fetch(url, { method: "POST", body: JSON.stringify({ batch, txId }) });
 *   };
 *
 *   return {
 *     load: async () => {
 *       const response = await fetch(url);
 *       return response.status === 404 ? null : await response.json(); // { state, version }
 *     },
 *     commit: (patches, version) => {
 *       queue.push({ patches, version }); // a rest node: accumulate, write at the next flush
 *     },
 *     commitDurable: async (patches, txId, version) => {
 *       queue.push({ patches, version });
 *       await send(queue.splice(0), txId); // a barrier node: resolve only when it is stored
 *     },
 *     flush: () => send(queue.splice(0))
 *   };
 * };
 *
 * createApp({ pluginConfigs: { model: { playerProvider: serverSave("/api/save") } } });
 * ```
 */
export type PlayerStateProvider = {
  /**
   * Reads the save. Called once, by `store.load()`.
   *
   * @returns The stored document and its schema version. `null` means a new player.
   */
  load(): Promise<{ state: Json; version: number } | null>;

  /**
   * Called at rest nodes. The provider accumulates and debounces writes.
   *
   * @param patches - Doc patches since the last commit.
   * @param version - Schema version this build writes.
   */
  commit(patches: Patch[], version: number): void;

  /**
   * Called after a barrier node. Resolves when the data is durable.
   *
   * @param patches - Doc patches since the last commit.
   * @param txId - Id of the transaction that left the barrier node.
   * @param version - Schema version this build writes.
   * @returns Resolves when the data is durable.
   */
  commitDurable(patches: Patch[], txId: string, version: number): Promise<void>;

  /**
   * Writes what was accumulated. Called on a background pause and on stop.
   *
   * @returns Resolves when the provider has written.
   */
  flush(): Promise<void>;
};

/**
 * One recorded call of the in-memory provider.
 *
 * @example
 * ```ts
 * const call: ProviderCall = {
 *   method: "commit",
 *   patches: [{ op: "replace", path: ["player", "coins"], value: 4 }],
 *   version: 1
 * };
 * ```
 */
export type ProviderCall =
  | { method: "load" }
  | { method: "commit"; patches: Patch[]; version: number }
  | { method: "commitDurable"; patches: Patch[]; txId: string; version: number }
  | { method: "flush" };

/**
 * One step of the save migration chain. `up` of `from: n` gets the whole save document of version
 * `n` and returns the document of version `n + 1`.
 *
 * @example
 * ```ts
 * // Version 1 saved `gold`. Version 2 calls it `coins`.
 * const renameGold: Migration = {
 *   from: 1,
 *   up: state => {
 *     const doc = state as { player: { gold: number }; rng: RngState };
 *
 *     return { player: { coins: doc.player.gold }, rng: doc.rng };
 *   }
 * };
 *
 * createApp({ pluginConfigs: { model: { schemaVersion: 2, migrations: [renameGold] } } });
 * ```
 */
export type Migration = { from: number; up(state: Json): Json };

/**
 * Frozen view of committed state.
 *
 * @example
 * ```ts
 * const snapshot: Snapshot = {
 *   player: { coins: 4 },
 *   session: { rolls: 1 },
 *   rng: { seed: 42, streams: { dice: 1175946015 } }
 * };
 * ```
 */
export type Snapshot = {
  readonly player: Json;
  readonly session: Json;
  readonly rng: Readonly<RngState>;
};

/**
 * Result of a commit: the patches split by tree, and the touched roots in the order `player`,
 * `session`, `rng`.
 *
 * @example
 * ```ts
 * const result: CommitResult = {
 *   patches: { doc: [{ op: "replace", path: ["player", "coins"], value: 4 }], session: [] },
 *   roots: ["player"]
 * };
 * ```
 */
export type CommitResult = { patches: { doc: Patch[]; session: Patch[] }; roots: Root[] };

/**
 * Open Immer drafts of one transaction. Internal to `drafts.ts` and `api.ts`.
 */
export type DraftPair = { doc: SaveDoc; session: Json };

/**
 * Open transaction handed to one node run.
 *
 * @example
 * ```ts
 * // A game never holds a transaction: the node context carries its drafts and its rng view.
 * export const roll = defineNode({
 *   outcomes: { done: type() },
 *   run: ({ player, rng, out }) => {
 *     player.coins += rng.stream("dice").range(1, 6);
 *     return out.done();
 *   }
 * });
 * ```
 */
export type Transaction = {
  /** Mutable draft of the player tree. */
  player: Json;
  /** Mutable draft of the session tree. */
  session: Json;
  /** Rng view bound to the draft `doc.rng`. Draws advance the draft. */
  rng: RngView;

  /**
   * Commits the drafts of this transaction on the edge: finishes the drafts, swaps the frozen
   * trees, appends the doc patches to the pending list and emits `model:committed` with cause
   * `"edge"`.
   *
   * @returns The patches split by tree and the touched roots.
   * @throws {Error} When the transaction was already committed or discarded.
   * @example
   * ```ts
   * // A runner plugin commits on the edge, after the node body returned its outcome.
   * const { store } = ctx.require(modelPlugin);
   * const transaction = store.begin();
   * await runNodeBody(transaction); // the node wrote coins into transaction.player
   * transaction.commit().roots; // ["player"]
   * ```
   */
  commit(): CommitResult;

  /**
   * Drops the drafts of this transaction. Nothing changes and nothing is emitted.
   *
   * @throws {Error} When the transaction was already committed or discarded.
   * @example
   * ```ts
   * // The node threw or was aborted: nothing of its drafts may reach the state.
   * transaction.discard();
   * store.snapshot().player; // as it was before begin()
   * ```
   */
  discard(): void;
};

/**
 * store module state.
 */
export type StoreState = {
  /** Frozen save document. */
  doc: SaveDoc;
  /** Frozen session tree. */
  session: Json;
  /** Frozen trees of the last rest point. */
  restPoint: { doc: SaveDoc; session: Json } | undefined;
  /** Doc patches since the last provider commit. */
  pending: Patch[];
  transaction: Transaction | undefined;
  loaded: boolean;
  provider: PlayerStateProvider;
};

/**
 * store module API, `app.model.store`. Logic changes the trees only inside a transaction, and only
 * a rest point hands patches to the provider, so a kill between two rest nodes loses a whole
 * transition and never half of one.
 *
 * @example
 * ```ts
 * // A game only reads the store. The flow runner loads, opens transactions and marks rest points.
 * const { player, session } = app.model.store.snapshot();
 * ```
 */
export type StoreApi = {
  /**
   * Loads the save. A new player gets the initial player and a seed; a stored save runs through
   * the migration chain. Nothing is written until the document is complete, so a failure leaves
   * the state exactly as it was and the app can show a clear screen. A document the provider has
   * no base for, a new player or a migrated save, is handed over at once: a player who leaves on
   * the first screen is a saved player. Marks the first rest point and emits `model:committed`
   * with cause `"load"`.
   *
   * @returns Resolves when the document is in place.
   * @throws {SaveUnreadableError} When the save cannot be read by this build.
   * @throws {unknown} The error of a provider that fails to load or refuses the first commit.
   * @example
   * ```ts
   * // The flow runner loads the save once, before the first node; a game calls app.flow.run().
   * const { store } = ctx.require(modelPlugin);
   * await store.load(); // model:committed fires with cause "load"
   * store.snapshot().player; // { coins: 0 } for a new player, from config.initialPlayer
   * ```
   */
  load(): Promise<void>;

  /**
   * Hands out the committed trees. Frozen: this is the only thing a view or a projection sees.
   * Before `load()` it shows the initial player, never a half-read save. The same object comes
   * back while nothing was committed, so a watcher compares identities instead of trees.
   *
   * @returns The frozen player, session and rng trees.
   * @example
   * ```ts
   * // A test plays two rolls headless and reads what was committed.
   * await game.walk([{ at: "home", intent: "roll" }, { at: "home", intent: "roll" }]);
   * app.model.store.snapshot().session; // { rolls: 2 }
   *
   * // An editor panel re-reads the model only when a commit replaced the snapshot.
   * app.model.store.snapshot() === app.model.store.snapshot(); // true until the next commit
   * ```
   */
  snapshot(): Snapshot;

  /**
   * Opens the drafts of one node run. One transaction at a time: a second `begin` is a bug in the
   * runner, not a state to recover from.
   *
   * @returns The open transaction.
   * @throws {Error} When a transaction is already open.
   * @example
   * ```ts
   * // The flow runner opens one transaction when it enters a node and keeps it until the edge.
   * const transaction = ctx.require(modelPlugin).store.begin();
   * transaction.player; // a draft: writes stay invisible to snapshot() until commit()
   * ```
   */
  begin(): Transaction;

  /**
   * Marks a rest node: the provider receives everything since the last rest point, and only then
   * does the rest point move. A throwing provider leaves both untouched, so the next attempt
   * still holds the whole transition.
   *
   * @throws {unknown} The error of a failing provider.
   * @example
   * ```ts
   * // The edge led into a node with `rest: true`: the provider gets the whole transition.
   * transaction.commit();
   * store.markRest(); // provider.commit() receives every patch since the last rest point
   * ```
   */
  markRest(): void;

  /**
   * Marks a barrier node: rollback cannot cross it, so the rest point moves first. The pending
   * patches are dropped only once the provider reports the data as durable.
   *
   * @param txId - Id of the transaction that left the barrier node.
   * @returns Resolves when the data is durable.
   * @throws {unknown} The error of a failing provider.
   * @example
   * ```ts
   * // The edge left a node with `barrier: true`, for example a granted purchase: wait for the disk.
   * // The id is path#journalIndex@now, built by the runner.
   * await store.markBarrier("shop/grant#12@1790000000000");
   * ```
   */
  markBarrier(txId: string): Promise<void>;

  /**
   * Returns to the last rest point. It discards an open transaction first. A pointer swap to
   * frozen trees: no inverse patch is replayed. Everything in `pending` belongs to the failed
   * transition, because a rest point empties it. Emits `model:committed` with cause `"rollback"`.
   *
   * @example
   * ```ts
   * // A node failed after it wrote into its drafts: back to the last rest point, then retry.
   * store.rollback(); // model:committed fires with cause "rollback"
   * ```
   */
  rollback(): void;

  /**
   * Replaces the trees: a bookmark, a repro, a dev restore after a reload. What is omitted stays
   * as it is. The restored trees become the new rest point. The provider receives the whole
   * document at the next rest point, never patches on a base it no longer has. Emits
   * `model:committed` with cause `"restore"`.
   *
   * @param input - The trees to put in place.
   * @param input.player - The player tree.
   * @param input.session - The session tree. Omitted: the current one stays.
   * @param input.rng - The rng branch. Omitted: the current one stays.
   * @throws {Error} When a transaction is open.
   * @example
   * ```ts
   * // The flow runner enters a bookmark: the trees first, then the rest point, then the node.
   * // A game calls app.flow.restore(bookmark), which does all three.
   * store.restore({ player: bookmark.player, session: bookmark.session, rng: bookmark.rng });
   * store.markRest();
   * ```
   */
  restore(input: { player: Json; session?: Json; rng?: RngState }): void;

  /**
   * Asks the provider to write what it has accumulated. The pending patches stay: between two
   * rest nodes they are an unfinished transition, and a kill must lose all of it, never half.
   * The engine calls it on a background pause and on stop.
   *
   * @returns Resolves when the provider has written.
   * @throws {unknown} The error of a failing provider.
   * @example
   * ```ts
   * // The game leaves the page for a payment screen: write the save first.
   * await app.model.store.flush();
   * window.location.assign("/checkout");
   * ```
   */
  flush(): Promise<void>;
};

/**
 * Thrown by `load()`, and so by `flow.run()`, when the save cannot be read by this build. The
 * save stays untouched, so the app can show a clear screen instead of overwriting it.
 *
 * @example
 * ```ts
 * // The player opens an old build over a newer save: show "update the game", keep the save.
 * app.flow.run().catch((error: unknown) => {
 *   if (!(error instanceof SaveUnreadableError)) throw error;
 *   showUpdateScreen(error.savedVersion, error.schemaVersion); // 3, 2
 * });
 * ```
 */
export class SaveUnreadableError extends Error {
  /** Version found in the save. */
  readonly savedVersion: number;
  /** Version this build writes. */
  readonly schemaVersion: number;

  /**
   * Creates the error.
   *
   * @param savedVersion - Version found in the save.
   * @param schemaVersion - Version this build writes.
   * @param cause - The underlying failure.
   * @example
   * ```ts
   * const error = new SaveUnreadableError(3, 2, new Error("Written by a newer build."));
   * error.savedVersion; // 3
   * ```
   */
  constructor(savedVersion: number, schemaVersion: number, cause: unknown) {
    super(
      `[game] The save of version ${savedVersion} cannot be read by schema version ${schemaVersion}.\n  Add the missing migration or restore the backup.`,
      { cause }
    );
    this.name = "SaveUnreadableError";
    this.savedVersion = savedVersion;
    this.schemaVersion = schemaVersion;
  }
}
