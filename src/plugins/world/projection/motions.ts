/**
 * @file world/projection — the motion side: the `ViewHandle` a hook is given, the retarget policy
 * of spike P5, the settle of the loose components and the convergence check.
 */
import type { AnyComponentValue, ComponentType, Entity } from "../ecs/types";
import { deepEquals } from "./diff";
import { drivenComponents, inertHandle, loopOffsets, mutedFields, startTrack } from "./driver";
import type {
  AnyProjectionSpec,
  Motion,
  MotionHandle,
  Mounted,
  NumericFields,
  ProjectionCtx,
  RestOptions,
  TweenOptions,
  View,
  ViewHandle
} from "./types";
import { asComponent, asError, storedValue } from "./views";

/** What `view.peer(key)` reads: the new items of the projection, then the old ones. */
export type Peers = { next: ReadonlyMap<string, unknown>; previous: ReadonlyMap<string, unknown> };

/**
 * How far a numeric field may sit from its rest value and still count as at rest, in reference
 * units. A root-space tween that ends through a `localPoseOf` round trip lands about 1e-13 off.
 */
const REST_TOLERANCE = 1e-6;

/**
 * Splits a component value into the numeric fields a tween can drive and the rest.
 *
 * @param value - The stored rest value.
 * @returns The numeric fields and the other fields.
 * @example
 * ```ts
 * splitFields({ x: 10, texture: "a" }); // { numeric: { x: 10 }, other: { texture: "a" } }
 * ```
 */
export function splitFields(value: Readonly<Record<string, unknown>>): {
  numeric: Record<string, number>;
  other: Record<string, unknown>;
} {
  const numeric: Record<string, number> = {};
  const other: Record<string, unknown> = {};

  for (const [field, entry] of Object.entries(value)) {
    if (typeof entry === "number") numeric[field] = entry;
    else other[field] = entry;
  }

  return { numeric, other };
}

/**
 * Writes a patch, leaving out every field another writer owns.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity to write.
 * @param value - The component value that carries the type and the data.
 * @param patch - The fields to write.
 */
function writeUnmuted(
  pctx: ProjectionCtx,
  entity: Entity,
  value: AnyComponentValue,
  patch: Record<string, unknown>
): void {
  const muted = mutedFields(pctx, entity, value.type.componentName);
  const allowed: Record<string, unknown> = {};

  for (const [field, entry] of Object.entries(patch)) {
    if (!muted.has(field)) allowed[field] = entry;
  }

  if (Object.keys(allowed).length === 0) return;
  if (storedValue(pctx, entity, value.type) === undefined) pctx.deps.ecs.add(entity, value);
  else pctx.deps.ecs.set(entity, asComponent(value.type), allowed);
}

/**
 * Builds the handle one motion hook is given. Nothing on it reaches another view: `peer` answers
 * with an item, never with an entity.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view being animated.
 * @param peers - The new and the old items of the projection.
 * @returns The handle.
 */
export function createViewHandle(
  pctx: ProjectionCtx,
  view: View,
  peers: Peers
): ViewHandle<unknown> {
  const handle: ViewHandle<unknown> = {
    entity: view.entity,
    key: view.key,

    get: <Value extends object>(component: ComponentType<Value>) =>
      pctx.deps.ecs.get(view.entity, component),

    rest: <Value extends object>(component: ComponentType<Value>) => {
      const stored = view.rest.get(component.componentName)?.value;

      return stored === undefined || stored === true ? undefined : (stored as Readonly<Value>);
    },

    set: <Value extends object>(component: ComponentType<Value>, patch: Partial<Value>): void => {
      const muted = mutedFields(pctx, view.entity, component.componentName);
      const allowed: Record<string, unknown> = {};

      for (const [field, entry] of Object.entries(patch)) {
        if (!muted.has(field)) allowed[field] = entry;
      }

      if (Object.keys(allowed).length > 0) {
        pctx.deps.ecs.set(view.entity, asComponent(component), allowed);
      }
    },

    tween: <Value extends object>(
      component: ComponentType<Value>,
      to: Partial<NumericFields<Value>>,
      options: TweenOptions
    ): MotionHandle =>
      startTrack(pctx, view.entity, asComponent(component), numbersOf(to), {
        ms: options.ms,
        ease: options.ease ?? "out",
        delayMs: options.delayMs ?? 0,
        additive: options.additive ?? false,
        ...(options.segments === undefined ? {} : { segments: options.segments }),
        ...(options.repeat === undefined ? {} : { repeat: options.repeat })
      }),

    toRest: <Value extends object>(
      component: ComponentType<Value>,
      options?: RestOptions
    ): MotionHandle => {
      const target = view.rest.get(component.componentName);

      if (target === undefined || target.value === true) return inertHandle();

      const { numeric, other } = splitFields(target.value as Record<string, unknown>);

      if (Object.keys(other).length > 0) writeUnmuted(pctx, view.entity, target, other);

      return startTrack(pctx, view.entity, asComponent(component), numeric, {
        ms: options?.ms ?? pctx.ctx.config.settleMs,
        ease: options?.ease ?? "out",
        delayMs: options?.delayMs ?? 0,
        additive: false
      });
    },

    all: (handles: readonly Motion[]): MotionHandle => {
      const real = handles.filter((entry): entry is MotionHandle => entry !== undefined);

      return {
        finish: (): void => {
          for (const entry of real) entry.finish();
        },
        cancel: (): void => {
          for (const entry of real) entry.cancel();
        },
        active: (): boolean => real.some(entry => entry.active())
      };
    },

    peer: (key: string): unknown => peers.next.get(key) ?? peers.previous.get(key)
  };

  return handle;
}

