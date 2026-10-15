/**
 * @file renderer/kept — the budget of the kept pictures (P6): `renderer.keptMb` MiB, estimated at four bytes a texel.
 * Before a take that would pass it, the pictures not drawn in this frame are evicted, the least recently drawn first
 * (the spare of a released range before them); a range whose sprite is placed and a picture drawn in this frame are
 * never evicted. An eviction draws the view live and destroys its textures; the record keeps its place.
 */
import { BYTES_PER_MB, roundTo } from "../monitor/units";
import { textureBytes } from "./geometry";
import { dropTexture, endLoan } from "./render";
import type { KeptCtx, KeptRecord } from "./types";

/**
 * Tells whether a take that adds bytes fits the budget as it stands.
 *
 * @param kctx - The kept context.
 * @param extra - The bytes the take adds.
 * @returns True when it fits.
 */
function fits(kctx: KeptCtx, extra: number): boolean {
  return kctx.state.bytes + extra <= kctx.state.budget;
}

/**
 * The record evicted next: not the one taking, not drawn in this frame, the least recently drawn, holding textures.
 *
 * @param kctx - The kept context.
 * @param taking - The record the room is made for.
 * @returns The record, or `undefined` when none can go.
 */
function oldest(kctx: KeptCtx, taking: KeptRecord | undefined): KeptRecord | undefined {
  let found: KeptRecord | undefined;

  for (const record of kctx.state.records) {
    if (record === taking || record.bytes === 0 || record.lastDrawn === kctx.state.frame) continue;
    if (found === undefined || record.lastDrawn < found.lastDrawn) found = record;
  }

  return found;
}

/**
 * Makes room for a take: the spare first, then the least recently drawn pictures, until the take fits. An evicted
 * record goes live (`goLive`) and its textures are destroyed.
 *
 * @param kctx - The kept context.
 * @param extra - The bytes the take adds.
 * @param taking - The record the room is made for, `undefined` for a range.
 * @param goLive - Draws an evicted record live.
 * @returns True when the take fits now.
 */
export function makeRoom(
  kctx: KeptCtx,
  extra: number,
  taking: KeptRecord | undefined,
  goLive: (record: KeptRecord) => void
): boolean {
  const { state } = kctx;

  if (fits(kctx, extra)) return true;

  if (state.spare !== undefined) {
    const { source } = state.spare;

    state.bytes -= textureBytes(source.width, source.height, source.resolution);
    dropTexture(kctx, state.spare);
    state.spare = undefined;
  }

  for (let record = oldest(kctx, taking); record !== undefined && !fits(kctx, extra); ) {
    evict(kctx, record, goLive);
    record = oldest(kctx, taking);
  }

  return fits(kctx, extra);
}

/**
 * Evicts one record: live, its textures destroyed, its bytes given back; it keeps its place in the list.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param goLive - Draws it live.
 */
export function evict(
  kctx: KeptCtx,
  record: KeptRecord,
  goLive: (record: KeptRecord) => void
): void {
  if (record.mode === "kept") goLive(record);

  endLoan(record.s2Of);
  if (record.s1 !== undefined) dropTexture(kctx, record.s1);
  if (record.s3 !== undefined) dropTexture(kctx, record.s3);
  for (const target of record.s2.splice(0)) dropTexture(kctx, target);
  record.s1 = undefined;
  record.s3 = undefined;
  kctx.state.bytes -= record.bytes;
  record.bytes = 0;
}

/**
 * Logs a refused take once per run: the budget is full of pictures drawn in this frame.
 *
 * @param kctx - The kept context.
 * @param label - The refused picture.
 */
export function warnRefused(kctx: KeptCtx, label: string): void {
  const { state } = kctx;

  if (state.warnedBudget) return;

  state.warnedBudget = true;
  kctx.ctx.log.warn("renderer:kept-budget", {
    mb: roundTo(state.bytes / BYTES_PER_MB, 2),
    keptMb: kctx.ctx.config.keptMb,
    refused: label
  });
}
