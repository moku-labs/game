/**
 * @file assets packer, build time — which atlas group a texture goes to, or whether it stays
 * loose. Pure over keys and sizes: the packer, its tests and the summary read the same rules.
 */

/**
 * The atlas group of a texture inside its bundle. `fx` holds the particle textures, which one
 * emitter binds as one page; `main` holds every other texture small enough to pack.
 *
 * @example
 * ```ts
 * const group: Group = "fx";
 * ```
 */
export type Group = "fx" | "main";

/** What the group rules read of a texture: its key and its size in pixels. */
export type Sized = { key: string; width: number; height: number };

/** The textures of one bundle, sorted: the atlas groups by name, and what stays loose. */
export type GroupPlan<Texture extends Sized> = {
  /** Group name to its members, sorted by key. A group always has two members or more. */
  groups: ReadonlyMap<Group, readonly Texture[]>;
  /** The textures that are written as files of their own, sorted by key. */
  loose: readonly Texture[];
};

/** A texture with a side above this stays loose: packing it would cost more memory than it saves. */
const LOOSE_SIDE = 512;

/** The last segment of a key that names a particle texture starts with this. */
const FX_PREFIX = "fx-";

/** The groups in the order a bundle packs them. */
const GROUP_ORDER: readonly Group[] = ["fx", "main"];

/**
 * Picks the atlas group of one texture. A key whose last segment starts with `fx-` goes to `fx`
 * whatever its size; any other texture goes to `main` when no side is above 512 px.
 *
 * @param texture - The key and the size of the texture.
 * @returns The group, or `undefined` when the texture stays loose by its size.
 * @example
 * ```ts
 * groupOf({ key: "ui.fx-rays", width: 504, height: 512 }); // "fx"
 * ```
 */
export function groupOf(texture: Sized): Group | undefined {
  const name = texture.key.slice(texture.key.lastIndexOf(".") + 1);

  if (name.startsWith(FX_PREFIX)) return "fx";

  return texture.width <= LOOSE_SIDE && texture.height <= LOOSE_SIDE ? "main" : undefined;
}

/**
 * Compares two textures by key, so every list of the plan has one order.
 *
 * @param left - One texture.
 * @param right - Another texture.
 * @returns The sort order.
 */
function byKey(left: Sized, right: Sized): number {
  return left.key.localeCompare(right.key);
}

/**
 * Collects the atlas groups of sorted textures. A group of one is no group: its texture joins the
 * loose ones.
 *
 * @param sorted - The textures of a bundle, sorted by key.
 * @param loose - Where a texture of a group of one goes.
 * @returns Group name to its members, in the order a bundle packs them.
 */
function collectGroups<Texture extends Sized>(
  sorted: readonly Texture[],
  loose: Texture[]
): Map<Group, readonly Texture[]> {
  const groups = new Map<Group, readonly Texture[]>();

  for (const group of GROUP_ORDER) {
    const members = sorted.filter(texture => groupOf(texture) === group);

    if (members.length > 1) groups.set(group, members);
    else loose.push(...members);
  }

  return groups;
}

/**
 * Splits the textures of one bundle into atlas groups and loose files. A group of one stays
 * loose as well: an atlas of one file is one request either way, and costs its padding.
 *
 * @param textures - The textures of the bundle, in any order.
 * @returns The groups and the loose textures, each sorted by key.
 * @example
 * ```ts
 * planGroups([{ key: "orders.card", width: 218, height: 304 }]);
 * // { groups: Map {}, loose: [{ key: "orders.card", width: 218, height: 304 }] }
 * ```
 */
export function planGroups<Texture extends Sized>(
  textures: readonly Texture[]
): GroupPlan<Texture> {
  const sorted = textures.toSorted(byKey);
  const loose = sorted.filter(texture => groupOf(texture) === undefined);
  const groups = collectGroups(sorted, loose);

  return { groups, loose: loose.toSorted(byKey) };
}
