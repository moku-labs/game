/**
 * @file The styles every screen of the sheets game shares: the full screen, a layer pinned over it, and a plain
 * button. The text style of the counters lives here too.
 */
import { defineStyle, defineTextStyles } from "../../kit";

/** The counters: white digits. */
export const countStyles = defineTextStyles({
  "ui.count": { font: "ui.font-body", size: 56, fill: 0xff_ff_ff, align: "center" }
});

/** A root that fills the screen. */
export const fullScreen = defineStyle({ width: "100%", height: "100%" });

/** A child pinned over the whole screen of its root. */
export const pinned = defineStyle({
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  reason: "a layer of the screen lies over the whole of it"
});

/**
 * A square button at a place of the screen.
 *
 * @param left - Its left edge, reference units.
 * @param top - Its top edge.
 * @param fill - Its colour.
 * @returns The style.
 */
export function buttonAt(left: number, top: number, fill: number) {
  return defineStyle({
    position: "absolute",
    left,
    top,
    width: 160,
    height: 160,
    radius: 24,
    fill,
    reason: "a fixture button at a fixed place, so a test taps it by key"
  });
}
