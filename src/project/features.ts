/**
 * @file project — the feature folders of a game, found by folder structure: every folder of `features/`, and inside a
 * feature a folder with a door `index.ts` and resources of its own (`assets/`, `assets.ts` or `strings/`), at any
 * depth. Node and bun only; it imports `node:fs` and `node:path` alone, so `src/lint.ts` loads it unbuilt.
 */

/**
 * One feature folder of a game: a feature owner (a folder of `features/`, or a folder inside an owner with a door
 * `index.ts` and `assets/`, `assets.ts` or `strings/` of its own), or, from `findFeatureUnits` only, a code-only
 * sub-feature its parent's door imports and lists.
 */
export type FeatureOwner = {
  /** The feature name: the folder name. */
  readonly name: string;
  /** The root-relative POSIX folder: `features/episodes/ep01`. */
  readonly dir: string;
  /** The name of the owner the folder sits in; absent for a folder of `features/`. */
  readonly parent?: string;
  /** 0 for a folder of `features/`, the parent's depth + 1 below. */
  readonly depth: number;
  /** What the folder brings of its own: `assets/` or `assets.ts`, and `strings/`. Both false for a code-only sub-feature. */
  readonly resources: { readonly assets: boolean; readonly strings: boolean };
};

/**
 * Finds every feature owner of a game: each folder of the features folder, and inside an owner each folder (not a kind
 * folder such as `flow/` or `assets/`) with a door `index.ts` and resources of its own, at any depth. Depth first, a
 * parent before its children, siblings sorted as the asset scanner sorts features. Reads folders only, never a door.
 *
 * @param _root - The game folder.
 * @param _features - The features folder, relative to the root.
 * @throws {Error} When two folders take the same feature name.
 */
export function findFeatureOwners(_root: string, _features = "features"): readonly FeatureOwner[] {
  throw new Error("not implemented");
}

/**
 * Finds every feature folder lint and the project index treat as a unit: the owners of `findFeatureOwners`, and inside
 * an owner each code-only folder with a door that the owner's door imports from `./<folder>` and lists in
 * `features: [...]`. Reads the owners' doors as text, never with TypeScript. Same order and the same name check.
 *
 * @param _root - The game folder.
 * @param _features - The features folder, relative to the root.
 * @throws {Error} When two folders take the same feature name.
 */
export function findFeatureUnits(_root: string, _features = "features"): readonly FeatureOwner[] {
  throw new Error("not implemented");
}

/**
 * The owner a root-relative path belongs to: the one with the longest `dir` that is the path or a folder above it.
 *
 * @param _owners - Owners or units, any order.
 * @param _file - A root-relative POSIX path.
 */
export function ownerOf<Owner extends { readonly dir: string }>(
  _owners: readonly Owner[],
  _file: string
): Owner | undefined {
  throw new Error("not implemented");
}
