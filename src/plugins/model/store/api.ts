/**
 * @file model/store — API factory: load, snapshot, transactions, rest points, rollback, restore.
 */
import type { CreateRngView, RngState } from "../rng/types";
import type { Json, ModelCtx, Root } from "../types";
import { deepFreeze, dropDrafts, finishDrafts, openDrafts } from "./drafts";
import { migrate, readSaveDoc } from "./migrations";
import type {
  CommitResult,
  DraftPair,
  Patch,
  SaveDoc,
  Snapshot,
  StoreApi,
  Transaction
} from "./types";

/** Reported when a whole document is swapped: load, rollback and restore touch every root. */
// Frozen: the same array is handed to every listener of `model:committed`.
const allRoots: readonly Root[] = Object.freeze(["player", "session", "rng"]);

/**
 * Draws the seed of a brand-new player.
 *
 * This is the one non-deterministic act of the plugin, and it happens exactly once in the life of
 * a save: from then on the seed is part of the save document, so a kill of the app cannot re-roll
 * a chest. It is isolated here so a test can watch that a player with a save never reaches it.
 *
 * @returns A uint32 seed.
 */
function drawSeed(): number {
  const words = globalThis.crypto.getRandomValues(new Uint32Array(1));

  return words[0] ?? 0;
}

/**
 * Creates the store API: load, snapshot, transactions, rest points, rollback, restore and flush.
 *
 * Logic changes the trees only inside a transaction, and only a rest point hands patches to the
 * provider, so a kill between two rest nodes loses a whole transition and never half of one.
 *
 * @param ctx - Domain context of the model plugin.
 * @param deps - Functions injected by the plugin index.
 * @param deps.createRngView - Factory of an rng view over a draft or frozen rng branch.
 * @returns The `store` half of `app.model`.
 */
