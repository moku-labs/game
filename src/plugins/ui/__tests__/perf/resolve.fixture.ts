/**
 * @file ui plugin — the perf fixture of `resolve` (change 2026-11-27-hp-2ab-style-layout): the style of a row as a game
 * writes it inline, a new object every render, and the same style defined once, each resolved for a pressed element.
 */
import type { ViewportSize } from "../../../renderer/viewport/types";
import { defineStyle } from "../../styles/define";
import { resolve, type StyleFlags } from "../../styles/resolve";
import type { Style } from "../../styles/types";

/** A pressed element in portrait. */
const FLAGS: StyleFlags = {
  portrait: true,
  landscape: false,
  tall: false,
  wide: false,
  pressed: true,
  hover: false,
  focus: false,
  disabled: false,
  active: false,
  selected: false,
  covered: false
};

/** A phone viewport with a notch. */
const VIEWPORT: ViewportSize = {
  width: 1080,
  height: 2340,
  scale: 1,
  orientation: "portrait",
  safeArea: { top: 44, right: 0, bottom: 34, left: 0 }
};

/** The defined twin of the inline style. */
const DEFINED = defineStyle({
  direction: "row",
  align: "center",
  gap: 12,
  padding: { top: 8, left: 16, right: 16, bottom: 8 },
  width: "100%",
  height: 96,
  when: { tall: { height: 120 } },
  is: { pressed: { gap: 8 } }
});

/**
 * The style of a row as a game writes it inline: a new object, with new edges, every call.
 *
 * @param gap - The gap, so the object is the game's own.
 * @returns The style.
 */
function inline(gap: number): Style {
  return {
    direction: "row",
    align: "center",
    gap,
    padding: { top: 8, left: 16, right: 16, bottom: 8 },
    width: "100%",
    height: 96,
    when: { tall: { height: 120 } },
    is: { pressed: { gap: 8 } }
  };
}

/** Kept so the resolution is not dropped as dead code. */
export const sink: { gap: number | undefined } = { gap: 0 };

/** Resolves the inline style, built for the call as a render builds it. */
export function resolveInline(): void {
  sink.gap = resolve(inline(12), FLAGS, VIEWPORT).gap;
}

/** Resolves the defined style. */
export function resolveDefined(): void {
  sink.gap = resolve(DEFINED, FLAGS, VIEWPORT).gap;
}

/** Builds the inline style only: the part of `resolveInline` that is the game's render, not `resolve`. */
export function buildInline(): void {
  sink.gap = inline(12).gap;
}
