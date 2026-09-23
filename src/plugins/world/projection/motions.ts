/**
 * @file world/projection — the motion side: the `ViewHandle` a hook is given, the retarget policy
 * of spike P5, the settle of the loose components and the convergence check.
 */
import type { AnyComponentValue, ComponentType, Entity } from "../ecs/types";
import { deepEquals } from "./diff";
import { drivenComponents, inertHandle, mutedFields, startTrack } from "./driver";
import type {
  AnyProjectionSpec,
  Motion,
  MotionHandle,
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
 * The rest components that are off their rest value and that no running track drives.
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

    const stored = storedValue(pctx, view.entity, value.type);

    if (stored !== undefined && !deepEquals(stored, value.value)) loose.push(name);
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
    writeRestNow(pctx, view, components);

    return;
  }

  if (played.motion !== undefined) view.handles.push(played.motion);
}

/**
 * Writes the rest values of the named components at once, leaving out muted fields.
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
 * The convergence check of the last motion: every rest component is compared with the stored
 * value, muted fields excluded, numbers within `REST_TOLERANCE`. A difference is written and
 * reported.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view that came to rest.
 */
export function checkConvergence(pctx: ProjectionCtx, view: View): void {
  for (const [name, value] of view.rest) {
    if (value.value === true) continue;

    const stored = storedValue(pctx, view.entity, value.type);

    if (stored === undefined) continue;

    const muted = mutedFields(pctx, view.entity, name);
    const patch: Record<string, unknown> = {};

    for (const [field, entry] of Object.entries(value.value as Record<string, unknown>)) {
      if (!muted.has(field) && !atRest(stored[field], entry)) patch[field] = entry;
    }

    if (Object.keys(patch).length === 0) continue;

    pctx.deps.ecs.set(view.entity, asComponent(value.type), patch);
    pctx.ctx.log.warn("world:view-corrected", {
      projection: view.projection,
      key: view.key,
      component: name
    });
  }
}
