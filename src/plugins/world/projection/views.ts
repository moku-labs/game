/**
 * @file world/projection — the view record: what `view(item)` produced, how it reaches the store
 * and how the layer is written.
 */
import type {
  AnyComponent,
  AnyComponentType,
  AnyComponentValue,
  Entity,
  Owner
} from "../ecs/types";
import type {
  AnyProjectionSpec,
  DescriptionNode,
  MotionCause,
  Mounted,
  ProjectionCtx,
  View,
  ViewOutput
} from "./types";

/** The components of a view built aside or held warm at its spawn: none, so it is flagged before the first `onAdded`. */
const NO_COMPONENTS: readonly AnyComponentValue[] = [];

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
 * the root draws at the `Order` of its place in the mounted list (or the list of the running build,
 * which mounts it aside), written before `Tree` because the ecs fires `onAdded` in list order and the
 * `Tree` hook of `ui` reads it. `Order` is part of the view's rest, so a new node compares it by value
 * and writes nothing.
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
  const state = pctx.ctx.state.projection;
  // A name is in one table only: the build mounts aside only what the current scene does not mount.
  const order =
    (state.mounted.get(spec.name) ?? state.building?.mounted.get(spec.name))?.order ?? 0;
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
 * Moves one screen root from the `Order` of its old place to the new one, on the entity and in the
 * rest pose. A view that does not draw at the old place keeps its own.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view.
 * @param previous - The `Order` of the place the projection had.
 * @param order - The `Order` of its new place.
 */
function placeView(pctx: ProjectionCtx, view: View, previous: number, order: number): void {
  if (!drawsAtPlace(pctx, view, previous)) return;

  const value = pctx.deps.components.Order({ value: order });

  view.rest.set(value.type.componentName, value);
  writeValue(pctx, view.entity, value);
}

/**
 * Keeps a mounted projection for the scene that comes, as a scene switch does for a projection
 * both scenes list: it stays mounted into the new layer list, and its screen roots take the
 * `Order` of their place in the new list, on the entity and in the rest pose, so the next node of
 * a root compares equal and writes none; the view a warm window holds hidden does too. Nothing
 * else is touched: no view is spawned or despawned, no motion is cut, no hook runs. A view on its
 * way out keeps the order it leaves with.
 *
 * @param pctx - Domain context of the projection module.
 * @param mounted - The mounted projection the new list names again.
 * @param order - The `Order` of its place in the new list.
 * @param held - The view of its warm window, if any: held hidden, or shown and then placed with the
 *   live views already.
 */
export function placeMounted(
  pctx: ProjectionCtx,
  mounted: Mounted,
  order: number,
  held?: View
): void {
  const previous = mounted.order;

  mounted.layers = pctx.ctx.state.projection.layers;

  if (previous === order) return;

  mounted.order = order;

  for (const view of mounted.live.values()) placeView(pctx, view, previous, order);
  if (held !== undefined) placeView(pctx, held, previous, order);
}

/**
 * Spawns the entity of a view that is built aside or held warm: bare, flagged in `flags`, then
 * given its `Layer` and its view components in that order. The ecs fires `onAdded` in list order,
 * so every hook of a plugin already sees the flag (F97), and the `Tree` hook of `ui` the layer.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param values - The output of `view(item)`, by component name.
 * @param flags - The set `isBuilding` reads: the scene build's entities, or the warm held ones.
 * @returns The entity.
 */
export function spawnFlagged(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  values: ReadonlyMap<string, AnyComponentValue>,
  flags: Set<Entity>
): Entity {
  const ecs = pctx.deps.ecs;
  const owner: Owner = { kind: "projection", name: spec.name };
  const entity = ecs.spawn(owner, NO_COMPONENTS);

  flags.add(entity);
  ecs.add(entity, pctx.deps.components.Layer({ name: spec.layer }));
  for (const value of values.values()) ecs.add(entity, value);

  return entity;
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
