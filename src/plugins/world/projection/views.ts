/**
 * @file world/projection — the view record: what `view(item)` produced, how it reaches the store
 * and how the layer is written.
 */
import type { AnyComponent, AnyComponentType, AnyComponentValue, Entity } from "../ecs/types";
import type {
  AnyProjectionSpec,
  DescriptionNode,
  MotionCause,
  Mounted,
  ProjectionCtx,
  View,
  ViewOutput
} from "./types";

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
 * Tells a single description node apart from a list of component values.
 *
 * @param output - What `view(item)` returned.
 * @returns True when the projection described a screen instead of components.
 */
function isNode(output: ViewOutput): output is DescriptionNode {
  return !Array.isArray(output);
}

/**
 * Runs `view(item)` and collects its output by component name. A view that describes a screen
 * returns one node, which becomes the `Tree` of the entity, and `ui` reconciles it from there;
 * the root draws at the `Order` of its place in the mounted list, written before `Tree` because the
 * ecs fires `onAdded` in list order and the `Tree` hook of `ui` reads it. `Order` is part of the
 * view's rest, so a new node compares it by value and writes nothing.
 * `Layer` is the projection's own component: a view that returns it is reported and ignored.
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
  const output = spec.view(item);
  const { Order, Tree } = pctx.deps.components;
  const order = pctx.ctx.state.projection.mounted.get(spec.name)?.order ?? 0;
  const produced = isNode(output) ? [Order({ value: order }), Tree({ node: output })] : output;

  for (const value of produced) {
    if (value.type.componentName === layerName) {
      pctx.ctx.log.warn("world:view-returned-layer", { projection: spec.name });

      continue;
    }

    values.set(value.type.componentName, value);
  }

  return values;
}

/**
 * Tells whether a view is a screen root that draws at the place of its projection in a list: its
 * view described a node, so `collectView` gave it a `Tree` and the `Order` of that place. A view
 * that returned its own components keeps whatever `Order` it gave itself.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - A live view of the projection.
 * @param order - The `Order` of the place the projection had.
 * @returns True when the view draws at that place.
 */
function drawsAtPlace(pctx: ProjectionCtx, view: View, order: number): boolean {
  const { Order, Tree } = pctx.deps.components;
  const rest = view.rest.get(Order.componentName)?.value;

  return (
    view.rest.has(Tree.componentName) &&
    typeof rest === "object" &&
    "value" in rest &&
    rest.value === order
  );
}

/**
 * Keeps a mounted projection for the scene that comes, as a scene switch does for a projection
 * both scenes list: it stays mounted into the new layer list, and its screen roots take the
 * `Order` of their place in the new list, on the entity and in the rest pose, so the next node of
 * a root compares equal and writes none. Nothing else is touched: no view is spawned or
 * despawned, no motion is cut, no hook runs. A view on its way out keeps the order it leaves with.
 *
 * @param pctx - Domain context of the projection module.
 * @param mounted - The mounted projection the new list names again.
 * @param order - The `Order` of its place in the new list.
 */
export function placeMounted(pctx: ProjectionCtx, mounted: Mounted, order: number): void {
  const previous = mounted.order;

  mounted.layers = pctx.ctx.state.projection.layers;

  if (previous === order) return;

  mounted.order = order;

  for (const view of mounted.live.values()) {
    if (!drawsAtPlace(pctx, view, previous)) continue;

    const value = pctx.deps.components.Order({ value: order });

    view.rest.set(value.type.componentName, value);
    writeValue(pctx, view.entity, value);
  }
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
 * @param cause - How the view came: `"mount"` for a direct reconcile, `"change"` for a live commit.
 * @returns The view record.
 */
export function createViewRecord(
  entity: Entity,
  projection: string,
  key: string,
  item: unknown,
  rest: Map<string, AnyComponentValue>,
  cause: MotionCause = "mount"
): View {
  return {
    entity,
    projection,
    key,
    address: Object.freeze({ projection, key }),
    item,
    rest,
    handles: [],
    lifted: false,
    dropWhenStill: false,
    loopOwed: false,
    exiting: false,
    cause
  };
}
