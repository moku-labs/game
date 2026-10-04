/**
 * @file ui/jsx — the extras of the `components` prop in motion: the patch a live element writes
 * into a component it carries, the rest pose recorded for every extra so its `change` hook can
 * bring it home with `view.toRest`, and the motion of that hook, cancelled when its extra leaves.
 */
import type { AnyComponentValue, ComponentType } from "../../world/types";
import type { UiCtx } from "../types";
import type { Element } from "./types";

/**
 * The patch a live element writes into one of its components: every field but the ones the
 * component type gives to a plugin. That plugin keeps such a field for the life of the entity, so
 * a re-render never puts it back to its default: a label keeps the string `text` resolved for it.
 *
 * @param value - The component value the element carries now.
 * @param owned - The fields the component type gives to a plugin.
 * @returns The fields to write.
 * @example
 * ```ts
 * livePatch({ content: "Play", resolved: "" }, ["resolved"]); // { content: "Play" }
 * ```
 */
export function livePatch(value: object, owned: readonly string[]): object {
  if (owned.length === 0) return value;

  return Object.fromEntries(Object.entries(value).filter(([field]) => !owned.includes(field)));
}

/**
 * The rest pose recorded for an extra component: the value of this render, but the fields the
 * component type gives to a plugin stay as the entity carries them, so a render never resets them.
 *
 * @param current - The value the entity carries now; none before the component is added.
 * @param value - The value of this render.
 * @param owned - The fields the component type gives to a plugin.
 * @returns The rest value.
 * @example
 * ```ts
 * restValueOf({ until: 2000, left: 42 }, { until: 5000, left: 0 }, ["left"]); // { until: 5000, left: 42 }
 * ```
 */
function restValueOf(current: object | undefined, value: object, owned: readonly string[]): object {
  if (current === undefined || owned.length === 0) return value;

  return { ...current, ...livePatch(value, owned) };
}

/**
 * Records the rest pose of one extra component with a value, so a `change` hook can bring it
 * home with `view.toRest`; a tag has no rest. The fields the type gives to a plugin are skipped.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element that carries the extra.
 * @param value - The value of this render.
 */
export function recordRest(ctx: UiCtx, element: Element, value: AnyComponentValue): void {
  if (value.value === true) return;

  // A value that is not `true` belongs to a component type, never to a tag.
  const type = value.type as ComponentType<object>;
  const rest = restValueOf(ctx.deps.world.ecs.get(element.entity, type), value.value, type.owned);

  ctx.deps.world.projection.setRest(element.entity, type, rest);
}

/**
 * Cancels the motion the last `change` hook of an extra returned, for an extra that left the
 * `components` prop.
 *
 * @param element - The element that carried the extra.
 * @param name - The component name of the extra.
 */
export function cancelExtra(element: Element, name: string): void {
  element.extraHandles.get(name)?.cancel();
  element.extraHandles.delete(name);
}
