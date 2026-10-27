/**
 * @file world/projection — the build of the next scene aside (spec 31): the projections only the
 * coming list names are mounted into a table of their own, flagged building, while the current
 * scene stays mounted; the commit moves them in at the swap, the discard drops them on an abort.
 */
import type { Root } from "../../model/types";
import type { Entity, Owner } from "../ecs/types";
import { emptyMounted, orderIn, placeNames, reconcileFresh, sortMount } from "./mount";
import { despawnView } from "./queue";
import { reconcile } from "./reconcile";
import type { Building, Dirty, LayerSpec, ProjectionCtx } from "./types";
import { discardActive } from "./warm";

/**
 * Creates the empty table of a build: nothing mounted aside and nothing spawned yet.
 *
 * @param names - The projection list of the coming scene.
 * @param layers - The layer list of the coming scene.
 * @param owner - Who owns the entities of the projections it mounts.
 * @param budgetMs - Milliseconds per frame the building work may take.
 * @returns The table.
 */
function emptyBuilding(
  names: readonly string[],
  layers: ReadonlyArray<LayerSpec>,
  owner: Owner,
  budgetMs: number
): Building {
  return {
    names: [...names],
    layers,
    owner,
    mounted: new Map(),
    entities: new Set<Entity>(),
    budgetMs
  };
}

/**
 * Creates the empty set of dirty roots. It lives in its own non-exported function because lint
 * rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty set of roots.
 */
function emptyRoots(): Set<Root> {
  return new Set();
}

/**
 * Marks the world dirty at the end of a build that passed mounted projections over (`held`), so the
 * next frame's reconcile reaches the ones still mounted: their last reconcile read an older state,
 * every other projection read this one and is passed over. A build that held a forced reconcile
 * forces the next one too. A build that held nothing marks nothing.
 *
 * @param pctx - Domain context of the projection module.
 * @param building - The build that ends.
 */
function handBack(pctx: ProjectionCtx, building: Building): void {
  const state = pctx.ctx.state.projection;
  const held = building.held;

  if (held === undefined) return;

  const dirty: Dirty = state.dirty ?? { causes: [], roots: emptyRoots(), force: false };

  dirty.causes.push(held === "rerun" ? "rerun" : "edge");
  dirty.roots.add("player");
  dirty.roots.add("session");
  dirty.force ||= held === "rerun";
  state.dirty = dirty;
}

/**
 * Starts the build of a scene's list under its layer list. A projection mounted now under other
 * layer rules makes it answer false before anything is touched. The rest of the list is checked as
 * a mount checks it, against the coming layers; a projection the current scene mounts and the
 * coming one declares alike stays as it is, and every other one is mounted aside, direct. A view
 * that throws leaves nothing behind: what the build spawned is despawned and the throw goes on.
 * The warm window in work is dropped first, or its parts would hold the build's readiness; a ready
 * one stays held, and no warm work runs until the build ends. The frame budget counts from now.
 *
 * @param pctx - Domain context of the projection module.
 * @param names - The projection list of the coming scene.
 * @param owner - Who owns the entities of the projections it mounts.
 * @param layers - The layer list of the coming scene.
 * @param budgetMs - Milliseconds per frame the building work may take.
 * @returns True when the build runs, false on a projection mounted under other layer rules.
 * @throws {Error} When a build already runs, for an unknown name, for a `layer` or `lift` the
 *   coming list does not declare, and whatever a `view` threw.
 */
export function buildNames(
  pctx: ProjectionCtx,
  names: readonly string[],
  owner: Owner,
  layers: ReadonlyArray<LayerSpec>,
  budgetMs: number
): boolean {
  const state = pctx.ctx.state.projection;

  // One build table at a time: a second build would mount over the first one's records.
  if (state.building !== undefined) {
    throw new Error(
      "[game] A scene is already being built.\n" +
        "  Commit or discard the running build before the next one starts."
    );
  }

  const { fresh, again } = sortMount(pctx, names, layers);

  // A projection mounted under other layer rules would need two records under one name: refuse before any write.
  if (again.length > 0) return false;

  discardActive(pctx);
  state.frameStart = pctx.ctx.deps.clock.now();

  const building = emptyBuilding(names, layers, owner, budgetMs);

  // Only the projections the current scene does not mount alike get a record aside; the kept ones stay as they are.
  for (const spec of fresh) {
    building.mounted.set(spec.name, emptyMounted(owner, orderIn(names, spec.name), layers));
  }

  state.building = building;

  // Set before the reconcile, so `isBuilding` answers for the views it spawns. A list of kept projections only has
  // nothing to spawn: the build runs with an empty table and the commit only places the list.
  if (fresh.length === 0) return true;

  // The views are spawned now, direct; a `view` that throws must leave no entity of the build behind, so the table is
  // discarded and the throw goes on to the caller.
  try {
    reconcile(pctx, {
      table: building.mounted,
      direct: true,
      force: true,
      converge: false,
      settle: false,
      strict: true
    });
  } catch (error) {
    discardBuild(pctx);

    throw error;
  }

  return true;
}

/**
 * The swap of the running build. Its projections move into the mounted table, and the list is
 * placed as a mount places it: every moved and kept projection takes the layer list `setLayers`
 * stored just before (`placeMounted`), so the next scene compares it by identity as after a mount;
 * a kept one takes its new place, and one the build kept that left before the commit is mounted
 * now, direct. The views that moved owe their loop, also when nothing left with the commit, and the
 * hosts of `ui` look at the views again.
 *
 * @param pctx - Domain context of the projection module.
 */
export function commitBuild(pctx: ProjectionCtx): void {
  const state = pctx.ctx.state.projection;
  const building = state.building;

  if (building === undefined) return;

  // Dropped first: nothing the commit mounts is building.
  delete state.building;

  // A moved record holds the list the caller handed `build`, never the stored one: `placeNames` stamps it.
  for (const [name, mounted] of building.mounted) state.mounted.set(name, mounted);

  const missing = building.names.filter(name => !state.mounted.has(name));

  placeNames(pctx, building.names, building.owner);
  state.owedLoops += 1;
  state.membershipVersion += 1;
  reconcileFresh(pctx, missing);
  handBack(pctx, building);
}

/**
 * Drops the running build: every view it spawned leaves with the cause `"discard"` and no motion,
 * then every entity `adopt` marked that is still there is despawned too, and the table goes. The
 * removal hooks still see the build while they run.
 *
 * @param pctx - Domain context of the projection module.
 */
export function discardBuild(pctx: ProjectionCtx): void {
  const state = pctx.ctx.state.projection;
  const building = state.building;

  if (building === undefined) return;

  for (const mounted of building.mounted.values()) {
    // A copy: despawning deletes from the very map this loop walks.
    // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
    for (const view of [...mounted.live.values()]) {
      view.cause = "discard";
      despawnView(pctx, mounted, view);
    }
  }

  for (const entity of building.entities) {
    if (pctx.deps.ecs.ownerOf(entity) !== undefined) pctx.deps.ecs.despawn(entity);
  }

  delete state.building;
  handBack(pctx, building);
}
