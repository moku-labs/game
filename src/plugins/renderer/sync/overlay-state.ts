/**
 * @file renderer/sync — what the overlay step lets go of when the tree goes: a rebuild after a device restore keeps
 * the overlays it knows and draws them again, a stop forgets everything. Works on the state alone.
 */
import type { OverlayState, SyncState } from "./types";

/**
 * Destroys the dims and the HUD render layers the records hold, once each, and drops the references; a render layer
 * lets go of what it holds first, so the HUD layer container is left attached to nothing (U5).
 *
 * @param overlay - The overlay state.
 */
function destroyDims(overlay: OverlayState): void {
  for (const record of overlay.records.values()) {
    if (record.dim !== undefined && !record.dim.destroyed) record.dim.destroy();
    record.dim = undefined;
    record.sized = false;

    if (record.under !== undefined) {
      record.under.detachAll();
      if (!record.under.destroyed) record.under.destroy();
    }

    record.under = undefined;
  }

  overlay.held = undefined;
  overlay.heldBy = undefined;
}

/**
 * Forgets what the step applied to a tree that goes (a rebuild, a lost device): the dims, the HUD render layers and
 * the HUD they held, the range and the tap set. The records stay, so the next step finds the overlays again in the new
 * tree and takes their ranges anew; the views and the layers it hid are new, so nothing is cleared on them.
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
  overlay.offList.length = 0;
  overlay.order.length = 0;
}

/**
 * Forgets every overlay at stop: dims and HUD render layers destroyed, records, ranges, taps, events and the watched
 * entities cleared.
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
