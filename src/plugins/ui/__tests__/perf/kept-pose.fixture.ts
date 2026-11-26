/**
 * @file ui plugin — the perf fixtures of the kept values of an element that stands (change 2026-11-26-f244-peek-pool,
 * slice 1): `visualOf` of a filled row and of a text whose look did not change, and `repose` of an element whose rest
 * pose is the one it has. Each builds its element once, outside any measured window, and hands back one call.
 */
import { Transform } from "../../../renderer/components";
import type { Element } from "../../jsx/types";
import { repose, restTransform } from "../../layout/motion";
import type { Rect } from "../../layout/types";
import type { ResolvedStyle } from "../../styles/types";
import type { UiCtx } from "../../types";
import { visualOf } from "../../visual";

/** Where the calls put what they built, so nothing is dropped as dead code. */
const sink: { value: unknown } = { value: undefined };

/** The rect of the fixture's element: a dot of the album's row of dots. */
const RECT: Rect = { x: 172, y: 780, w: 10, h: 10 };

/**
 * An element of the reconciler, as much of it as `visualOf` and `repose` read.
 *
 * @param type - The intrinsic tag.
 * @param style - The resolved style.
 * @param props - The props of its node.
 * @returns The element.
 */
function elementOf(type: string, style: ResolvedStyle, props: Record<string, unknown>): Element {
  const element = {
    type,
    style,
    node: { type, props, children: [] },
    rect: { ...RECT },
    fit: 1,
    live: true,
    entered: true,
    motion: undefined,
    rest: restTransform(RECT, undefined, style),
    restLent: false,
    restMoves: 0
  };

  // The fields both calls read; the rest of an element is the reconciler's and never reached here.
  return element as unknown as Element;
}

/**
 * One `visualOf` of an element whose look stands: a filled row (`Shape`) or a text (`Text`), its kept value written
 * in place with what it already holds.
 *
 * @param kind - Which visual.
 * @returns One call.
 */
export function standingVisualCall(kind: "shape" | "text"): () => void {
  const element =
    kind === "shape"
      ? elementOf("row", { fill: 0xff_f9_e8, radius: 5, alpha: 0.6 }, {})
      : elementOf("text", {}, { content: "Set 1 of 15" });

  return (): void => {
    sink.value = visualOf(element);
  };
}

/**
 * One `repose` of an element whose rest pose is the one it has: the pose is read into the layout's scratch and
 * compared, and nothing is built, written or played.
 *
 * @returns One call.
 */
export function standingReposeCall(): () => void {
  const element = elementOf("row", {}, {});
  const ctx = {
    state: {
      layout: {
        pose: { x: 0, y: 0, rotation: 0, scale: 1, scaleX: 1, scaleY: 1, pivot: { x: 0, y: 0 } }
      }
    },
    // A repose that moved would reach the world: the fixture's never does, and the throw would say so.
    deps: new Proxy(
      {},
      {
        get: () => {
          throw new Error(`perf: the standing repose reached ${Transform.componentName}`);
        }
      }
    )
  } as unknown as UiCtx;

  return (): void => {
    repose(ctx, element, undefined, false);
  };
}
