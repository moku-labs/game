/**
 * @file renderer/kept — the state of the kept-picture cache, and its stop from state alone.
 */
import { BYTES_PER_MB } from "../monitor/units";
import type { Config, PixiContainer, PixiRenderTexture } from "../types";
import type { KeptRecord, KeptState, RangeRecord } from "./types";

/**
 * Creates an empty record list. It lives in its own non-exported function because lint rule L5 refuses a collection
 * built inside an exported declaration.
 *
 * @returns An empty list.
 */
function emptyRecords(): KeptRecord[] {
  return [];
}

/**
 * Creates an empty map. Same reason as `emptyRecords`.
 *
 * @returns An empty map.
 */
function emptyMap<Key, Value>(): Map<Key, Value> {
  return new Map();
}

/**
 * Creates an empty set. Same reason as `emptyRecords`.
 *
 * @returns An empty set.
 */
function emptySet(): Set<string> {
  return new Set();
}

/**
 * Creates an empty weak set. Same reason as `emptyRecords`.
 *
 * @returns An empty weak set.
 */
function emptyWeakSet(): WeakSet<PixiContainer> {
  return new WeakSet();
}

/**
 * Makes the empty state of the kept-picture cache; `on` is `config.keptMb > 0` and the debug switch `kept` not off.
 *
 * @param config - The renderer config, already checked.
 * @returns The kept branch of the plugin state.
 */
export function createKeptState(config: Readonly<Pick<Config, "keptMb" | "debug">>): KeptState {
  const allowed = config.keptMb > 0;

  return {
    records: emptyRecords(),
    byEntity: emptyMap(),
    byTop: emptyMap(),
    ranges: emptyMap(),
    spare: undefined,
    madeGroups: emptyWeakSet(),
    frame: 0,
    unsorted: false,
    bytes: 0,
    budget: config.keptMb * BYTES_PER_MB,
    takesOpen: 0,
    takesWindow: 0,
    refreshesOpen: 0,
    frameTakes: 0,
    drawnPictures: 0,
    on: allowed && config.debug.kept !== false,
    allowed,
    warnedBudget: false,
    warnedBlend: emptySet(),
    verifySkipped: 0,
    bypassed: false,
    flushPasses: 0,
    calm: false
  };
}

/**
 * Destroys the engine objects of one record: the quad leaves the tree, the stand-ins drop the filters first (they
 * belong to `effects`), the keeper and every texture go.
 *
 * @param record - The record.
 * @param drop - Destroys one texture: unregisters it from `host.keep` first while the host lives.
 */
export function destroyRecord(
  record: KeptRecord,
  drop: (texture: PixiRenderTexture) => void
): void {
  if (record.standIn !== undefined) {
    // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears the filters.
    record.standIn.filters = null;
    record.standIn.destroy();
  }

  if (record.keeperStandIn !== undefined) {
    // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears the filters.
    record.keeperStandIn.filters = null;
    record.keeperStandIn.destroy();
  }

  record.keeper?.destroy();
  record.quad?.destroy();
  if (record.s1 !== undefined) drop(record.s1);
  if (record.s3 !== undefined) drop(record.s3);
  for (const texture of record.s2) drop(texture);
  record.standIn = undefined;
  record.keeperStandIn = undefined;
  record.keeper = undefined;
  record.quad = undefined;
  record.s1 = undefined;
  record.s3 = undefined;
  record.s2.length = 0;
}

/**
 * Destroys the engine objects of one range picture: the sprite leaves the tree, the picture goes.
 *
 * @param range - The range record.
 * @param drop - Destroys the picture: unregisters it from `host.keep` first while the host lives.
 */
export function destroyRange(range: RangeRecord, drop: (texture: PixiRenderTexture) => void): void {
  range.sprite?.destroy();
  if (range.picture !== undefined) drop(range.picture);
  range.sprite = undefined;
  range.picture = undefined;
}

/**
 * Destroys a texture and its source. The source falls out of `host.keep` with it: `textureUsage` reads only the
 * sources Pixi still manages.
 *
 * @param texture - The texture.
 */
function destroyTexture(texture: PixiRenderTexture): void {
  texture.destroy(true);
}

/**
 * Destroys every engine object and texture of the cache and empties its collections, while the application still
 * exists (`stopRenderer` runs it before `stopSync` and `stopHost`). A top the cache made a render group stops being
 * one, so a game's own object leaves as it came. The textures fall out of `host.keep` with their sources.
 *
 * @param state - The kept state.
 */
export function stopKept(state: KeptState): void {
  for (const record of state.records) {
    if (state.madeGroups.has(record.top) && !record.top.destroyed) {
      record.top.disableRenderGroup();
      state.madeGroups.delete(record.top);
    }

    destroyRecord(record, destroyTexture);
  }

  for (const range of state.ranges.values()) destroyRange(range, destroyTexture);

  state.spare?.destroy(true);
  state.spare = undefined;
  state.records.length = 0;
  state.byEntity.clear();
  state.byTop.clear();
  state.ranges.clear();
  state.bytes = 0;
  state.frame = 0;
  state.unsorted = false;
  state.takesOpen = 0;
  state.takesWindow = 0;
  state.refreshesOpen = 0;
  state.frameTakes = 0;
  state.flushPasses = 0;
  state.drawnPictures = 0;
  state.warnedBudget = false;
  state.warnedBlend.clear();
  state.verifySkipped = 0;
  state.bypassed = false;
}
