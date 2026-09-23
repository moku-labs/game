/**
 * @file input plugin — the hover of a mouse or a pen. `PointerOver` sits on the topmost view a
 * press would take, found with the same filter a press uses. At most one view carries it. A touch
 * never hovers: a touch sample, a pointer cancel and the pointer leaving the canvas take it away.
 * The cursor of the canvas follows the hover: it shows a control while `PointerOver` sits on one,
 * counting the control components other plugins registered through `controls.add`.
 */

import type { AnyComponentType, Entity } from "../world/types";
import {
  Draggable,
  PointerOver,
  type PointerValue,
  Pressable,
  Swipeable,
  Tappable
} from "./components";
import { findPressed } from "./hit";
import type { InputCtx, Point, RawSample, State } from "./types";

/** The components of input that make a view a control: a press on it answers something. */
const CONTROLS = [Tappable, Draggable, Pressable, Swipeable] as const;

/**
 * Takes `PointerOver` away from the view that carries it, if any.
 *
 * @param ctx - Domain context of the input plugin.
 */
export function clearPointerOver(ctx: InputCtx): void {
  const { pointerOver } = ctx.state;

  if (pointerOver !== undefined) ctx.deps.world.ecs.untag(pointerOver, PointerOver);
  ctx.state.pointerOver = undefined;
}

/**
 * Moves `PointerOver` to the topmost view a press would take at a point. The view that had it
 * loses it; nothing is written when the pointer is still over the same view.
 *
 * @param ctx - Domain context of the input plugin.
 * @param point - Where the pointer is, in reference units.
 */
export function movePointerOver(ctx: InputCtx, point: Point): void {
  const found = findPressed(ctx, point.x, point.y);

  if (found === ctx.state.pointerOver) return;

  clearPointerOver(ctx);
  ctx.state.pointerOver = found;
  if (found !== undefined) ctx.deps.world.ecs.tag(found, PointerOver);
}

/**
 * Tells whether a sample ends the hover: any touch, a pointer cancel, or the pointer leaving the
 * canvas. A lost capture does not: the browser sends one after every click.
 *
 * @param sample - The raw sample.
 * @returns True when `PointerOver` has to go.
 * @example
 * ```ts
 * endsHover({ kind: "lost", pointerType: "mouse", pointerId: 1, clientX: 0, clientY: 0 }); // false
 * ```
 */
export function endsHover(sample: RawSample): boolean {
  return sample.pointerType === "touch" || sample.kind === "cancel" || sample.kind === "leave";
}

/**
 * Tells whether a move sample is a hover: a mouse or a pen with no gesture running and no button
 * down. Any other move belongs to the gesture machine.
 *
 * @param ctx - Domain context of the input plugin.
 * @param pointer - The `Pointer` resource of this frame.
 * @param sample - The move sample.
 * @returns True when the move only moves `PointerOver`.
 */
export function isHover(ctx: InputCtx, pointer: PointerValue, sample: RawSample): boolean {
  return sample.pointerType !== "touch" && ctx.state.phase === "idle" && !pointer.down;
}

/**
 * Registers a component type of another plugin as a control. Each call adds one entry, so a type
 * registered twice stays until both removers ran; a remover does nothing when it runs again.
 *
 * @param state - The input state.
 * @param component - The component or tag type to count as a control.
 * @returns The remover.
 */
export function addControl(state: State, component: AnyComponentType): () => void {
  state.controls.push(component);

  let removed = false;

  return (): void => {
    if (removed) return;
    removed = true;

    const at = state.controls.indexOf(component);

    if (at !== -1) state.controls.splice(at, 1);
  };
}

/**
 * Tells whether a view is a control: it carries one of input's answering components or a
 * component another plugin registered, such as `ui`'s `LocalWrite`. A disabled or covered button
 * keeps only `Touchable`, so it is not one.
 *
 * @param ctx - Domain context of the input plugin.
 * @param entity - The hovered view.
 * @returns True when the view answers a press.
 */
function isControl(ctx: InputCtx, entity: Entity): boolean {
  const { ecs } = ctx.deps.world;

  for (const type of CONTROLS) if (ecs.has(entity, type)) return true;
  for (const type of ctx.state.controls) if (ecs.has(entity, type)) return true;

  return false;
}

/**
 * Sets the cursor of the canvas after the frame's hover: `config.cursor.control` over a control,
 * `config.cursor.idle` everywhere else, which covers a leave and a touch because both take
 * `PointerOver` away. The style is written only when the cursor changes.
 *
 * @param ctx - Domain context of the input plugin.
 */
export function syncCursor(ctx: InputCtx): void {
  const { canvas, pointerOver } = ctx.state;

  if (canvas === undefined) return;

  const { control, idle } = ctx.config.cursor;
  const wanted = pointerOver !== undefined && isControl(ctx, pointerOver) ? control : idle;

  if (wanted === (ctx.state.cursor ?? idle)) return;

  canvas.style.cursor = wanted;
  ctx.state.cursor = wanted;
}
