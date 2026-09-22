/**
 * @file world/projection — the view record: what `view(item)` produced, how it reaches the store
 * and how the layer is written.
 */
import type { AnyComponent, AnyComponentType, AnyComponentValue, Entity } from "../ecs/types";
import type { AnyProjectionSpec, ProjectionCtx, View } from "./types";

/**
 * Normalises a caught value into an `Error`, so the log always gets one.
 *
 * @param error - What was thrown.
 * @returns The error, or one built from the thrown value.
 * @example
 * ```ts
 * asError("boom").message; // "boom"
 * ```
 */
export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Creates the empty component table of one `view(item)` call. It lives in its own non-exported
 * function because lint rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty table of component name to value.
 */
function emptyValues(): Map<string, AnyComponentValue> {
  return new Map();
}

/**
 * Reads a registered component type as a plain record type, so the projection can write it while
 * knowing it only by name.
 *
 * @param componentType - The type as the world stores it.
 * @returns The same object, typed for a record write.
 */
export function asComponent(componentType: AnyComponentType): AnyComponent {
  // The object is the callable type `component()` built; only its value shape is erased here.
  return componentType as AnyComponent;
}

/**
 * Runs `view(item)` and collects its output by component name. `Layer` is the projection's own
 * component: a view that returns it is reported and that value ignored.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param item - The model item.
 * @returns The component values, by name.
 */
export function collectView(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  item: unknown
): Map<string, AnyComponentValue> {
  const values = emptyValues();
  const layerName = pctx.deps.components.Layer.componentName;

  for (const value of spec.view(item)) {
    if (value.type.componentName === layerName) {
      pctx.ctx.log.warn("world:view-returned-layer", { projection: spec.name });

      continue;
    }

    values.set(value.type.componentName, value);
  }

  return values;
}

/**
 * Writes the layer of a view.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity of the view.
 * @param name - Name of the layer.
 */
export function writeLayer(pctx: ProjectionCtx, entity: Entity, name: string): void {
  pctx.deps.ecs.add(entity, pctx.deps.components.Layer({ name }));
}

/**
 * Reads the stored value of one component of a view.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity of the view.
 * @param componentType - The component type.
 * @returns The stored record, or `undefined` for a tag and for a missing component.
 */
export function storedValue(
  pctx: ProjectionCtx,
  entity: Entity,
  componentType: AnyComponentType
): Readonly<Record<string, unknown>> | undefined {
  return pctx.deps.ecs.get(entity, asComponent(componentType));
}

/**
 * Writes one component value straight onto the entity.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity of the view.
 * @param value - The component or tag value.
 */
export function writeValue(pctx: ProjectionCtx, entity: Entity, value: AnyComponentValue): void {
  pctx.deps.ecs.add(entity, value);
}

/**
 * Builds a fresh view record for a key that entered.
 *
 * @param entity - The entity of the view.
 * @param projection - Name of the projection.
 * @param key - The model key.
 * @param item - The model item.
 * @param rest - The output of `view(item)`, which is the rest pose.
 * @returns The view record.
 */
export function createViewRecord(
  entity: Entity,
  projection: string,
  key: string,
  item: unknown,
  rest: Map<string, AnyComponentValue>
): View {
  return {
    entity,
    projection,
    key,
    item,
    rest,
    handles: [],
    lifted: false,
    dropWhenStill: false,
    exiting: false
  };
}
