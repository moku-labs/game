/**
 * @file world/projection — the rest poses an owner records with `setRest`, written in place (F244 В). Each component
 * of an element keeps one record, its fields written again by every `setRest` that names the same fields; what a hook
 * or a game reads (`view.rest`, `restOf`) is a frozen copy, made at the first read after a `setRest` and kept until
 * the next one. So a rest pose nobody reads makes nothing, and a value once read keeps its fields and stays frozen.
 */
import type { AnyComponentValue, ComponentType } from "../ecs/types";
import type { RestPose } from "./types";

/** The kept record of one component's rest pose: the type, the fields written in place, the copy last read. */
type KeptRest = {
  readonly type: ComponentType<object>;
  readonly value: Record<string, unknown>;
  /** The frozen copy a read hands out, `undefined` until the first read after a `setRest`. */
  snapshot: Readonly<Record<string, unknown>> | undefined;
  /** How many fields the record holds besides the defaults of its type. */
  readonly extras: number;
};

/**
 * Tells whether an entry of a rest pose is a kept record of `writeRest`, which carries the copy last read: only such an
 * entry is written in place and read through a copy. A projection view's rest is the frozen value `view` returned.
 *
 * @param entry - An entry of a rest pose.
 * @returns True for a kept record.
 */
function isKept(entry: AnyComponentValue): entry is AnyComponentValue & KeptRest {
  return "snapshot" in entry;
}

/**
 * Tells whether a kept record names exactly the fields `{ ...defaults, ...value }` has: every field of the value is
 * in it, and it has as many fields besides the defaults as the value names.
 *
 * @param kept - The kept record.
 * @param defaults - The defaults of the component type.
 * @param value - The rest value of this call.
 * @returns True when the value can be written into the record.
 */
function fits(kept: KeptRest, defaults: object, value: object): boolean {
  let extras = 0;

  // Per `setRest`: `for…in` over the value's own fields, no key array.
  for (const field in value) {
    if (!(field in kept.value)) return false;
    if (!(field in defaults)) extras++;
  }

  return extras === kept.extras;
}

/**
 * Counts the fields of a value its type's defaults do not name.
 *
 * @param defaults - The defaults of the component type.
 * @param value - The rest value.
 * @returns The count.
 * @example
 * ```ts
 * extrasOf({ x: 0, y: 0 }, { x: 4, scaleX: 0.5 }); // 1
 * ```
 */
function extrasOf(defaults: object, value: object): number {
  let extras = 0;

  for (const field in value) if (!(field in defaults)) extras++;

  return extras;
}

/**
 * Records the rest value of one component in a rest pose: `{ ...defaults, ...value }`, written into the component's
 * kept record while it names the same fields, else a new record. The copy a read handed out before stays as it was.
 *
 * @param pose - The rest pose of the entity.
 * @param type - The component type.
 * @param value - The rest value.
 */
export function writeRest(pose: RestPose, type: ComponentType<object>, value: object): void {
  const name = type.componentName;
  const entry = pose.get(name);
  const defaults = type.defaults as Readonly<Record<string, unknown>>;
  const fields = value as Readonly<Record<string, unknown>>;

  if (entry !== undefined && isKept(entry) && entry.type === type && fits(entry, defaults, value)) {
    const kept = entry.value;

    for (const field in kept) kept[field] = field in fields ? fields[field] : defaults[field];
    entry.snapshot = undefined;

    return;
  }

  const made: KeptRest = {
    type,
    value: { ...defaults, ...fields },
    snapshot: undefined,
    extras: extrasOf(defaults, value)
  };

  pose.set(name, asEntry(made));
}

/**
 * A kept record as the entry of a rest pose: the type and the value an entry carries, and the fields of its own.
 *
 * @param kept - The kept record.
 * @returns The same object, typed as an entry.
 */
function asEntry(kept: KeptRest): AnyComponentValue {
  return kept;
}

/**
 * The value of an entry of a rest pose as a hook or a game reads it: the frozen copy of a kept record, made at the
 * first read after its last `setRest`; the frozen value itself for a projection view's rest.
 *
 * @param entry - An entry of a rest pose.
 * @returns The value, or `true` for a tag.
 */
export function restValue(entry: AnyComponentValue): object | true {
  if (!isKept(entry)) return entry.value;

  const kept: KeptRest = entry;
  const snapshot = kept.snapshot ?? Object.freeze({ ...kept.value });

  kept.snapshot = snapshot;

  return snapshot;
}
