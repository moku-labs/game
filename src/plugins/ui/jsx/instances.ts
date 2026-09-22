/**
 * @file ui/jsx — component instances: the local state that lives by identity across renders,
 * shuffles and tab switches, and the view call that expands a component node.
 */
import { asError } from "../errors";
import type { UiCtx } from "../types";
import type { AnyComponentDefinition, DescriptionNode, Element, Instance, JsxState } from "./types";

/**
 * The instance of one component node, created from a deep clone of the definition's local state
 * the first time that identity is seen.
 *
 * @param state - The jsx state.
 * @param identity - Parent plus key plus type of the component node.
 * @param definition - What `defineComponent` returned.
 * @param props - The props of this render.
 * @returns The instance, with the local state of every earlier render.
 */
export function instanceFor(
  state: JsxState,
  identity: string,
  definition: AnyComponentDefinition,
  props: object
): Instance {
  const existing = state.instances.get(identity);

  if (existing !== undefined) {
    existing.props = props;

    return existing;
  }

  const instance: Instance = {
    identity,
    component: definition.name,
    local: structuredClone(definition.local) as Record<string, unknown>,
    props,
    dirty: false
  };

  state.instances.set(identity, instance);

  return instance;
}

/**
 * Runs the view of a component with its own local state. A throw is logged with the component
 * and the key, and the old subtree stays.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param definition - What `defineComponent` returned.
 * @param instance - The instance whose local state the view reads.
 * @param key - The key the component node carried, for the log.
 * @returns The subtree, or `undefined` when the view threw.
 */
export function runView(
  ctx: UiCtx,
  definition: AnyComponentDefinition,
  instance: Instance,
  key: string | undefined
): DescriptionNode | undefined {
  try {
    const view = definition.view as (props: object, local: object) => DescriptionNode;

    return view(instance.props, instance.local);
  } catch (error) {
    ctx.log.error("ui:view-failed", { component: definition.name, key }, asError(error));

    return undefined;
  }
}

/**
 * The instance a `local` patch is written into: the nearest one up the element chain.
 *
 * @param state - The jsx state.
 * @param element - The button that was tapped.
 * @returns The instance, or `undefined` when the button stands outside every component.
 */
export function nearestInstance(state: JsxState, element: Element): Instance | undefined {
  let current: Element | undefined = element;

  while (current !== undefined) {
    if (current.instance !== undefined) {
      const instance = state.instances.get(current.instance);

      if (instance !== undefined) return instance;
    }

    current = current.parent === undefined ? undefined : state.elements.get(current.parent);
  }

  return undefined;
}

/**
 * Drops the instances of a subtree that left, so a returning key starts fresh.
 *
 * @param state - The jsx state.
 * @param identity - The identity prefix of the subtree.
 */
export function forgetInstances(state: JsxState, identity: string): void {
  for (const key of state.instances.keys()) {
    if (key === identity || key.startsWith(`${identity}|`)) state.instances.delete(key);
  }
}