/**
 * Keeps only the numeric fields of a tween target.
 *
 * @param to - The target fields a hook asked for.
 * @returns The numeric ones.
 */
function numbersOf(to: object): Record<string, number> {
  const numeric: Record<string, number> = {};

  for (const [field, entry] of Object.entries(to)) {
    if (typeof entry === "number") numeric[field] = entry;
  }

  return numeric;
}

/**
 * Runs one motion hook. A throwing hook is reported with the projection, the key and the hook
 * name, and the caller writes the diff directly instead.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view being animated.
 * @param hook - Name of the hook, for the log entry.
 * @param run - The hook call.
 * @returns The motion, or `undefined` when the hook threw.
 */
export function runHook(
  pctx: ProjectionCtx,
  view: View,
  hook: string,
  run: () => Motion
): { motion: Motion } | undefined {
  try {
    return { motion: run() };
  } catch (error) {
    pctx.ctx.log.error(
      "world:motion-hook-failed",
      { projection: view.projection, key: view.key, hook },
      asError(error)
    );

    return undefined;
  }
}

/**
 * The peers of a call outside a reconcile, as `settle` and the loop the sweep starts make it:
 * both sides are the items of the last reconcile.
 *
 * @param mounted - The mounted projection.
 * @returns The peers, the same item table as new and as old.
 */
export function restingPeers(mounted: Mounted): Peers {
  return { next: mounted.items, previous: mounted.items };
}

/**
 * Plays the `loop` hook of a view, when its projection has one. The motion is not kept with the
 * view's handles: a change cancels those, and the loop runs until the view dies or a flush ends
 * its tracks.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view that loops.
 * @param spec - The projection spec.
 * @param peers - The new and the old items of the projection.
 */
export function startLoop(
  pctx: ProjectionCtx,
  view: View,
  spec: AnyProjectionSpec,
  peers: Peers
): void {
  const loop = spec.motion?.loop;

  if (loop === undefined) return;

  runHook(pctx, view, "loop", () => loop(createViewHandle(pctx, view, peers)));
}

/**
 * The stored value of one rest component as it stands under the loop of the view: what the
 * additive tracks of the driver add right now is taken off each numeric field. Where the result
 * is at rest within `REST_TOLERANCE`, the exact rest value stands in, so the float noise of the
 * subtraction is no difference. Without a loop on the component, and with a driver that reports
 * no offsets, it is the stored value itself.
 *
 * It is what every comparison with the rest pose reads: the loose components of a settle, the
 * question of a rollback and the convergence check. So a view that only sways or bobs is home,
 * and a view something moved is not, in whatever field.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view to read.
 * @param value - The rest value of the component, which names its type.
 * @returns The value under the loop, or `undefined` for a tag and for a missing component.
 */
