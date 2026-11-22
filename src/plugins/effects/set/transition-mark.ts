/**
 * @file effects/set — the transition mark: which members of the effect set can also draw a scene transition (spec 36),
 * and under what kind. Each of the three members (`RevealLine`, `RevealRound`, `Dissolve`) wraps its own definition in
 * `markTransition` as the initialiser of its export, so the mark ships with the member and only with it: a game that
 * lists none carries neither the member nor its line in this table. No set id is named here or anywhere else in the
 * engine's code outside the member's own module.
 */
import type { TransitionBodyKind } from "../../renderer/types";
import type { FilterDefinition } from "../filters/types";

/** What a marked member is as a transition body: the kind of transition it draws, and its export name for a warning. */
export type TransitionMark = {
  readonly kind: TransitionBodyKind;
  readonly member: string;
};

/**
 * Creates the table of the marks. A function: the module-scope rule sees no collection literal.
 *
 * @returns An empty weak map.
 */
function emptyMarks(): WeakMap<FilterDefinition, TransitionMark> {
  return new WeakMap();
}

/** The mark of each marked definition. Weak: a definition nobody holds takes its mark with it. */
const MARKS = /*#__PURE__*/ emptyMarks();

/**
 * Marks a filter component as the body of a transition kind and gives the component back, unchanged. The mark is kept
 * for the component's definition, in a table the start of `effects` reads for every listed filter.
 *
 * @param component - The component `defineFilter` made.
 * @param kind - The transition kind it draws.
 * @param member - Its export name, for the renderer's warning.
 * @returns The same component.
 */
export function markTransition<Component extends { readonly filter: FilterDefinition }>(
  component: Component,
  kind: TransitionBodyKind,
  member: string
): Component {
  MARKS.set(component.filter, { kind, member });

  return component;
}

/**
 * The mark of a definition, if its member is one of the transition bodies.
 *
 * @param definition - A filter definition.
 * @returns Its kind and member name; `undefined` for any other filter.
 */
export function transitionMarkOf(definition: FilterDefinition): TransitionMark | undefined {
  return MARKS.get(definition);
}
