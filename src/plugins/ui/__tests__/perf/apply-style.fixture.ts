/**
 * @file ui plugin — the perf fixture of the Yoga style write (change 2026-11-24-f230-hot-path, U1): one node made the
 * way `ui` makes the node of an element, written with a resolved style that sets every group, either straight or
 * through a stub that counts the Yoga setters it reaches.
 */
import type { Node as YogaNode } from "yoga-layout/load";
import type { Element } from "../../jsx/types";
import { applyStyleToNode } from "../../layout/apply";
import { createNode } from "../../layout/nodes";
import { createLayoutState } from "../../layout/state";
import { loadYogaModule } from "../../layout/yoga";
import type { ResolvedStyle } from "../../styles/types";

/** A style that writes every group: flow, both edge kinds, a percent and a number extent, a ratio and a position. */
export const FULL_STYLE: ResolvedStyle = Object.freeze({
  direction: "row",
  wrap: true,
  justify: "between",
  align: "center",
  alignSelf: "end",
  gap: 12,
  grow: 1,
  shrink: 1,
  padding: { top: 8, left: 16.5 },
  margin: 4,
  width: "50%",
  height: 120,
  minWidth: 40,
  maxHeight: 600,
  aspect: 1.5,
  overflow: "hidden",
  position: "absolute",
  left: 10.5,
  top: 20
});

/** The same style one unit wider: the one field a second write changes. */
export const WIDER_STYLE: ResolvedStyle = Object.freeze({ ...FULL_STYLE, width: 121 });

/** The same style at a number width: the start of the one-field pair. */
export const NARROW_STYLE: ResolvedStyle = Object.freeze({ ...FULL_STYLE, width: 120 });

/** The Yoga setters a style write can reach. */
const SETTERS = [
  "setFlexDirection",
  "setFlexWrap",
  "setJustifyContent",
  "setAlignItems",
  "setAlignSelf",
  "setGap",
  "setFlexGrow",
  "setFlexShrink",
  "setPadding",
  "setMargin",
  "setWidth",
  "setHeight",
  "setMinWidth",
  "setMinHeight",
  "setMaxWidth",
  "setMaxHeight",
  "setAspectRatio",
  "setOverflow",
  "setPositionType",
  "setPosition"
] as const;

/** One node and the two ways of writing a style onto it. */
export type StyleFixture = {
  /** Writes a style onto the node, as `ui` writes the style of a column inside a stack. */
  write: (style: ResolvedStyle) => void;
  /** The same write through the counting stub: every setter call reaches the same node. */
  writeCounted: (style: ResolvedStyle) => void;
  /** Setter calls the counted writes made so far. */
  setters: () => number;
};

/**
 * A stub over a real node: each setter counts its call and hands it to the node.
 *
 * @param real - The node the calls reach.
 * @param count - The cell the calls are counted in.
 * @returns The stub, typed as a node.
 */
function countingStub(real: YogaNode, count: Float64Array): YogaNode {
  const stub: Record<string, (...args: unknown[]) => unknown> = {};
  const methods = real as unknown as Record<string, (...args: unknown[]) => unknown>;

  for (const name of SETTERS) {
    const setter = methods[name];

    if (setter === undefined) throw new Error(`perf: a Yoga node has no ${name}`);
    stub[name] = (...args: unknown[]): unknown => {
      count[0] = (count[0] ?? 0) + 1;

      return setter.apply(real, args);
    };
  }

  return stub as unknown as YogaNode;
}

/**
 * Loads Yoga and makes one node as `ui` makes the node of an element that entered.
 *
 * @returns The node's writes and the setter count.
 */
export async function startStyleFixture(): Promise<StyleFixture> {
  const state = createLayoutState();
  const yoga = await loadYogaModule();

  state.yoga = yoga;

  const node = createNode(state, { entity: 1 } as Element);

  if (node === undefined) throw new Error("perf: no Yoga node");

  const count = new Float64Array(1);
  const stub = countingStub(node, count);
  const kept = state.kept.get(node);
  const tables = state.tables;

  return {
    write: style => applyStyleToNode(yoga, node, style, "column", "stack", kept, tables),
    writeCounted: style => applyStyleToNode(yoga, stub, style, "column", "stack", kept, tables),
    setters: () => count[0] ?? 0
  };
}
