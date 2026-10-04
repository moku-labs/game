/**
 * @file ui/layout — `Box` plus the transform styles as the rest pose. Before every hook the rest
 * is written through `world.projection.setRest`, and the hook plays on the `ViewHandle` the
 * projection hands out for a ui-owned entity. Nothing but a track writes the pose between hooks.
 */
import type { Hint } from "../../flow/types";
import { Transform, type TransformValue } from "../../renderer/components";
import type { Point } from "../../renderer/types";
import type { Motion, MotionHandle, ViewHandle } from "../../world/projection/types";
import type { ComponentType } from "../../world/types";
import { UI_OWNER } from "../components";
import { asError } from "../errors";
import type { Element } from "../jsx/types";
import type { Origin, ResolvedStyle } from "../styles/types";
import type { UiCtx } from "../types";
import { CONTENT, samePose, visualOf } from "../visual";
import type { Rect } from "./types";

/**
 * The local point an element turns and scales around, from the `origin` of its style.
 *
 * @param origin - What the style wrote; the centre when it wrote nothing.
 * @param width - The width of the box.
 * @param height - The height of the box.
 * @returns The pivot in the element's own units.
 * @example
 * ```ts
 * pivotOf("top", 200, 80); // { x: 100, y: 0 }
 * ```
 */
function pivotOf(origin: Origin | undefined, width: number, height: number): Point {
  if (origin === undefined || origin === "center") return { x: width / 2, y: height / 2 };
  if (origin === "top") return { x: width / 2, y: 0 };
  if (origin === "topLeft") return { x: 0, y: 0 };

  return { x: origin.x * width, y: origin.y * height };
}

/**
 * The rest pose of the `Transform` of an element. The pivot is the origin of the style on the
 * box; the position is where the pivot lands, chosen so the unscaled element sits on its rect,
 * relative to its parent. The offsets, the scale and the rotation of the style come on top: the
 * element turns around its pivot. A fitted element is scaled by its fit about the centre of its
 * box, so its centre stays where the solve put it.
 *
 * @param rect - The rect of the element in root coordinates.
 * @param parent - The rect of its parent, or nothing for a root element.
 * @param style - The resolved style, for `origin`, `offsetX`, `offsetY`, `scale` and `rotation`.
 * @param fit - The element's own fit scale, 1 without `fit: "contain"`.
 * @returns The rest transform.
 * @example
 * ```ts
 * restTransform({ x: 40, y: 80, w: 10, h: 10 }, undefined);
 * // { x: 45, y: 85, rotation: 0, scale: 1, pivot: { x: 5, y: 5 } }
 * restTransform({ x: 0, y: 0, w: 200, h: 80 }, undefined, { rotation: -0.026, origin: "top" });
 * // { x: 100, y: 0, rotation: -0.026, scale: 1, pivot: { x: 100, y: 0 } }
 * ```
 */
export function restTransform(
  rect: Rect,
  parent: Rect | undefined,
  style: ResolvedStyle = {},
  fit = 1
): TransformValue {
  const pivot = pivotOf(style.origin, rect.w, rect.h);
  const centre = { x: rect.w / 2, y: rect.h / 2 };
  const local = { x: rect.x - (parent?.x ?? 0), y: rect.y - (parent?.y ?? 0) };

  return {
    x: local.x + centre.x + fit * (pivot.x + (style.offsetX ?? 0) - centre.x),
    y: local.y + centre.y + fit * (pivot.y + (style.offsetY ?? 0) - centre.y),
    rotation: style.rotation ?? 0,
    scale: fit * (style.scale ?? 1),
    pivot
  };
}

/**
 * The rest value of the visual that is actually on the element: the same value the entity is
 * drawn with, so a motion returns to exactly that.
 *
 * @param element - The element whose rect is known.
 * @returns The component and the value to record, or `undefined` for an element with no visual.
 */
function restVisual(
  element: Element
): { component: ComponentType<object>; value: object } | undefined {
  const [visual] = visualOf(element);

  if (visual === undefined || visual.value === true) return undefined;

  return { component: visual.type as ComponentType<object>, value: visual.value };
}

/**
 * Records the rest pose of one element before a hook runs: the transform from `Box` and the
 * style, and the visual the element is actually drawn with.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element that entered or moved.
 * @param parent - The rect of its parent, or nothing.
 */
export function writeRest(ctx: UiCtx, element: Element, parent: Rect | undefined): void {
  const projection = ctx.deps.world.projection;

  projection.setRest(
    element.entity,
    Transform,
    restTransform(element.rect, parent, element.style, element.fit)
  );

  const visual = restVisual(element);

  if (visual !== undefined) projection.setRest(element.entity, visual.component, visual.value);
}

/**
 * Asks the projection for the handle of a ui-owned entity. A foreign owner is an error in the
 * log and the caller writes the value directly.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element the hook runs on.
 * @returns The handle, or `undefined`.
 */
export function handleOf(ctx: UiCtx, element: Element): ViewHandle<unknown> | undefined {
  const handle = ctx.deps.world.projection.viewOf(element.entity, UI_OWNER);

  if (handle === undefined) {
    ctx.log.error("ui:no-view-handle", { entity: element.entity, key: element.key });
  }

  return handle;
}

