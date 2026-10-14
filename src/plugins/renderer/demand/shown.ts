/**
 * @file renderer/demand — what "shown" means (F6, F18a): a view drawn in the frame as it stands, a leaf off the screen
 * excepted. Everything read is a public Pixi property: `parent`, `visible`, `renderable`, `alpha`, `filters`,
 * `Filter.padding`, `getBounds` and `Application.screen`.
 */
import type { Entity } from "../../world/types";
import type { View } from "../sync/types";
import type { HostModule, PixiBounds, PixiContainer } from "../types";
import type { DemandState } from "./types";

/**
 * The paddings of every filter a node holds, enabled or not: a superset of what any of them could spill onto the
 * screen. Pixi answers `undefined` before the first write and `null` after a clear.
 *
 * @param node - A display object on the chain of a view.
 * @returns The sum of the paddings; 0 without a filter.
 */
function paddingOf(node: PixiContainer): number {
  const filters: readonly { padding: number }[] | null | undefined = node.filters;

  if (filters === null || filters === undefined) return 0;

  let pad = 0;

  for (const filter of filters) pad += filter.padding;

  return pad;
}

/** What `chainPadding` answers for a chain that is not drawn. */
const HIDDEN = -1;

/**
 * Walks from a node up to the stage: every node on the way is visible, renderable and not fully transparent, and the
 * chain reaches the stage. The paddings of the filters met on the way are summed; no object is made.
 *
 * @param from - The first node of the walk.
 * @param stage - The stage of the application.
 * @returns The sum of the paddings of the chain, or `HIDDEN` when the chain is not drawn.
 */
function chainPadding(from: PixiContainer | null, stage: PixiContainer): number {
  let pad = 0;

  for (let node = from; node !== stage; node = node.parent) {
    if (node === null) return HIDDEN;
    if (!node.visible || !node.renderable || node.alpha <= 0) return HIDDEN;

    pad += paddingOf(node);
  }

  return pad;
}

/**
 * The bounds scratch of the off-screen test, made on first use from the Pixi module the renderer loaded.
 *
 * @param state - The demand state.
 * @param host - The host module.
 * @returns The scratch, or `undefined` while nothing draws.
 */
function boundsOf(state: DemandState, host: HostModule): PixiBounds | undefined {
  if (state.bounds !== undefined) return state.bounds;

  const pixi = host.pixi();

  if (pixi === undefined) return undefined;

  state.bounds = new pixi.Bounds();

  return state.bounds;
}

/**
 * Whether a leaf meets the screen: its global bounds, padded by the filters of its chain, intersect `app.screen`.
 * Empty bounds (nothing measurable) never do: nothing is drawn, so nothing is to draw again.
 *
 * @param state - The demand state (its `bounds` scratch).
 * @param host - The host module (`screen()`).
 * @param top - The node the bounds are measured on.
 * @param pad - The paddings of the chain.
 * @returns True when some of it lands on the screen; true as well when nothing can be measured.
 */
function onScreen(state: DemandState, host: HostModule, top: PixiContainer, pad: number): boolean {
  const screen = host.screen();
  const bounds = boundsOf(state, host);

  if (screen === undefined || bounds === undefined) return true;

  top.getBounds(false, bounds);

  if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) return false;

  return (
    bounds.maxX + pad > screen.x &&
    bounds.minX - pad < screen.x + screen.width &&
    bounds.maxY + pad > screen.y &&
    bounds.minY - pad < screen.y + screen.height
  );
}

/**
 * Whether the entity's view is drawn in the frame as it stands now: it hangs under the stage, nothing on its chain
 * hides it, and a leaf meets the screen with the paddings of its chain. A view with children, its wrapper's or Pixi
 * children of its own object, is never exempt off the screen: a child may carry a filter whose padding Pixi's bounds
 * leave out.
 *
 * @param state - The demand state (its `bounds` scratch).
 * @param host - The host module (`stage()`, `screen()`).
 * @param views - The views by entity.
 * @param entity - The marked entity.
 * @returns True when the view is drawn.
 */
export function isShown(
  state: DemandState,
  host: HostModule,
  views: ReadonlyMap<Entity, View>,
  entity: Entity
): boolean {
  const view = views.get(entity);
  const stage = host.stage();

  if (view === undefined || stage === undefined) return false;

  const top = view.wrapper ?? view.object;
  const pad = chainPadding(top, stage);

  if (pad === HIDDEN) return false;
  if (view.wrapper !== undefined || top.children.length > 0) return true;

  return onScreen(state, host, top, pad);
}

/**
 * The ancestor rule of loose marks: the walk of `isShown` from the parent of the view's top node, without bounds. A
 * plugin's own object may have changed its own alpha or size inside `update`, so only what the renderer owns is
 * trusted.
 *
 * @param host - The host module (`stage()`).
 * @param views - The views by entity.
 * @param entity - The entity of a loose mark.
 * @returns True when the ancestors of the view draw it.
 */
export function ancestorsShown(
  host: HostModule,
  views: ReadonlyMap<Entity, View>,
  entity: Entity
): boolean {
  const view = views.get(entity);
  const stage = host.stage();

  if (view === undefined || stage === undefined) return false;

  return chainPadding((view.wrapper ?? view.object).parent, stage) !== HIDDEN;
}
