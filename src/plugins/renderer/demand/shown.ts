/**
 * @file renderer/demand — what "shown" means (F6, F18a): a view drawn in the frame as it stands, a leaf off the screen
 * excepted. A kept top is drawn through its quad (spec 23 P10.1): the walk goes on through it, with the padding its
 * filters hang with on the stand-in. Everything read is a public Pixi property: `parent`, `visible`, `renderable`,
 * `filters`, `Filter.padding`, `getBounds` and `Application.screen`; whether a node is at alpha 0 is read from the
 * engine's records by the reader `demand` hands in (E4), Pixi's `alpha` only where no record holds it. The same walk
 * says where it stopped (`unseenBy`, spec 26 R1.7.3), so `sync.loopsHeld` holds the loops of a view nobody sees.
 */
import type { Entity } from "../../world/types";
import type { View } from "../sync/types";
import type { HostModule, PixiBounds, PixiContainer } from "../types";
import type { DemandState, Unseen } from "./types";

/**
 * The paddings of every filter a node holds: what they could spill onto the screen. Pixi holds the enabled filters of
 * a view (E3), and a filter switched on reaches Pixi before the decision judges the marks again. Pixi answers
 * `undefined` before the first write and `null` after a clear.
 *
 * @param node - A display object on the chain of a view.
 * @returns The sum of the paddings; 0 without a filter.
 */
function paddingOf(node: PixiContainer): number {
  const filters: readonly { padding: number }[] | null | undefined = node.filters;

  if (filters === null || filters === undefined) return 0;

  let pad = 0;

  // per walk: Pixi's list is frozen, and `for…of` over a frozen array allocates its iterator (88 B).
  for (let index = 0; index < filters.length; index += 1) pad += filters[index]?.padding ?? 0;

  return pad;
}

/** What `chainPadding` answers for a chain that is not drawn. */
const HIDDEN = -1;

/**
 * What a node whose `renderable` is false adds to a chain: the padding of a kept top its quad draws, or `HIDDEN`.
 */
export type DrawnThrough = (node: PixiContainer) => number;

/**
 * Whether a node is the top or the visual of a view hidden by `"alpha"`: sync's reasons, read by `unseenBy`.
 */
export type AlphaHidden = (node: PixiContainer) => boolean;

/**
 * Whether a node on the chain of a view is drawn at alpha 0. `demand` reads it from the engine's records: Pixi's
 * `alpha` getter hands its double back boxed at every read of a walk (E4).
 */
export type Transparent = (node: PixiContainer) => boolean;

/** Where a walk notes the node at alpha 0 it stopped at. */
type WalkStop = { node: PixiContainer | undefined };

/**
 * The reader without kept pictures: no quad draws any node.
 *
 * @returns `HIDDEN`.
 */
function noneThrough(): number {
  return HIDDEN;
}

/**
 * The reader without sync's reasons: no node is hidden by `"alpha"`.
 *
 * @returns False.
 */
function noAlpha(): boolean {
  return false;
}

/**
 * The reader without the engine's records: Pixi's own `alpha`.
 *
 * @param node - A node on the chain of a view.
 * @returns True at alpha 0 or below.
 */
function alphaZero(node: PixiContainer): boolean {
  return node.alpha <= 0;
}

/**
 * Walks from a node up to the stage: every node on the way is visible, renderable (or a kept top its quad draws) and
 * not fully transparent, and the chain reaches the stage. The paddings of the filters met on the way are summed; no
 * object is made.
 *
 * @param from - The first node of the walk.
 * @param stage - The stage of the application.
 * @param through - The kept reader: the padding of a kept top drawn through its quad, or `HIDDEN`.
 * @param transparent - Whether a node is drawn at alpha 0.
 * @param stop - Where the walk notes a visible node at alpha 0 it stopped at; left as it is for any other stop.
 * @returns The sum of the paddings of the chain, or `HIDDEN` when the chain is not drawn.
 */