/**
 * Runs one motion hook and keeps the handle it returned, so the exit sweep knows when the
 * element is still playing. Without a hook the value the solve wrote stands; a throwing hook is
 * logged and the same happens.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element the hook belongs to.
 * @param hook - What to run with the handle.
 * @returns The motion the hook returned; `undefined` without a hook, a handle, or a motion.
 */
export function play(
  ctx: UiCtx,
  element: Element,
  hook: ((view: ViewHandle<unknown>) => Motion) | undefined
): MotionHandle | undefined {
  if (hook === undefined) return undefined;

  const handle = handleOf(ctx, element);

  if (handle === undefined) return undefined;

  try {
    const motion = hook(handle);

    if (motion === undefined) return undefined;

    element.handles.push(motion);

    return motion;
  } catch (error) {
    ctx.log.error("ui:motion-failed", { key: element.key, type: element.type }, asError(error));

    return undefined;
  }
}

/** A `change` hook of an extra component, as `ui` calls it: the values before and after. */
type ExtraChange = (
  view: ViewHandle<unknown>,
  previous: object,
  next: object,
  hint?: Hint
) => Motion;

/**
 * Plays the `change` hook of one extra component whose fields changed. The motion the last change
 * of that name started is cancelled first, so its value stays where it is and the new motion
 * starts from there; the new motion is kept with the element's handles, so an exit waits for it.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element that carries the extra.
 * @param name - The component name of the extra.
 * @param values - The value of the last render and of this one.
 * @param values.previous - The value of the last render.
 * @param values.next - The value of this render.
 * @param hint - The hint routed to the element in this frame step.
 * @returns True when the hook returned a motion: the caller writes nothing directly.
 */
export function playExtraChange(
  ctx: UiCtx,
  element: Element,
  name: string,
  values: { previous: object; next: object },
  hint: Hint | undefined
): boolean {
  element.extraHandles.get(name)?.cancel();
  element.extraHandles.delete(name);

  const hook = element.motion?.change?.[name] as ExtraChange | undefined;

  if (hook === undefined) return false;

  const motion = play(ctx, element, view => hook(view, values.previous, values.next, hint));

  if (motion === undefined) return false;

  element.extraHandles.set(name, motion);

  return true;
}

/**
 * Starts the loop of an element's motion, and cancels the one it ran before: at enter, and again
 * whenever the `loop` hook of its motion prop changed. A motion without a loop only stops the old
 * one. The loop's motion is kept apart from the element's handles, so the exit sweep never waits
 * for it; a throwing hook is logged.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element that entered, or whose motion changed.
 */
export function startLoop(ctx: UiCtx, element: Element): void {
  element.loop?.cancel();
  element.loop = undefined;

  const hook = element.motion?.loop;

  if (hook === undefined) return;

  const handle = handleOf(ctx, element);

  if (handle === undefined) return;

  try {
    const motion = hook(handle);

    if (motion !== undefined) element.loop = motion;
  } catch (error) {
    ctx.log.error("ui:motion-failed", { key: element.key, type: element.type }, asError(error));
  }
}

/**
 * Tells whether every motion of an element has finished, which is when an exiting element may
 * be despawned.
 *
 * @param element - The element to ask about.
 * @returns True when nothing is still playing.
 */
export function still(element: Element): boolean {
  return element.handles.every(handle => !handle.active());
}

/**
 * Moves the rest `Transform` of an element to where its rect, style and fit put it now. A live
 * element plays its `change.Transform` motion when it has one, else takes the pose through a
 * 0 ms rest track, which lands on the next frame step and lets an additive loop re-base on the
 * new rest; an element that has not spawned yet only records it, and so does one whose
 * `change.Box` motion already played. The content of a scroll keeps its `Transform`: the scroll
 * step owns it.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element whose rect, style or fit may have changed.
 * @param parent - The rect of its parent, or nothing.
 * @param hooked - Whether a `change.Box` motion already played for this change.
 * @param hint - The hint routed to the element in this frame step, handed to `change.Transform`.
 */
export function repose(
  ctx: UiCtx,
  element: Element,
  parent: Rect | undefined,
  hooked: boolean,
  hint?: Hint
): void {
  const next = restTransform(element.rect, parent, element.style, element.fit);

  if (samePose(element.rest, next)) return;

  const previous = element.rest;

  element.rest = next;
  ctx.deps.world.projection.setRest(element.entity, Transform, next);

  if (!element.live || hooked) return;

  const hook = element.motion?.change?.Transform;

  if (hook !== undefined) {
    play(ctx, element, view => hook(view, previous, next, hint));

    return;
  }

  if (element.type !== CONTENT) handleOf(ctx, element)?.toRest(Transform, { ms: 0 });
}

/**
 * Moves the rest `Transform` of a root element up by the keyboard lift, or back to its own rest
 * with 0, through a 0 ms rest track: the repose of a new rect, so a loop re-bases on the lifted
 * rest and nothing fights. The element's own rest stays unlifted, so the next repose writes the
 * layout's pose and the lift is written on top of it again.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The root element of the edited field.
 * @param units - How far up, in reference units.
 */
export function liftRest(ctx: UiCtx, element: Element, units: number): void {
  ctx.deps.world.projection.setRest(element.entity, Transform, {
    ...element.rest,
    y: element.rest.y - units
  });

  if (element.live) handleOf(ctx, element)?.toRest(Transform, { ms: 0 });
}
