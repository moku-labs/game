/**
 * @file renderer/sync — what the overlay step lets go of when the tree goes: a rebuild after a device restore keeps
 * the overlays it knows and draws them again, a stop forgets everything. Works on the state alone.
 */
import type { OverlayState, SyncState } from "./types";

/**
 * Destroys the dims the records hold, once each, and drops the references.
 *
 * @param overlay - The overlay state.
 */
function destroyDims(overlay: OverlayState): void {
  for (const record of overlay.records.values()) {
    if (record.dim !== undefined && !record.dim.destroyed) record.dim.destroy();
    record.dim = undefined;
    record.sized = false;
  }
}

/**
 * Forgets what the step applied to a tree that goes (a rebuild, a lost device): the dims, the range and the tap set.
 * The records stay, so the next step finds the overlays again in the new tree and takes their ranges anew; the views
 * and the layers it hid are new, so nothing is cleared on them.
 *
 * @param state - The sync state.
 */
export function forgetOverlays(state: SyncState): void {
  const overlay = state.overlay;

  destroyDims(overlay);
  overlay.active = undefined;

  if (overlay.range !== undefined) {
    overlay.range.entries.length = 0;
    overlay.range.others.length = 0;
    overlay.range.set.clear();
    overlay.range.reason = undefined;
    overlay.range.kept = false;
  }

  overlay.offTops.clear();
  overlay.order.length = 0;
}

/**
 * Forgets every overlay at stop: dims destroyed, records, ranges, taps, events and the watched entities cleared.
 *
 * @param state - The sync state.
 */
export function stopOverlays(state: SyncState): void {
  const overlay = state.overlay;

  forgetOverlays(state);
  overlay.records.clear();
  overlay.entities.clear();
  overlay.parts.clear();
  overlay.events.length = 0;
  overlay.warned.clear();
  overlay.range = undefined;
}
