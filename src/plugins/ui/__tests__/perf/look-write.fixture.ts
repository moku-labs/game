/**
 * @file ui plugin — the perf fixture of a look write (F85): ui's part of a render that moves the
 * sweep of the XP arc, whose element has a `change.Shape` hook. The look check, the values handed to
 * the play and the notes of the pass are measured; the hook's own motion is not: the play answers a
 * motion and starts none. The other fields go through `otherFields` as the reconciler writes them,
 * so a write of them on a numbers-only change shows in the window.
 */
import { Shape } from "../../../renderer/components";
import type { AnyComponentValue } from "../../../world/types";
import { type LookWriter, otherFields, writeLook } from "../../jsx/look";
import type { Element } from "../../jsx/types";

/** The owned fields of a `Shape`: none. */
const NO_OWNED: readonly string[] = [];

/** Where the writes put what they built, so nothing is dropped as dead code. */
const sink: { patch: object | undefined; plays: number; wholes: number } = {
  patch: undefined,
  plays: 0,
  wholes: 0
};

/**
 * The XP arc of a level ring at a share, as `visualOf` builds it.
 *
 * @param sweep - The share of the ring.
 * @returns The `Shape` value.
 */
function arcAt(sweep: number): AnyComponentValue {
  return Shape({
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
    sweep,
    cap: "round"
  });
}

/**
 * One look write of the arc from a quarter to a half of the ring, in one write pass.
 *
 * @returns The call.
 */
export function lookWriteCall(): () => void {
  const before = arcAt(0.25).value as object;
  const after = arcAt(0.5);
  const next = after.value as object;
  const element = { lookPass: undefined, lookFrom: undefined } as unknown as Element;
  const writer: LookWriter = {
    pass: 1,
    values: { previous: before, next },
    play: () => {
      sink.plays += 1;

      return true;
    },
    whole: () => {
      sink.wholes += 1;
    },
    others: (_element, _type, fields) => {
      sink.patch = otherFields(fields, NO_OWNED);
    }
  };

  return () => {
    writeLook(writer, element, after, before, next);
  };
}
