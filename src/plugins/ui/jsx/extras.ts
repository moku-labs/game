/**
 * @file ui/jsx — the extras of the `components` prop in motion: the rest pose recorded for every extra so its `change` hook can
 * bring it home with `view.toRest`, and the motion of that hook, cancelled when its extra leaves.
 */
import type { AnyComponentValue, ComponentType } from "../../world/types";
import type { UiCtx } from "../types";
import { fieldsLeftAlone, restValueOf } from "../visual";
import type { Element } from "./types";

/**
 * Records the rest pose of one extra component with a value, so a `change` hook can bring it
 * home with `view.toRest`; a tag has no rest. The fields the type gives to a plugin, and the size
 * a game's own system gives a self-sized image (F111), stay as the entity carries them. The
 * visual of a live element is recorded the same way each time its look is written or it moves.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element that carries the component.
 * @param value - The value of this render.
 */
export function recordRest(ctx: UiCtx, element: Element, value: AnyComponentValue): void {
  if (value.value === true) return;

  // A value that is not `true` belongs to a component type, never to a tag.
  const type = value.type as ComponentType<object>;
  const owned = fieldsLeftAlone(element, type, type.owned);
  // The entity is read only when a field stays as it carries it.
  const current = owned.length === 0 ? undefined : ctx.deps.world.ecs.get(element.entity, type);
  const rest = restValueOf(current, value.value, owned);

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
  const last = element.extraHandles.get(name);

  if (last === undefined) return;

  last.cancel();
  element.endless?.delete(last);
  element.extraHandles.delete(name);
}
