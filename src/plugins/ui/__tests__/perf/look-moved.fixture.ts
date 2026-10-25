/**
 * @file ui plugin — the perf fixture of the look check (F85): the question every write of an element
 * with a `change` hook of its visual asks first, whether a render moved its visual. Each of the four
 * visuals written again with the look it has, as `visualOf` builds them: the XP arc of a level ring,
 * a coin image, a framed panel and a label.
 */
import { NineSlice, Shape, Sprite } from "../../../renderer/components";
import { Text } from "../../../text/components";
import type { AnyComponentValue } from "../../../world/types";
import { type LookMove, lookMoved } from "../../jsx/look";

/** Where each call puts its answers, so the call is not dropped as dead code. */
const answers: { last: LookMove } = { last: "none" };

/**
 * The four visuals of a render, each a new value object, as two renders build them.
 *
 * @returns The arc, the image, the panel and the label.
 */
function looks(): AnyComponentValue[] {
  return [
    Shape({
      kind: "arc",
      w: 32,
      h: 32,
      fill: 0xff_ff_ff,
      fillAlpha: 0,
      alpha: 0.97,
      radius: 0,
      stroke: 0xff_f9_e8,
      strokeWidth: 3.6,
      dash: 0,
      clip: false,
      sweep: 0.25,
      cap: "round"
    }),
    Sprite({
      texture: "ui.coin",
      tint: 0xff_ff_ff,
      alpha: 0.85,
      anchor: { x: 0, y: 0 },
      width: 40.5,
      height: 40.5,
      fit: "contain"
    }),
    NineSlice({ texture: "ui.panel", width: 600.5, height: 400.25, alpha: 0.9, tint: 0xff_ff_ff }),
    Text({ content: "coins", style: "body", anchor: { x: 0, y: 0 }, alpha: 0.75, box: 120.5 })
  ];
}

/**
 * One call of `lookMoved` on each of the four visuals and the same look of a new render: every
 * field is read, none moved.
 *
 * @returns The call.
 */
export function lookCall(): () => void {
  const after = looks();
  const pairs = looks().map((look, index) => ({ look, next: after[index] ?? look }));

  return () => {
    for (const { look, next } of pairs) {
      answers.last = lookMoved(look.type, look.value as object, next.value as object);
    }
  };
}
