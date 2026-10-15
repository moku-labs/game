/**
 * @file renderer/sync — the display registry. A plugin above names one of its components and says
 * how it becomes a Pixi object; `sync` parents, orders and frees that object like a sprite. The
 * adapter is stored while the renderer is inert and never called there.
 */
import type { ComponentHandle, Entity } from "../../world/types";
import { setHidden } from "./hidden";
import type { DisplayAdapter, DisplayEntry, SyncCtx, SyncState, View } from "./types";

/**
 * The registered components an entity carries, in registration order.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @returns The entries whose component sits on the entity.
 */
export function adaptersOn(sctx: SyncCtx, entity: Entity): DisplayEntry[] {
  const ecs = sctx.ctx.deps.world.ecs;

  return sctx.ctx.state.sync.adapters.filter(entry => ecs.has(entity, entry.component));
}

/**
 * Reads the component value an adapter draws.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param entry - The registration.
 * @returns The stored value, or `undefined` when the component left.
 */
function readValue(
  sctx: SyncCtx,
  entity: Entity,
  entry: DisplayEntry
): Readonly<object> | undefined {
  return sctx.ctx.deps.world.ecs.get(entity, entry.component);
}

/**
 * Builds the display object of an entity through its adapter. Never called while inert: the
 * caller checks the Pixi module first.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param entry - The registration that draws its component.
 * @returns The object, or `undefined` when the adapter built something that cannot be drawn.
 */
export function createAdapterObject(
  sctx: SyncCtx,
  entity: Entity,
  entry: DisplayEntry
): { object: unknown; value: Readonly<object> } | undefined {
  const value = readValue(sctx, entity, entry);

  if (value === undefined) return undefined;

  return { object: entry.adapter.create(value, entity), value: { ...value } };
}

/**
 * Hides the object of an adapter view while it is drawn at alpha 0 (spec 26 B9): the public `alpha` the adapter wrote
 * on its own object, times the HUD factor its wrapper carries. Only the object: its children hang in the wrapper.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view; a `Display` view takes no `"alpha"` reason.
 */
export function writeAdapterAlpha(sctx: SyncCtx, entity: Entity, view: View): void {
  setHidden(sctx, entity, view, "alpha", view.object.alpha * view.hud <= 0);
}

/**
 * Hands a changed component value to the adapter that drew it. The stored copy is what makes
 * `previous` honest: the world writes a component in place. The adapter wrote its own object, so
 * the renderer hears of it after the write: any answer but `false` is a loose mark of the view.
 * An object the adapter left at alpha 0 is not drawn.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
export function updateAdapterView(sctx: SyncCtx, entity: Entity, view: View): void {
  const entry = view.display;

  if (entry === undefined) return;

  const next = readValue(sctx, entity, entry);

  if (next === undefined) return;

  const answer = entry.adapter.update(view.object, view.value ?? next, next);

  view.value = { ...next };
  if (answer !== false) sctx.deps.demand.markLoose(entity);
  writeAdapterAlpha(sctx, entity, view);
}

/**
 * Registers an adapter and starts watching its component. The world hooks only mark entities
 * while the renderer draws, so an inert run collects nothing.
 *
 * @param sctx - Domain context of the sync module.
 * @param component - The component a plugin above owns.
 * @param adapter - How that component is built, written and freed.
 * @param mark - The two change-set markers of the pass.
 * @param mark.added - Marks an entity as new.
 * @param mark.removed - Marks an entity as gone.
 * @returns The remover of this registration.
 */
export function provideDisplay(
  sctx: SyncCtx,
  component: ComponentHandle<object>,
  adapter: DisplayAdapter,
  mark: { added: (entity: Entity) => void; removed: (entity: Entity) => void }
): () => void {
  const state = sctx.ctx.state.sync;
  const ecs = sctx.ctx.deps.world.ecs;
  const entry: DisplayEntry = { component, adapter, removers: [] };

  entry.removers.push(ecs.onAdded(component, mark.added), ecs.onRemoved(component, mark.removed));
  state.adapters.push(entry);

  let removed = false;

  return (): void => {
    if (removed) return;

    removed = true;

    for (const off of entry.removers) off();
    entry.removers.length = 0;

    const at = state.adapters.indexOf(entry);

    if (at !== -1) state.adapters.splice(at, 1);
  };
}

/**
 * Drops every registration and its world hooks. Works on the state alone, because `onStop` has no
 * context.
 *
 * @param state - The sync branch of the plugin state.
 */
export function clearAdapters(state: SyncState): void {
  for (const entry of state.adapters) {
    for (const off of entry.removers) off();
    entry.removers.length = 0;
  }

  state.adapters.length = 0;
}