export function valueUnderLoop(
  pctx: ProjectionCtx,
  view: View,
  value: AnyComponentValue
): Readonly<Record<string, unknown>> | undefined {
  const stored = storedValue(pctx, view.entity, value.type);

  if (stored === undefined || value.value === true) return stored;

  const rest = value.value as Record<string, unknown>;
  const offsets = loopOffsets(pctx, view.entity, asComponent(value.type));
  let under: Record<string, unknown> | undefined;

  for (const [field, offset] of Object.entries(offsets)) {
    const current = stored[field];

    if (typeof current !== "number") continue;

    const below = current - offset;

    under ??= { ...stored };
    under[field] = atRest(below, rest[field]) ? rest[field] : below;
  }

  return under ?? stored;
}

/**
 * The rest components that are off their rest value and that no running track drives. The loop
 * of a view counts for neither. It drives no component: it adds an offset to the rest pose and
 * owns nothing. And its offset is no distance from the rest pose: the value under the loop is
 * what is compared. So a looping view is loose exactly when a view without a loop would be.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view to check.
 * @returns The names of the loose components.
 */
export function looseComponents(pctx: ProjectionCtx, view: View): string[] {
  const driven = drivenComponents(pctx, view.entity);
  const loose: string[] = [];

  for (const [name, value] of view.rest) {
    if (driven.has(name) || value.value === true) continue;

    const under = valueUnderLoop(pctx, view, value);

    if (under !== undefined && !deepEquals(under, value.value)) loose.push(name);
  }

  return loose;
}

/**
 * Plays the settle of a view: the projection's own hook, or the built-in `toRest` for every loose
 * component over `settleMs`.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view to bring home.
 * @param spec - The projection spec.
 * @param peers - The new and the old items of the projection.
 * @param components - The loose component names.
 */
export function playSettle(
  pctx: ProjectionCtx,
  view: View,
  spec: AnyProjectionSpec,
  peers: Peers,
  components: readonly string[]
): void {
  if (components.length === 0) return;

  const handle = createViewHandle(pctx, view, peers);
  const custom = spec.motion?.settle;

  if (custom === undefined) {
    for (const name of components) {
      const value = view.rest.get(name);

      if (value !== undefined) view.handles.push(handle.toRest(asComponent(value.type)));
    }

    return;
  }

  const played = runHook(pctx, view, "settle", () => custom(handle, components));

  if (played === undefined) {
    writeRestUnderLoops(pctx, view, components);

    return;
  }

  if (played.motion !== undefined) view.handles.push(played.motion);
}

/**
 * Writes fields of one rest component at once while a loop of the view may run. A field a loop
 * adds to is written with the offset on top, so the picture does not lose the offset for a
 * frame. Its new value is first handed to the driver: the driver keeps its own base for such a
 * field and would write the old one back with its next frame. A track of 0 ms to the rest value
 * does that, and it is finished at once. So the base is moved before this call returns, whatever
 * cancels the motions of the view next and also in a world that is not live, and no handle is
 * left with the view. The shown value is written last: a driver that adds no offset on `finish`
 * must not have the last word. A field no loop adds to is written as it is, and muted fields are
 * left out.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view to write.
 * @param value - The rest value of the component, which names its type.
 * @param patch - The fields to write, with their rest values.
 */
function writeUnderLoop(
  pctx: ProjectionCtx,
  view: View,
  value: AnyComponentValue,
  patch: Readonly<Record<string, unknown>>
): void {
  const offsets = loopOffsets(pctx, view.entity, asComponent(value.type));
  const shown: Record<string, unknown> = {};
  const based: Record<string, number> = {};

  for (const [field, entry] of Object.entries(patch)) {
    const offset = offsets[field];

    if (offset === undefined || typeof entry !== "number") {
      shown[field] = entry;

      continue;
    }

    shown[field] = entry + offset;
    based[field] = entry;
  }

  if (Object.keys(based).length > 0) {
    startTrack(pctx, view.entity, asComponent(value.type), based, {
      ms: 0,
      ease: "linear",
      delayMs: 0,
      additive: false
    }).finish();
  }

  writeUnmuted(pctx, view.entity, value, shown);
}

/**
 * Writes the rest values of the named components at once where a loop of the view may still
 * run: in play mode, and when `settle(entity)` writes in a world that is not live. A value under
 * a loop keeps the offset on top and reaches the driver too, as `writeUnderLoop` says. A direct
 * reconcile needs none of this and uses `writeRestNow`: its flush ends every loop.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view to correct.
 * @param components - The component names to write.
 */
export function writeRestUnderLoops(
  pctx: ProjectionCtx,
  view: View,
  components: readonly string[]
): void {
  for (const name of components) {
    const value = view.rest.get(name);

    if (value === undefined || value.value === true) continue;

    writeUnderLoop(pctx, view, value, value.value as Record<string, unknown>);
  }
}

