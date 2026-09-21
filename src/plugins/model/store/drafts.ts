/**
 * @file model/store — Immer drafts of one transaction, skeleton. The only file that imports `immer`.
 */
import type { Json } from "../types";
import type { CommitResult, DraftPair, SaveDoc } from "./types";

/**
 * Opens mutable drafts of the frozen save document and session tree.
 *
 * @param _doc - Frozen save document.
 * @param _session - Frozen session tree.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const pair = openDrafts(state.doc, state.session);
 * ```
 */
export function openDrafts(_doc: SaveDoc, _session: Json): DraftPair {
  throw new Error("not implemented");
}

/**
 * Finishes the drafts: returns the new frozen trees, the patches and the touched roots.
 * The drafts are revoked.
 *
 * @param _pair - Open drafts of one transaction.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const { doc, session, patches, roots } = finishDrafts(pair);
 * ```
 */
export function finishDrafts(_pair: DraftPair): CommitResult & { doc: SaveDoc; session: Json } {
  throw new Error("not implemented");
}

/**
 * Drops the drafts without a result. The drafts are revoked, nothing changes.
 *
 * @param _pair - Open drafts of one transaction.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * dropDrafts(pair);
 * ```
 */
export function dropDrafts(_pair: DraftPair): void {
  throw new Error("not implemented");
}
