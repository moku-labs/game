/**
 * @file ui/layout — `Box` plus the transform styles as the rest pose. Before every hook the rest
 * is written through `world.projection.setRest`, and the hook plays on the `ViewHandle` the
 * projection hands out for a ui-owned entity. Nothing but a track writes the pose between hooks.
 */
import type { Hint } from "../../flow/types";
import { Transform, type TransformValue } from "../../renderer/components";
import type { Point } from "../../renderer/types";
import type {
  Motion,
  MotionHandle,
  NumericFields,
  RestOptions,
  TweenOptions,
  ViewHandle
} from "../../world/projection/types";
import type { ComponentType } from "../../world/types";
import { UI_OWNER } from "../components";
import { asError } from "../errors";
import type { Element, PosedEnter } from "../jsx/types";
import type { Origin, ResolvedStyle } from "../styles/types";
import type { UiCtx } from "../types";
import { CONTENT, samePose, visualOf } from "../visual";
import type { MotionSpan, Rect } from "./types";

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
 * style, and the visual the element is actually drawn with. The content of a scroll records no
 * rest `Transform`: the scroll step owns its pose, and the world brings an element back to every
 * rest it holds after a restore.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element that entered or moved.
 * @param parent - The rect of its parent, or nothing.
 */
export function writeRest(ctx: UiCtx, element: Element, parent: Rect | undefined): void {
  const projection = ctx.deps.world.projection;

  if (element.type !== CONTENT) {
    projection.setRest(
      element.entity,
      Transform,
      restTransform(element.rect, parent, element.style, element.fit)
    );
  }

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
 * Notes one track a hook started, when it is finite, timed and ends later than the ones noted before. A track whose
 * length is left to the world's `settleMs` is not noted.
 *
 * @param span - The span being measured.
 * @param options - The options the hook gave the track.
 */
function noteTrack(span: MotionSpan, options: TweenOptions | RestOptions | undefined): void {
  const ms = options?.ms;

  if (options === undefined || ms === undefined || !Number.isFinite(ms) || ms <= 0) return;

  const repeat = "repeat" in options ? options.repeat : undefined;

  if (repeat === "forever") return;

  const length = ms * (1 + (repeat ?? 0));
  const delayMs = options.delayMs ?? 0;

  if (delayMs + length <= span.end) return;

  span.end = delayMs + length;
  span.ms = length;
  span.delayMs = delayMs;
  span.ease = options.ease;
  span.reduced = options.reduced;
}

/** What a watched hook did: whether one of its tracks repeats forever. */
type Watch = { forever: boolean };

/**
 * The view handle of a watched hook: every call goes to the real handle; `tween` notes whether its track repeats
 * forever, and with a span `tween` and `toRest` note their track for the level of an overlay.
 *
 * @param handle - The real handle.
 * @param span - The span being measured, or nothing.
 * @param watch - Where a track that repeats forever is noted.
 * @returns The watching handle.
 */
function watched(
  handle: ViewHandle<unknown>,
  span: MotionSpan | undefined,
  watch: Watch
): ViewHandle<unknown> {
  return {
    entity: handle.entity,
    key: handle.key,
    get: <Value extends object>(component: ComponentType<Value>) => handle.get(component),
    rest: <Value extends object>(component: ComponentType<Value>) => handle.rest(component),
    set: <Value extends object>(component: ComponentType<Value>, patch: Partial<Value>) =>
      handle.set(component, patch),
    tween: <Value extends object>(
      component: ComponentType<Value>,
      to: Partial<NumericFields<Value>>,
      options: TweenOptions
    ) => {
      if (options.repeat === "forever") watch.forever = true;
      if (span !== undefined) noteTrack(span, options);

      return handle.tween(component, to, options);
    },
    toRest: <Value extends object>(component: ComponentType<Value>, options?: RestOptions) => {
      if (span !== undefined) noteTrack(span, options);

      return handle.toRest(component, options);
    },
    all: (handles: readonly Motion[]) => handle.all(handles),
    peer: (key: string) => handle.peer(key)
  };
}

/**
 * A handle that keeps what an enter hook read and wrote: the components it read with `get`, the
 * components it wrote, and every `set` with the values it wrote over. Everything goes on to the
 * real handle.
 *
 * @param handle - The handle the hook plays on.
 * @param posed - Where it is kept.
 * @returns The recording handle.
 */
function recording(handle: ViewHandle<unknown>, posed: PosedEnter): ViewHandle<unknown> {
  const wrote = (component: ComponentType<object>): void => {
    if (!posed.written.includes(component.componentName))
      posed.written.push(component.componentName);
  };

  return {
    entity: handle.entity,
    key: handle.key,
    get: <Value extends object>(component: ComponentType<Value>) => {
      const known = posed.reads.some(read => read.component === (component as unknown));

      if (!known) posed.reads.push({ component: asAnyComponent(component), seen: {} });

      return handle.get(component);
    },
    rest: <Value extends object>(component: ComponentType<Value>) => handle.rest(component),
    set: <Value extends object>(component: ComponentType<Value>, patch: Partial<Value>) => {
      const current = handle.get(component) as Readonly<Record<string, unknown>> | undefined;

      wrote(component);
      // A component the entity does not carry yet has nothing to go back to: a replay writes it again.
      if (current !== undefined) {
        const values: Record<string, unknown> = { ...patch };
        const before: Record<string, unknown> = {};

        for (const field of Object.keys(values)) before[field] = current[field];
        posed.writes.push({ component: asAnyComponent(component), wrote: values, before });
      }

      handle.set(component, patch);
    },
    tween: <Value extends object>(
      component: ComponentType<Value>,
      to: Partial<NumericFields<Value>>,
      options: TweenOptions
    ) => {
      wrote(component);

      return handle.tween(component, to, options);
    },
    toRest: <Value extends object>(component: ComponentType<Value>, options?: RestOptions) => {
      wrote(component);

      return handle.toRest(component, options);
    },
    all: (handles: readonly Motion[]) => handle.all(handles),
    peer: (key: string) => handle.peer(key)
  };
}

/**
 * A component type as the record of an enter play keeps it.
 *
 * @param component - The component type a hook used.
 * @returns The same type, read as a record of fields.
 */
function asAnyComponent<Value extends object>(
  component: ComponentType<Value>
): ComponentType<Record<string, unknown>> {
  return component as unknown as ComponentType<Record<string, unknown>>;
}

/**
 * Plays the enter hook of an element at its `Box`, before the game's systems of phase `sync` see
 * the element, so they see its start pose (F49). What the hook read and wrote is kept on the
 * element: `enterPosed` plays it again in `ui.enter` when a game system changed a component it
 * read (F48), and keeps this play otherwise.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element whose `Box` was just attached.
 * @param span - Notes the longest finite track the hook starts, for the level of an overlay.
 */
export function poseEnter(ctx: UiCtx, element: Element, span?: MotionSpan): void {
  const hook = element.motion?.enter;

  if (hook === undefined) return;

  const posed: PosedEnter = { motion: undefined, reads: [], written: [], writes: [], span };

  posed.motion = play(
    ctx,
    element,
    view => hook(recording(view, posed), element.node, undefined, element.cause),
    span
  );
  element.posed = posed;

  // What a game system may change before `ui.enter`: a component the hook read and did not write itself.
  const ecs = ctx.deps.world.ecs;

  for (const read of posed.reads) {
    if (posed.written.includes(read.component.componentName)) continue;

    read.seen = { ...ecs.get(element.entity, read.component) };
  }
}

/**
 * Tells whether a game system changed a component the enter hook read at the `Box`.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element.
 * @param posed - What the play at the `Box` kept.
 * @returns True when a field the hook could have read is not what it was.
 */
function readChanged(ctx: UiCtx, element: Element, posed: PosedEnter): boolean {
  const ecs = ctx.deps.world.ecs;

  for (const read of posed.reads) {
    if (posed.written.includes(read.component.componentName)) continue;

    const now = ecs.get(element.entity, read.component);

    if (now === undefined) return Object.keys(read.seen).length > 0;

    const fields = new Set([...Object.keys(read.seen), ...Object.keys(now)]);

    for (const field of fields) if (now[field] !== read.seen[field]) return true;
  }

  return false;
}

/**
 * Undoes the play at the `Box` before the hook plays again: its motion is cancelled and forgotten,
 * and a field still holding what a `set` wrote gets its value from before. A field written since
 * keeps the new value. The later writes go back first, so the first one's value is what stays.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element.
 * @param posed - What the play at the `Box` kept.
 */
function undoPosed(ctx: UiCtx, element: Element, posed: PosedEnter): void {
  const motion = posed.motion;

  if (motion !== undefined) {
    motion.cancel();

    const at = element.handles.indexOf(motion);

    if (at !== -1) element.handles.splice(at, 1);
    element.endless?.delete(motion);
  }

  const ecs = ctx.deps.world.ecs;

  for (let index = posed.writes.length - 1; index >= 0; index -= 1) {
    const write = posed.writes[index];
    const current = write === undefined ? undefined : ecs.get(element.entity, write.component);

    if (write === undefined || current === undefined) continue;

    const back: Record<string, unknown> = {};
    let any = false;

    for (const field of Object.keys(write.wrote)) {
      if (current[field] !== write.wrote[field]) continue;

      back[field] = write.before[field];
      any = true;
    }

    if (any) ecs.set(element.entity, write.component, back);
  }
}

/**
 * Settles the enter hook an element played at its `Box`, in `ui.enter`: when a game system of
 * `sync` changed a component the hook read, the play is undone and the hook plays again on what
 * the system wrote (F48); otherwise the play stands, and an overlay's span gets what it noted.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element whose enter plays now.
 * @param span - Where the longest finite track is noted, for the level of an overlay.
 * @returns True when the play at the `Box` stands; false when there was none, or it was undone.
 */
export function enterPosed(ctx: UiCtx, element: Element, span?: MotionSpan): boolean {
  const posed = element.posed;

  if (posed === undefined) return false;

  element.posed = undefined;

  if (readChanged(ctx, element, posed)) {
    undoPosed(ctx, element, posed);

    return false;
  }

  if (span !== undefined && posed.span !== undefined) Object.assign(span, posed.span);

  return true;
}

/**
 * Runs one motion hook and keeps the handle it returned, so the exit sweep knows when the
 * element is still playing. A motion whose hook started a track that repeats forever is also
 * noted as endless: the sweep never waits for it. Without a hook the value the solve wrote stands;
 * a throwing hook is logged and the same happens.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element the hook belongs to.
 * @param hook - What to run with the handle.
 * @param span - Notes the longest finite track the hook starts, for the level of an overlay.
 * @returns The motion the hook returned; `undefined` without a hook, a handle, or a motion.
 */
export function play(
  ctx: UiCtx,
  element: Element,
  hook: ((view: ViewHandle<unknown>) => Motion) | undefined,
  span?: MotionSpan
): MotionHandle | undefined {
  if (hook === undefined) return undefined;

  const handle = handleOf(ctx, element);

  if (handle === undefined) return undefined;

  try {
    const watch: Watch = { forever: false };
    const motion = hook(watched(handle, span, watch));

    if (motion === undefined) return undefined;

    element.handles.push(motion);
    // A motion over a track that repeats forever never ends: no exit waits for it (F42).
    if (watch.forever) noteEndless(element, motion);

    return motion;
  } catch (error) {
    ctx.log.error("ui:motion-failed", { key: element.key, type: element.type }, asError(error));

    return undefined;
  }
}

/**
 * Notes a motion that never ends on its element, the set made with the first one.
 *
 * @param element - The element the motion plays on.
 * @param motion - The endless motion.
 */
function noteEndless(element: Element, motion: MotionHandle): void {
  element.endless ??= new Set();
  element.endless.add(motion);
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
  const last = element.extraHandles.get(name);

  if (last !== undefined) {
    last.cancel();
    element.endless?.delete(last);
    element.extraHandles.delete(name);
  }

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
 * be despawned. A motion over a track that repeats forever never finishes, so it does not count:
 * waiting for it would keep the element for the life of the page (F42).
 *
 * @param element - The element to ask about.
 * @returns True when nothing that can end is still playing.
 */
export function still(element: Element): boolean {
  const { handles, endless } = element;

  // Per exiting element and frame: an array `for…of`, no closure.
  for (const handle of handles) {
    if (handle.active() && endless?.has(handle) !== true) return false;
  }

  return true;
}

/**
 * Moves the rest `Transform` of an element to where its rect, style and fit put it now. A live
 * element plays its `change.Transform` motion when it has one, else takes the pose through a
 * 0 ms rest track. That track writes the pose as it starts, so the pivot and the position land in
 * the same frame, and ends at the next frame step, where an additive loop re-bases on the new
 * rest. An element that has not spawned yet only records it, and so does one whose
 * `change.Box` motion already played. The content of a scroll keeps its `Transform` and records
 * no rest with the world: the scroll step owns it.
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

  if (element.type === CONTENT) return;

  ctx.deps.world.projection.setRest(element.entity, Transform, next);

  if (!element.live || hooked) return;

  const hook = element.motion?.change?.Transform;

  if (hook !== undefined) {
    play(ctx, element, view => hook(view, previous, next, hint));

    return;
  }

  // A 0 ms track writes its target as it starts: the pivot `toRest` writes at once and the position
  // land in the same frame (F47), and the next frame step ends it, so an additive loop re-bases.
  handleOf(ctx, element)?.toRest(Transform, { ms: 0 });
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