/**
 * Writes the rest values of the named components at once, leaving out muted fields. It is the
 * write of a direct reconcile, whose flush ends every loop of the view: a value written under a
 * loop that runs on goes through `writeRestUnderLoops`.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view to correct.
 * @param components - The component names to write.
 */
export function writeRestNow(pctx: ProjectionCtx, view: View, components: readonly string[]): void {
  for (const name of components) {
    const value = view.rest.get(name);

    if (value === undefined || value.value === true) continue;

    writeUnmuted(pctx, view.entity, value, value.value as Record<string, unknown>);
  }
}

/**
 * Cancels every running motion of a view. Values stay where they are, which is what makes the
 * next motion start from the current picture.
 *
 * @param view - The view.
 */
export function cancelHandles(view: View): void {
  for (const handle of view.handles) handle.cancel();
  view.handles = [];
}

/**
 * Finishes every running motion of a view: the load, restore, unmount and fast-mode path.
 *
 * @param view - The view.
 */
export function finishHandles(view: View): void {
  for (const handle of view.handles) handle.finish();
  view.handles = [];
}

/**
 * Tells whether any motion of a view still runs.
 *
 * @param view - The view.
 * @returns True while one handle is active.
 */
export function stillMoving(view: View): boolean {
  return view.handles.some(handle => handle.active());
}

/**
 * Tells whether a stored field is at its rest value. Two numbers match within `REST_TOLERANCE`,
 * anything else must be deeply equal.
 *
 * @param stored - The field as the entity carries it.
 * @param rest - The field of the rest pose.
 * @returns True when the field needs no correction.
 * @example
 * ```ts
 * atRest(195.000_000_000_000_06, 195); // true
 * atRest(195.01, 195); // false
 * ```
 */
function atRest(stored: unknown, rest: unknown): boolean {
  if (typeof stored === "number" && typeof rest === "number") {
    return Math.abs(stored - rest) <= REST_TOLERANCE;
  }

  return deepEquals(stored, rest);
}

/**
 * The fields of one rest component that are off their rest value: muted fields left out, numbers
 * within `REST_TOLERANCE`. The value under the loop of the view is what is compared, so the
 * offset of a loop is no miss, and a miss in a field a loop adds to is one. A tag and a component
 * the entity does not carry answer nothing.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view to check.
 * @param name - Name of the rest component.
 * @param value - The rest value of that component.
 * @returns The fields to write to bring the component home, by field name, with their rest
 *   values.
 */
function offRestFields(
  pctx: ProjectionCtx,
  view: View,
  name: string,
  value: AnyComponentValue
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (value.value === true) return patch;

  const under = valueUnderLoop(pctx, view, value);

  if (under === undefined) return patch;

  const muted = mutedFields(pctx, view.entity, name);

  for (const [field, entry] of Object.entries(value.value as Record<string, unknown>)) {
    if (!muted.has(field) && !atRest(under[field], entry)) patch[field] = entry;
  }

  return patch;
}

/**
 * Tells whether a view carries a component off its rest value: a field another writer owns does
 * not count, a number counts as at rest within `REST_TOLERANCE`, and what a loop adds does not
 * count. A rollback asks it before it settles a view whose item did not change.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view to check.
 * @returns True when at least one field of one rest component is off its rest value.
 */
export function standsOffRest(pctx: ProjectionCtx, view: View): boolean {
  for (const [name, value] of view.rest) {
    if (Object.keys(offRestFields(pctx, view, name, value)).length > 0) return true;
  }

  return false;
}

/**
 * The convergence check of the last motion: every rest component is compared with the value
 * under the loop of the view, muted fields excluded, numbers within `REST_TOLERANCE`. A
 * difference is written and reported. A field a loop adds to is handed to the driver and written
 * with the offset on top, so the correction does not jump and is not undone by the loop.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view that came to rest.
 */
export function checkConvergence(pctx: ProjectionCtx, view: View): void {
  for (const [name, value] of view.rest) {
    const patch = offRestFields(pctx, view, name, value);

    if (Object.keys(patch).length === 0) continue;

    writeUnderLoop(pctx, view, value, patch);
    pctx.ctx.log.warn("world:view-corrected", {
      projection: view.projection,
      key: view.key,
      component: name
    });
  }
}
