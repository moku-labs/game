/**
 * @file ui/jsx — `defineComponent`: the one authoring helper of the module. Pure, no ctx: it
 * returns a callable definition the runtime recognises and the reconcile expands.
 */
import type { ComponentDefinition, ComponentSpec, DescriptionNode } from "./types";

/** The local state a component that declares none starts every instance with. */
const noLocal: Record<string, never> = {};

/**
 * Tells a component definition from a plain function component, which JSX calls at build time.
 *
 * @param type - What stood in the tag position.
 * @returns True when `defineComponent` built it.
 * @example
 * ```ts
 * isComponentDefinition(() => ({ type: "row", props: {}, children: [] })); // false
 * ```
 */
export function isComponentDefinition(
  type: unknown
): type is ComponentDefinition<never, never, unknown> {
  return typeof type === "function" && (type as { isUiComponent?: true }).isUiComponent === true;
}

/**
 * Declares a component: a piece of interface with local state, outcomes, or both. The view runs
 * at every reconcile with the instance's own local state, never at build time.
 *
 * @param name - Unique name across every feature of the game.
 * @param spec - The initial local state, the outcomes a popup resolves with, and the view.
 * @returns The component, ready to stand in a tag and in a feature's `ui` key.
 * @example
 * ```ts
 * const Panel = defineComponent("Panel", {
 *   local: { tab: "audio" },
 *   view: (props: { volume: number }, local) => ({ type: "column", props: {}, children: [] })
 * });
 * Panel.name; // "Panel"
 * ```
 */
export function defineComponent<
  Properties extends object,
  Local extends object,
  Outcomes extends Record<string, unknown>
>(
  name: string,
  spec: ComponentSpec<Properties, Local, Outcomes> & { readonly outcomes: Outcomes }
): ComponentDefinition<Properties, Local, Outcomes>;

/**
 * Declares a component without outcomes: it may stand in a tree, never in a `popup`.
 *
 * @param name - Unique name across every feature of the game.
 * @param spec - The initial local state and the view.
 * @returns The component, ready to stand in a tag.
 * @example
 * ```ts
 * const Row = defineComponent("Row", { view: () => ({ type: "row", props: {}, children: [] }) });
 * Row.outcomes; // undefined
 * ```
 */
export function defineComponent<Properties extends object, Local extends object>(
  name: string,
  spec: ComponentSpec<Properties, Local, never>
): ComponentDefinition<Properties, Local, undefined>;

/**
 * The one implementation behind the two overloads.
 *
 * @param name - Component name.
 * @param spec - What the game declared.
 * @returns The callable definition.
 */
export function defineComponent<Properties extends object, Local extends object>(
  name: string,
  spec: ComponentSpec<Properties, Local, Record<string, unknown>>
): ComponentDefinition<Properties, Local, Record<string, unknown> | undefined> {
  const local = (spec.local ?? noLocal) as Local;
  const call = (props: Properties): DescriptionNode => ({
    type: name,
    props: props as Record<string, unknown>,
    children: []
  });
  const definition = Object.assign(call, {
    outcomes: spec.outcomes,
    local,
    view: spec.view,
    isUiComponent: true as const
  });

  Object.defineProperty(definition, "name", { value: name, configurable: true });

  return definition as ComponentDefinition<Properties, Local, Record<string, unknown> | undefined>;
}