export function createStoreApi(ctx: ModelCtx, deps: { createRngView: CreateRngView }): StoreApi {
  // The branch object is built once per app by `createModelState` and never replaced.
  const store = ctx.state.store;

  /**
   * Reports a failing provider and rethrows: the runner treats persistence errors as fatal.
   *
   * @param method - Provider method that failed.
   * @param error - The error the provider produced.
   * @throws {unknown} Always, the error of the provider.
   */
  const fail = (method: string, error: unknown): never => {
    ctx.log.error("model:provider-failed", { method, error });

    throw error;
  };

  /**
   * Announces committed state to everything above the model.
   *
   * @param roots - The roots a listener has to reconcile.
   * @param cause - What produced the change.
   */
  const emitCommitted = (
    roots: readonly Root[],
    cause: "edge" | "rollback" | "restore" | "load"
  ): void => {
    ctx.emit("model:committed", { roots, cause });
  };

  /**
   * Builds the pending list that hands the provider the whole current document.
   * Used when there is no base the provider could apply patches to: a new player, a migrated save
   * or a restored bookmark.
   *
   * @returns One whole-document replace patch.
   */
  const wholeDocument = (): Patch[] => [{ op: "replace", path: [], value: store.doc }];

  /**
   * Builds the document of a brand-new player.
   *
   * @returns The document of a player who has never played.
   */
  const newDocument = (): SaveDoc => ({
    player: structuredClone(ctx.config.initialPlayer),
    rng: {
      seed: typeof ctx.config.seed === "number" ? ctx.config.seed : drawSeed(),
      streams: {}
    }
  });

  /**
   * Reads the save through the provider.
   *
   * @returns The stored save, or `undefined` when the player is new.
   * @throws {unknown} The error of a failing provider.
   */
  const readSave = async (): Promise<{ state: Json; version: number } | undefined> => {
    try {
      return (await store.provider.load()) ?? undefined;
    } catch (error) {
      return fail("load", error);
    }
  };

  /**
   * Migrates a save to the schema version of this build and reads it as a document.
   * The state is cloned before it is frozen, so the provider keeps a document it may still mutate.
   *
   * @param saved - The save as the provider stored it.
   * @param saved.state - The stored document, at the saved schema version.
   * @param saved.version - Schema version the save was written with.
   * @returns The document of the save, at the current schema version.
   * @throws {SaveUnreadableError} When a step is missing, a step throws, or the save is newer.
   */
  const documentOfSave = (saved: { state: Json; version: number }): SaveDoc => {
    const migrated = migrate(
      saved.state,
      saved.version,
      ctx.config.schemaVersion,
      ctx.config.migrations,
      (from, to) => {
        ctx.log.info("model:migrated", { from, to });
      }
    );

    return readSaveDoc(structuredClone(migrated), saved.version, ctx.config.schemaVersion);
  };

  /**
   * Hands everything pending to the provider and clears it. A throwing provider keeps the pending
   * patches, so the next attempt still holds the whole transition.
   *
   * @throws {unknown} The error of a failing provider.
   */
  const commitPending = (): void => {
    try {
      store.provider.commit(store.pending, ctx.config.schemaVersion);
    } catch (error) {
      fail("commit", error);
    }

    store.pending = [];
  };

  const load = async (): Promise<void> => {
    const saved = await readSave();
    const doc = saved ? documentOfSave(saved) : newDocument();
    const rewritten = !saved || saved.version !== ctx.config.schemaVersion;

    store.doc = deepFreeze(doc);
    store.restPoint = { doc: store.doc, session: store.session };
    // A new player and a migrated save have no base on the provider's side: send the document.
    store.pending = rewritten ? wholeDocument() : [];

    if (rewritten) commitPending();

    store.loaded = true;

    emitCommitted(allRoots, "load");
  };

  const snapshot = (): Snapshot => ({
    player: store.doc.player,
    session: store.session,
    rng: store.doc.rng
  });

  /**
   * Closes the open transaction, or explains that it is gone.
   *
   * @param transaction - The transaction that wants to close.
   * @throws {Error} When the transaction was already committed or discarded.
   */
  const closeTransaction = (transaction: Transaction): void => {
    if (store.transaction !== transaction) {
      throw new Error(
        "[game] This model transaction is no longer open.\n  Call begin() to open a new transaction."
      );
    }

    store.transaction = undefined;
  };

  /**
   * Finishes the drafts of one transaction and swaps the frozen trees.
   *
   * @param transaction - The transaction that commits.
   * @param pair - Its open drafts.
   * @returns The patches split by tree and the touched roots.
   * @throws {Error} When the transaction was already committed or discarded.
   */
  const commitTransaction = (transaction: Transaction, pair: DraftPair): CommitResult => {
    closeTransaction(transaction);

    const finished = finishDrafts(pair);

    store.doc = finished.doc;
    store.session = finished.session;
    store.pending = [...store.pending, ...finished.patches.doc];

    emitCommitted(finished.roots, "edge");

    return { patches: finished.patches, roots: finished.roots };
  };

  /**
   * Drops the drafts of one transaction. Nothing changes and nothing is emitted.
   *
   * @param transaction - The transaction that gives up.
   * @param pair - Its open drafts.
   * @throws {Error} When the transaction was already committed or discarded.
   */
  const discardTransaction = (transaction: Transaction, pair: DraftPair): void => {
    closeTransaction(transaction);
    dropDrafts(pair);
  };

  const begin = (): Transaction => {
    if (store.transaction) {
      throw new Error(
        "[game] A model transaction is already open.\n  Commit or discard it before calling begin() again."
      );
    }

    const pair = openDrafts(store.doc, store.session);
    const transaction: Transaction = {
      player: pair.doc.player,
      session: pair.session,
      rng: deps.createRngView(pair.doc.rng),
      commit: () => commitTransaction(transaction, pair),
      discard: () => {
        discardTransaction(transaction, pair);
      }
    };

    store.transaction = transaction;

    return transaction;
  };

  const markRest = (): void => {
    commitPending();

    store.restPoint = { doc: store.doc, session: store.session };
  };

  const markBarrier = async (txId: string): Promise<void> => {
    store.restPoint = { doc: store.doc, session: store.session };

    try {
      await store.provider.commitDurable(store.pending, txId, ctx.config.schemaVersion);
    } catch (error) {
      fail("commitDurable", error);
    }

    store.pending = [];
  };

  const rollback = (): void => {
    // A node that threw left its drafts open: close them, or the next `begin()` would refuse.
    if (store.transaction) store.transaction.discard();

    const point = store.restPoint;

    if (point) {
      store.doc = point.doc;
      store.session = point.session;
    }

    store.pending = [];

    emitCommitted(allRoots, "rollback");
  };

  const restore = (input: { player: Json; session?: Json; rng?: RngState }): void => {
    if (store.transaction) {
      throw new Error(
        "[game] restore() was called while a model transaction is open.\n  Commit or discard the transaction first."
      );
    }

    store.doc = deepFreeze({
      player: structuredClone(input.player),
      rng: input.rng ? structuredClone(input.rng) : store.doc.rng
    });

    if (input.session !== undefined) {
      store.session = deepFreeze(structuredClone(input.session));
    }

    // The restored trees are the new rollback target: a failing node must not bring the old save back.
    store.restPoint = { doc: store.doc, session: store.session };
    store.pending = wholeDocument();

    emitCommitted(allRoots, "restore");
  };

  const flush = async (): Promise<void> => {
    try {
      await store.provider.flush();
    } catch (error) {
      fail("flush", error);
    }
  };

  return { load, snapshot, begin, markRest, markBarrier, rollback, restore, flush };
}
