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
 * The save seam implemented by the application layer. `state` is the whole SaveDoc.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { model: { playerProvider: memory() } } });
 * ```
 */
export type PlayerStateProvider = {
  /** `null` means a new player. */
  load(): Promise<{ state: Json; version: number } | null>;
  /** Called at rest nodes. The provider accumulates and debounces writes. */
  commit(patches: Patch[], version: number): void;
  /** Called after a barrier node. Resolves when the data is durable. */
  commitDurable(patches: Patch[], txId: string, version: number): Promise<void>;
  /** Background, close. */
  flush(): Promise<void>;
};

/**
 * One recorded call of the in-memory provider.
 *
 * @example
 * ```ts
 * expect(provider.calls).toEqual([{ method: "load" }, { method: "flush" }]);
 * ```
 */
export type ProviderCall =
  | { method: "load" }
  | { method: "commit"; patches: Patch[]; version: number }
  | { method: "commitDurable"; patches: Patch[]; txId: string; version: number }
  | { method: "flush" };

/**
 * One step of the save migration chain.
 *
 * @example
 * ```ts
 * const addCoins: Migration = { from: 1, up: state => ({ player: state, coins: 0 }) };
 * ```
 */
export type Migration = { from: number; up(state: Json): Json };

/**
 * Frozen view of committed state.
 *
 * @example
 * ```ts
 * const { player, session }: Snapshot = model.store.snapshot();
 * ```
 */
export type Snapshot = {
  readonly player: Json;
  readonly session: Json;
  readonly rng: Readonly<RngState>;
};

/**
 * Result of a commit.
 *
 * @example
 * ```ts
 * const { patches, roots }: CommitResult = transaction.commit();
 * ```
 */
export type CommitResult = { patches: { doc: Patch[]; session: Patch[] }; roots: Root[] };

/**
 * Open Immer drafts of one transaction. Internal to `drafts.ts` and `api.ts`.
 *
 * @example
 * ```ts
 * const pair: DraftPair = openDrafts(state.doc, state.session);
 * ```
 */
export type DraftPair = { doc: SaveDoc; session: Json };

/**
 * Open transaction handed to one node run.
 *
 * @example
 * ```ts
 * const transaction: Transaction = model.store.begin();
 * transaction.commit();
 * ```
 */
export type Transaction = {
  /** Mutable draft of the player tree. */
  player: Json;
  /** Mutable draft of the session tree. */
  session: Json;
  /** Rng view bound to the draft `doc.rng`. */
  rng: RngView;
  commit(): CommitResult;
  discard(): void;
};

/**
 * store module state.
 *
 * @example
 * ```ts
 * const store: StoreState = createStoreState(config);
 * ```
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
 * store module API.
 *
 * @example
 * ```ts
 * const store: StoreApi = ctx.require(modelPlugin).store;
 * await store.load();
 * ```
 */
export type StoreApi = {
  load(): Promise<void>;
  snapshot(): Snapshot;
  begin(): Transaction;
  markRest(): void;
  markBarrier(txId: string): Promise<void>;
  rollback(): void;
  restore(input: { player: Json; session?: Json; rng?: RngState }): void;
  flush(): Promise<void>;
};

/**
 * Thrown by `load()` when the save cannot be read by this build.
 *
 * @example
 * ```ts
 * if (error instanceof SaveUnreadableError) showSaveScreen(error);
 * ```
 */
export class SaveUnreadableError extends Error {
  readonly savedVersion: number;
  readonly schemaVersion: number;

  /**
   * Creates the error.
   *
   * @param savedVersion - Version found in the save.
   * @param schemaVersion - Version this build writes.
   * @param cause - The underlying failure.
   * @example
   * ```ts
   * throw new SaveUnreadableError(3, 2, undefined);
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
