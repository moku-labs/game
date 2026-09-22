/**
 * @file ui/layout — `Box` as the rest pose. Before every hook the rest is written through
 * `world.projection.setRest`, and the hook plays on the `ViewHandle` the projection hands out
 * for a ui-owned entity. Nothing but a track writes the pose between hooks.
 */
import { NineSlice, Shape, Sprite, Transform } from "../../renderer/components";
import { Text } from "../../text/components";
import type { Motion, ViewHandle } from "../../world/projection/types";
import type { ComponentType } from "../../world/types";
import { UI_OWNER } from "../components";
import { asError } from "../errors";
import type { Element } from "../jsx/types";
import type { UiCtx } from "../types";
import type { Rect } from "./types";

/**
 * The rest pose of the `Transform` of an element: its rect, relative to its parent. A root
 * element has no parent, so its rest is its rect.
 *
 * @param rect - The rect of the element in root coordinates.
 * @param parent - The rect of its parent, or nothing.
 * @returns The rest transform.
 */
export function restTransform(
  rect: Rect,
  parent: Rect | undefined
): { x: number; y: number; rotation: number; scale: number } {
  return {
    x: rect.x - (parent?.x ?? 0),
    y: rect.y - (parent?.y ?? 0),
    rotation: 0,
    scale: 1
  };
}

/**
 * The rest value of the visual that is actually on the element: a sprite for an image or an
 * icon, a nine-slice for a sliced panel, the text for a text, a rounded rectangle otherwise.
 *
 * @param element - The element whose rect is known.
 * @returns The component and the value to record.
 */
function restVisual(element: Element): { component: ComponentType<object>; value: object } {
  const { style, rect, type, node } = element;
  const alpha = style.alpha ?? 1;

  if (type === "image" || type === "icon") {
    return {
      component: Sprite as unknown as ComponentType<object>,
      value: { ...Sprite.defaults, texture: textureOf(node.props), alpha, anchor: { x: 0, y: 0 } }
    };
  }

  if (type === "text") {
    return {
      component: Text as unknown as ComponentType<object>,
      value: { ...Text.defaults, ...(node.props as object), anchor: { x: 0, y: 0 } }
    };
  }

  if (type === "panel" && typeof node.props.nineSlice === "string") {
    return {
      component: NineSlice as unknown as ComponentType<object>,
      value: { texture: node.props.nineSlice, width: rect.w, height: rect.h }
    };
  }

  return {
    component: Shape as unknown as ComponentType<object>,
    value: {
      ...Shape.defaults,
      w: rect.w,
      h: rect.h,
      alpha: showsShape(element) ? alpha : 0,
      fill: style.fill ?? Shape.defaults.fill,
      radius: style.radius ?? 0,
      stroke: style.stroke ?? Shape.defaults.stroke,
      strokeWidth: style.strokeWidth ?? 0,
      clip: type === "scroll"
    }
  };
}

/**
 * Reads the asset key of an image or an icon out of its props.
 *
 * @param props - The props of the element.
 * @returns The texture key, empty when the markup named none.
 */
function textureOf(props: Record<string, unknown>): string {
  const key = props.texture ?? props.name;

  return typeof key === "string" ? key : "";
}

/**
 * Tells whether the rounded rectangle of an element is visible. A container with no fill and no
 * stroke still carries one, invisible, so its children have a display object to hang under.
 *
 * @param element - The element to ask about.
 * @returns True for a button, a plain panel, a scroll container and a filled container.
 */
function showsShape(element: Element): boolean {
  if (element.type === "button" || element.type === "panel" || element.type === "scroll") {
    return true;
  }

  return element.style.fill !== undefined || element.style.stroke !== undefined;
}

/**
 * Records the rest pose of one element before a hook runs: the transform from `Box`, and the
 * visual the element is actually drawn with.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element that entered or moved.
 * @param parent - The rect of its parent, or nothing.
 */
export function writeRest(ctx: UiCtx, element: Element, parent: Rect | undefined): void {
  const projection = ctx.deps.world.projection;

  projection.setRest(element.entity, Transform, restTransform(element.rect, parent));

  const visual = restVisual(element);

  projection.setRest(element.entity, visual.component, visual.value);
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
 */
export function play(
  ctx: UiCtx,
  element: Element,
  hook: ((view: ViewHandle<unknown>) => Motion) | undefined
): void {
  if (hook === undefined) return;

  const handle = handleOf(ctx, element);

  if (handle === undefined) return;

  try {
    const motion = hook(handle);

    if (motion !== undefined) element.handles.push(motion);
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
