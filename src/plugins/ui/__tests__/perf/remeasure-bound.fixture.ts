/**
 * @file ui plugin — the perf fixture of the remeasure of a bound text (F135): a rolling counter writes
 * `Text` on every change of its shown string, and `ui` asks each time whether it measures otherwise.
 * The source answers kept values, so a window holds what `ui` builds for a built-in bind: nothing.
 */
import { bind } from "../../../text/components";
import { component } from "../../../world/ecs/define";
import type { Element } from "../../jsx/types";
import { remeasureShown } from "../../layout/measure";
import { createLayoutState } from "../../layout/state";
import type { TextSource } from "../../layout/types";

/** The counter the text binds to. */
const Tally = component("Tally", { value: 0 });

/** The entity of the text. */
const LABEL = 7;

/** What every measure answers: one kept size. */
const SIZE = Object.freeze({ width: 40, height: 20 });

/** Calls before the fixture is handed out, so V8 compiled the path. */
const WARM_CALLS = 20_000;

/** Where each call puts its answer, so the call is not dropped as dead code. */
const answers = { last: false };

/**
 * One remeasure of a text bound through a built-in format, whose size stands.
 *
 * @returns One call.
 */
export function remeasureCall(): () => void {
  const state = createLayoutState();
  const element = {
    entity: LABEL,
    type: "text",
    node: { type: "text", props: { bind: bind(Tally, "value"), style: "digits" }, children: [] },
    style: {},
    measuredSize: { width: 40, height: 20 }
  } as unknown as Element;
  const source: TextSource = {
    measure: () => SIZE,
    resolved: () => "1500",
    style: () => "digits",
    formatted: () => undefined,
    duration: () => ""
  };

  state.byEntity.set(LABEL, {} as NonNullable<ReturnType<typeof state.byEntity.get>>);

  const call = (): void => {
    answers.last = remeasureShown(state, element, source);
  };

  for (let index = 0; index < WARM_CALLS; index += 1) call();

  return call;
}
