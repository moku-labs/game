/**
 * @file ui plugin — the perf fixture of a text whose style names its key in `when` (F182): the
 * remeasure `ui` asks when `text` wrote the `Text` of such a text, before the entity carries a
 * style of its own, so the key is read off the resolved style of the frame. The source answers kept
 * values, so a window holds what `ui` builds to read the key: nothing.
 */
import type { Element } from "../../jsx/types";
import { remeasureShown } from "../../layout/measure";
import { createLayoutState } from "../../layout/state";
import type { TextSource } from "../../layout/types";

/** The entity of the text. */
const TITLE = 9;

/** What every measure answers: one kept size. */
const SIZE = Object.freeze({ width: 120, height: 41 });

/** Calls before the fixture is handed out, so V8 compiled the path. */
const WARM_CALLS = 20_000;

/** Where each call puts its answer and the key it was measured with, so the call is not dropped. */
export const remeasured = { last: false, style: "" };

/**
 * One remeasure of a text whose style names "perf.when.short" in its base and "perf.when.tall" in
 * `when.portrait`, resolved on a portrait frame, whose size stands.
 *
 * @returns One call.
 */
export function textWhenRemeasureCall(): () => void {
  const state = createLayoutState();
  const style = { text: "perf.when.short", when: { portrait: { text: "perf.when.tall" } } };
  const element = {
    entity: TITLE,
    type: "text",
    node: { type: "text", props: { content: "Vitrine", style }, children: [] },
    style: Object.freeze({ text: "perf.when.tall" }),
    measuredSize: { width: 120, height: 41 }
  } as unknown as Element;
  const source: TextSource = {
    measure: (_content, key) => {
      remeasured.style = key;

      return SIZE;
    },
    content: () => "Vitrine",
    resolved: () => undefined,
    style: () => undefined,
    formatted: () => undefined,
    duration: () => ""
  };

  state.byEntity.set(TITLE, {} as NonNullable<ReturnType<typeof state.byEntity.get>>);

  const call = (): void => {
    remeasured.last = remeasureShown(state, element, source);
  };

  for (let index = 0; index < WARM_CALLS; index += 1) call();

  return call;
}