function chainPadding(
  from: PixiContainer | null,
  stage: PixiContainer,
  through: DrawnThrough,
  transparent: Transparent,
  stop?: WalkStop
): number {
  let pad = 0;

  for (let node = from; node !== stage; node = node.parent) {
    if (node === null || !node.visible) return HIDDEN;

    if (transparent(node)) {
      if (stop !== undefined) stop.node = node;

      return HIDDEN;
    }

    if (!node.renderable) {
      const kept = through(node);

      if (kept === HIDDEN) return HIDDEN;

      pad += kept;
    }

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
 * What a walk that stopped at a node at alpha 0 answers: the view's own alpha, the alpha of a view above it, or a node
 * no `"alpha"` reason hides (a game's object, a layer).
 *
 * @param node - The node at alpha 0, or `undefined` when the walk stopped for another reason.
 * @param top - The top of the view the walk started from.
 * @param alphaHidden - Sync's reader of the `"alpha"` reason.
 * @returns `"alpha-own"`, `"alpha-above"` or `"other"`.
 */
function alphaStop(
  node: PixiContainer | undefined,
  top: PixiContainer,
  alphaHidden: AlphaHidden
): Unseen {
  if (node === undefined || !alphaHidden(node)) return "other";

  return node === top ? "alpha-own" : "alpha-above";
}

/**
 * Where the walk of `isShown` stops for the entity's view: `"shown"` when it is drawn in the frame as it stands now
 * (it hangs under the stage, nothing on its chain hides it, and a leaf meets the screen with the paddings of its
 * chain), else the reason it is not. A view with children, its wrapper's or Pixi children of its own object, is never
 * exempt off the screen: a child may carry a filter whose padding Pixi's bounds leave out.
 *
 * @param state - The demand state (its `bounds` and `stop` scratch).
 * @param host - The host module (`stage()`, `screen()`).
 * @param views - The views by entity.
 * @param entity - The entity.
 * @param through - The kept reader: the padding of a kept top drawn through its quad, or `HIDDEN`; none by default.
 * @param alphaHidden - Sync's reader of the `"alpha"` reason; none by default.
 * @param transparent - Whether a node is drawn at alpha 0; Pixi's `alpha` by default.
 * @returns Where the walk stopped.
 */
export function unseenBy(
  state: DemandState,
  host: HostModule,
  views: ReadonlyMap<Entity, View>,
  entity: Entity,
  through: DrawnThrough = noneThrough,
  alphaHidden: AlphaHidden = noAlpha,
  transparent: Transparent = alphaZero
): Unseen {
  const view = views.get(entity);
  const stage = host.stage();

  if (view === undefined || stage === undefined) return "other";

  const top = view.wrapper ?? view.object;

  state.stop.node = undefined;

  const pad = chainPadding(top, stage, through, transparent, state.stop);

  if (pad === HIDDEN) return alphaStop(state.stop.node, top, alphaHidden);
  if (view.wrapper !== undefined || top.children.length > 0) return "shown";

  return onScreen(state, host, top, pad) ? "shown" : "off-screen";
}

/**
 * Whether the entity's view is drawn in the frame as it stands now: `unseenBy` answers `"shown"`.
 *
 * @param state - The demand state (its `bounds` scratch).
 * @param host - The host module (`stage()`, `screen()`).
 * @param views - The views by entity.
 * @param entity - The marked entity.
 * @param through - The kept reader: the padding of a kept top drawn through its quad, or `HIDDEN`; none by default.
 * @param transparent - Whether a node is drawn at alpha 0; Pixi's `alpha` by default.
 * @returns True when the view is drawn.
 */
export function isShown(
  state: DemandState,
  host: HostModule,
  views: ReadonlyMap<Entity, View>,
  entity: Entity,
  through: DrawnThrough = noneThrough,
  transparent: Transparent = alphaZero
): boolean {
  return unseenBy(state, host, views, entity, through, noAlpha, transparent) === "shown";
}

/**
 * The ancestor rule of loose marks: the walk of `isShown` from the parent of the view's top node, without bounds. A
 * plugin's own object may have changed its own alpha or size inside `update`, so only what the renderer owns is
 * trusted.
 *
 * @param host - The host module (`stage()`).
 * @param views - The views by entity.
 * @param entity - The entity of a loose mark.
 * @param through - The kept reader: the padding of a kept top drawn through its quad, or `HIDDEN`; none by default.
 * @param transparent - Whether a node is drawn at alpha 0; Pixi's `alpha` by default.
 * @returns True when the ancestors of the view draw it.
 */
export function ancestorsShown(
  host: HostModule,
  views: ReadonlyMap<Entity, View>,
  entity: Entity,
  through: DrawnThrough = noneThrough,
  transparent: Transparent = alphaZero
): boolean {
  const view = views.get(entity);
  const stage = host.stage();

  if (view === undefined || stage === undefined) return false;

  return chainPadding((view.wrapper ?? view.object).parent, stage, through, transparent) !== HIDDEN;
}
