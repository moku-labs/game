/**
 * @file model/store — Immer drafts of one transaction. The only file that imports `immer`.
 */
import type { Patch as ImmerPatch } from "immer";
import { applyPatches, createDraft, enablePatches, finishDraft } from "immer";
import type { Json, Root } from "../types";
import type { CommitResult, DraftPair, JsonDocument, Patch, SaveDoc } from "./types";

/** Root order of a commit result, so two commits never report the same roots in another order. */
const rootOrder: readonly Root[] = Object.freeze(["player", "session", "rng"]);

/**
 * Turns on Immer's patch recording. Idempotent, and called from the state factory rather than at
 * module scope: a module-scope call would run on import, even when no app is created.
 *
 * @example
 * ```ts
 * enableDraftPatches();
 * ```
 */
export function enableDraftPatches(): void {
  enablePatches();
}

/**
 * Freezes a tree and every branch of it. Immer freezes what it produces; this covers the trees
 * that never went through a draft — the initial trees and the ones handed to `restore()`.
 *
 * @param tree - The tree to freeze, in place.
 * @returns The same reference, now frozen.
 * @example
 * ```ts
 * state.store.session = deepFreeze(structuredClone(config.initialSession));
 * ```
 */
export function deepFreeze<Tree>(tree: Tree): Tree {
  if (!tree || typeof tree !== "object") return tree;

  for (const branch of Object.values(tree)) deepFreeze(branch);

  return Object.freeze(tree);
}

/**
 * Maps one Immer patch to our own structural patch, so no Immer type reaches a public type.
 * A removal carries no value, and `exactOptionalPropertyTypes` forbids an explicit `undefined`.
 *
 * @param patch - The Immer patch.
 * @param path - Path of the patch inside its own tree, without the container segment.
 * @returns The structural patch.
 * @example
 * ```ts
 * const own = toPatch({ op: "replace", path: ["doc", "player"], value: 1 }, ["player"]);
 * ```
 */
function toPatch(patch: ImmerPatch, path: (string | number)[]): Patch {
  if (patch.op === "remove") return { op: patch.op, path };

  return { op: patch.op, path, value: patch.value };
}

/**
 * Derives the touched roots from the patches of one commit, in a fixed order.
 *
 * @param docPatches - Patches of the save document.
 * @param sessionPatches - Patches of the session tree.
 * @returns The roots a listener has to reconcile.
 * @example
 * ```ts
 * const roots = rootsOf([{ op: "replace", path: ["player"], value: 1 }], []);
 * ```
 */
function rootsOf(docPatches: readonly Patch[], sessionPatches: readonly Patch[]): Root[] {
  const touched = new Set<Root>();

  for (const patch of docPatches) {
    const [head] = patch.path;
    if (head === "player" || head === "rng") touched.add(head);
  }

  if (sessionPatches.length > 0) touched.add("session");

  return rootOrder.filter(root => touched.has(root));
}

/**
 * Opens mutable drafts of the frozen save document and session tree.
 * Both live in one draft container, so one `finishDraft` closes the transaction and the patches
 * arrive in one list, tagged by their container key.
 *
 * @param doc - Frozen save document.
 * @param session - Frozen session tree.
 * @returns The open drafts of one transaction.
 * @example
 * ```ts
 * const pair = openDrafts(state.store.doc, state.store.session);
 * ```
 */
export function openDrafts(doc: SaveDoc, session: Json): DraftPair {
  const source: { doc: SaveDoc; session: Json } = { doc, session };

  return createDraft(source);
}

/**
 * Finishes the drafts: the new frozen trees, the patches per tree and the touched roots.
 * The drafts are revoked, so a draft that leaked into a view throws on the next touch instead of
 * corrupting the committed tree in silence.
 *
 * @param pair - Open drafts of one transaction.
 * @returns The frozen trees, the patches split by tree, and the touched roots.
 * @example
 * ```ts
 * const { doc, session, patches, roots } = finishDrafts(pair);
 * ```
 */
export function finishDrafts(pair: DraftPair): CommitResult & { doc: SaveDoc; session: Json } {
  const collected: ImmerPatch[] = [];
  const finished: { doc: SaveDoc; session: Json } = finishDraft(pair, patches => {
    collected.push(...patches);
  });

  const docPatches: Patch[] = [];
  const sessionPatches: Patch[] = [];

  // Immer reports paths inside the container: ["doc", …] and ["session", …].
  for (const patch of collected) {
    const [container, ...path] = patch.path;
    const target = container === "doc" ? docPatches : sessionPatches;

    target.push(toPatch(patch, path));
  }

  return {
    doc: finished.doc,
    session: finished.session,
    patches: { doc: docPatches, session: sessionPatches },
    roots: rootsOf(docPatches, sessionPatches)
  };
}

/**
 * Applies the patches of one commit to a document, the way a save seam stores what it was handed.
 * A whole-document patch carries the path `[]` and replaces the document. The input is left as it
 * is: the result is a new frozen document.
 *
 * @param document - The document the patches apply to.
 * @param patches - The patches of one commit, in order.
 * @returns The document after the patches.
 * @throws {Error} When a patch names a path the document does not have.
 * @example
 * ```ts
 * held.document = applyTo(held.document, [{ op: "replace", path: [], value: doc }]);
 * ```
 */
export function applyTo(document: JsonDocument, patches: readonly Patch[]): JsonDocument {
  // The Patches plugin carries `applyPatches` as well, and turning it on twice changes nothing.
  enablePatches();

  return applyPatches(document, patches);
}

/**
 * Drops the drafts without a result: the base trees stay as they are and the drafts are revoked.
 *
 * @param pair - Open drafts of one transaction.
 * @example
 * ```ts
 * dropDrafts(pair);
 * ```
 */
export function dropDrafts(pair: DraftPair): void {
  // Immer has no separate revoke for a manual draft; finishing and dropping the result is it.
  finishDraft(pair);
}
