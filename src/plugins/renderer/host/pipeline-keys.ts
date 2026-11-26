/**
 * @file renderer/host — the small-integer keys of the pipeline lookup in front of Pixi's. Pixi 8.22's `getPipeline`
 * keys its cache with `geometryLayout * 2^45 + shaderKey * 2^29 + overrideId * 2^14 + (state << 8) + (blend << 3) +
 * topology`, a number past V8's small integers, so every draw boxes one (16 B; ~27 MB over the A26 walk of «A Memory
 * Missing», item 6). The front table keys the same fields in three levels of small integers and asks Pixi only on a
 * miss, so Pixi's own cache stays the one that makes and keeps the pipelines.
 *
 * What it copies of Pixi, checked by `pipeline-keys.test.ts`: the fields of the key (`geometry._layoutKey`,
 * `program._layoutKey`, `state.data`, `state._blendModeId`, the topology, `overrides.id`), the topology a draw without
 * one gets (`geometry.topology`), the ids of the five topologies, and that a change of the pass's global state swaps
 * `_pipeCache` for another map.
 */

/** The pipelines of one Pixi pipe cache: program layout key → geometry layout key → the rest of the key. */
export type FrontTable = Map<number, Map<number, Map<number, GPURenderPipeline>>>;

/** Pixi 8.22's `topologyStringToId`. */
const TOPOLOGY_IDS: Readonly<Record<string, number>> = {
  "point-list": 0,
  "line-list": 1,
  "line-strip": 2,
  "triangle-list": 3,
  "triangle-strip": 4
};

/** The slots an overrides id may take and keep the rest key a small integer: `slot * 2^14` under 2^30. */
const OVERRIDE_SLOTS = 65_536;

/** What `restKey` answers for fields that do not fit: the lookup goes to Pixi. */
export const NO_KEY = -1;

/**
 * The rest of a pipeline's key, after the program and the geometry: the overrides, the state, the blend mode and the
 * topology, packed as Pixi packs them, an absent overrides in a slot of its own. A field out of the packing's range
 * answers `NO_KEY`.
 *
 * @param state - `state.data`, 0–63.
 * @param blend - `state._blendModeId`, 0–31.
 * @param topology - The topology the draw asks for, or the geometry's.
 * @param overrides - `overrides.id`, or `undefined` when the draw passes none.
 * @returns A small integer, or `NO_KEY`.
 * @example
 * ```ts
 * restKey(0, 0, "triangle-list", undefined); // 3
 * restKey(0, 1, "triangle-list", 0); // 16395
 * ```
 */
export function restKey(
  state: number,
  blend: number,
  topology: string,
  overrides: number | undefined
): number {
  const id = TOPOLOGY_IDS[topology];
  const slot = overrides === undefined ? 0 : overrides + 1;

  if (id === undefined || state < 0 || state >= 64 || blend < 0 || blend >= 32) return NO_KEY;
  if (!Number.isInteger(slot) || slot < 0 || slot >= OVERRIDE_SLOTS) return NO_KEY;

  return slot * 16_384 + (state << 8) + (blend << 3) + id;
}

/**
 * Creates an empty front table. Its own function, because lint rule L5 refuses a collection built inside an exported
 * declaration.
 *
 * @returns The table.
 */
export function emptyTable(): FrontTable {
  return new Map();
}

/**
 * Reads a pipeline of a front table.
 *
 * @param table - The table.
 * @param program - The program's layout key.
 * @param geometry - The geometry's layout key.
 * @param rest - The rest key.
 * @returns The pipeline, or `undefined` before Pixi was asked for it.
 */
export function readPipeline(
  table: FrontTable,
  program: number,
  geometry: number,
  rest: number
): GPURenderPipeline | undefined {
  return table.get(program)?.get(geometry)?.get(rest);
}

/**
 * Keeps a pipeline Pixi answered in a front table: once per pipeline and pipe cache.
 *
 * @param table - The table.
 * @param program - The program's layout key.
 * @param geometry - The geometry's layout key.
 * @param rest - The rest key.
 * @param pipeline - Pixi's pipeline.
 */
export function keepPipeline(
  table: FrontTable,
  program: number,
  geometry: number,
  rest: number,
  pipeline: GPURenderPipeline
): void {
  let byGeometry = table.get(program);

  if (byGeometry === undefined) {
    byGeometry = new Map();
    table.set(program, byGeometry);
  }

  let byRest = byGeometry.get(geometry);

  if (byRest === undefined) {
    byRest = new Map();
    byGeometry.set(geometry, byRest);
  }

  byRest.set(rest, pipeline);
}
