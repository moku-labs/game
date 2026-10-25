/**
 * @file world/projection — mount and unmount: the projections of a scene's list come, stay or go.
 * A projection a scene before mounted stays when the coming scene declares its layers alike; one
 * whose layer the coming scene declares otherwise goes and comes back, as before. The build of a
 * scene aside (`build.ts`) sorts and places its list with the same steps.
 */
import type { Owner } from "../ecs/types";
import { clearMounted } from "./queue";
import { reconcile } from "./reconcile";
import type { AnyProjectionSpec, LayerSpec, Mounted, ProjectionCtx } from "./types";
import { placeMounted } from "./views";

/**
 * Creates the empty view tables of a freshly mounted projection.
 *
 * @param owner - Who owns the entities of this projection.
 * @param order - The `Order` its screen roots draw at.
 * @param layers - The layer list of the scene it is mounted into.
 * @returns A mounted projection with nothing in it yet.
 */
export function emptyMounted(
  owner: Owner,
  order: number,
  layers: ReadonlyArray<LayerSpec>
): Mounted {
  return { owner, live: new Map(), queue: [], items: new Map(), order, layers };
}

/**
 * The `Order` a screen root of a projection draws at: its place in the list of its scene minus the
 * length of the list, so the roots of one scene take −n … −1 (spec 16 U1.6).
 *
 * @param names - The projection list of the scene.
 * @param name - One projection of it.
 * @returns The order of its screen roots.
 * @example
 * ```ts
 * orderIn(["board.items", "hud"], "hud"); // -1
 * ```
 */
export function orderIn(names: readonly string[], name: string): number {
  return names.indexOf(name) - names.length;
}

/**
 * Checks that every layer a projection names is declared by a layer list.
 *
 * @param spec - The projection spec.
 * @param layers - The layer list of the scene: the current one, or the one a build comes with.
 * @throws {Error} When `layer` or `lift` is not in the layer list.
 */
export function checkLayers(spec: AnyProjectionSpec, layers: ReadonlyArray<LayerSpec>): void {
  const declared = new Set(layers.map(layer => layer.name));

  for (const name of [spec.layer, spec.lift]) {
    if (name === undefined || declared.has(name)) continue;

    throw new Error(
      `[game] Projection "${spec.name}" names layer "${name}", which the scene does not declare.\n` +
        "  Add it to the layers of the scene."
    );
  }
}

/**
 * Tells whether two layer lists declare one layer alike: every field of its entry (`sort`,
 * `above`, whatever a layer declares) the same in both. The renderer keeps the container of a
 * layer that stays, but sorts a view again only when the view changes, so a view kept under
 * another rule would stand at its old place.
 *
 * @param before - The layer list the projection was mounted under.
 * @param after - The layer list of the coming scene.
 * @param name - The layer name.
 * @returns True when both lists hold the layer with the same fields.
 * @example
 * ```ts
 * sameLayer([{ name: "ui", sort: "none" }], [{ name: "ui", sort: "order" }], "ui"); // false
 * ```
 */
function sameLayer(
  before: ReadonlyArray<LayerSpec>,
  after: ReadonlyArray<LayerSpec>,
  name: string
): boolean {
  const first = before.find(layer => layer.name === name);
  const second = after.find(layer => layer.name === name);

  if (first === undefined || second === undefined) return false;

  const fields = Object.entries(first);

  return (
    fields.length === Object.keys(second).length &&
    fields.every(
      ([field, value]) => Object.getOwnPropertyDescriptor(second, field)?.value === value
    )
  );
}

/**
 * Tells whether a projection draws under the same rules in two layer lists: its `layer`, and its
 * `lift` when it has one, declared alike in both.
 *
 * @param before - The layer list the projection was mounted under.
 * @param after - The layer list of the coming scene.
 * @param spec - The projection spec.
 * @returns True when the projection can stay mounted.
 */
function drawsAlike(
  before: ReadonlyArray<LayerSpec>,
  after: ReadonlyArray<LayerSpec>,
  spec: AnyProjectionSpec
): boolean {
  return (
    sameLayer(before, after, spec.layer) &&
    (spec.lift === undefined || sameLayer(before, after, spec.lift))
  );
}

/**
 * Unmounts projections: every motion of their views is finished, and the live views and the
 * despawn queue are despawned in the same call. An unknown or unmounted name is skipped.
 *
 * @param pctx - Domain context of the projection module.
 * @param names - Names of the projections to unmount.
 */
export function unmountNames(pctx: ProjectionCtx, names: readonly string[]): void {
  const state = pctx.ctx.state.projection;

  for (const name of names) {
    const mounted = state.mounted.get(name);

    if (mounted === undefined) continue;

    clearMounted(pctx, mounted);
    state.mounted.delete(name);
  }
}

/**
 * The first pass of a mount, which touches nothing: every name is checked against a layer list, a
 * projection mounted under that very list already is reported and passed over, and the rest is
 * sorted into the ones that come and the ones a scene before mounted that have to go and come back.
 *
 * @param pctx - Domain context of the projection module.
 * @param names - Names of the projections to mount.
 * @param layers - The layer list they are mounted under: the current one, or the one a build comes with.
 * @returns The specs to mount and reconcile, and the names to unmount first.
 * @throws {Error} For an unknown name, or a `layer` or `lift` the list does not declare.
 */
export function sortMount(
  pctx: ProjectionCtx,
  names: readonly string[],
  layers: ReadonlyArray<LayerSpec>
): { fresh: AnyProjectionSpec[]; again: string[] } {
  const state = pctx.ctx.state.projection;
  const fresh: AnyProjectionSpec[] = [];
  const again: string[] = [];

  for (const name of names) {
    const spec = state.specs.get(name);

    if (spec === undefined) {
      throw new Error(
        `[game] Projection "${name}" is not registered.\n` +
          "  Register it before a scene mounts it."
      );
    }

    const mounted = state.mounted.get(name);

    // Mounted into this scene already: a second mount changes nothing.
    if (mounted?.layers === layers) {
      pctx.ctx.log.warn("world:already-mounted", { projection: name });

      continue;
    }

    // One a scene before mounted stays (F23) when it draws alike; its layers are checked too.
    checkLayers(spec, layers);

    if (mounted !== undefined && drawsAlike(mounted.layers, layers, spec)) continue;
    if (mounted !== undefined) again.push(name);

    fresh.push(spec);
  }

  return { fresh, again };
}

/**
 * Mounts the projections of a list under an owner. A new one is reconciled at once, direct. One
 * a scene before mounted stays when the current layer list declares its layers alike, and takes
 * its place in this list; one whose layer is declared otherwise is unmounted and mounted again.
 * One mounted into this scene already is reported and changes nothing. Nothing is mounted when
 * the call throws.
 *
 * @param pctx - Domain context of the projection module.
 * @param names - Names of the projections to mount.
 * @param owner - Who owns the entities of the new ones.
 * @throws {Error} For an unknown name, or a `layer` or `lift` the scene does not declare.
 */
export function mountNames(pctx: ProjectionCtx, names: readonly string[], owner: Owner): void {
  const { fresh, again } = sortMount(pctx, names, pctx.ctx.state.projection.layers);

  unmountNames(pctx, again);
  placeNames(pctx, names, owner);
  reconcileFresh(
    pctx,
    fresh.map(spec => spec.name)
  );
}

/**
 * Gives every projection of a list its place under the current layer list: a missing one gets an
 * empty record at the `Order` of its place, a kept one mounted under another list takes its new
 * place (`placeMounted`). A screen root draws at its place in the list (spec 16 U1.6).
 *
 * @param pctx - Domain context of the projection module.
 * @param names - The projection list of the scene.
 * @param owner - Who owns the entities of a missing one.
 */
export function placeNames(pctx: ProjectionCtx, names: readonly string[], owner: Owner): void {
  const state = pctx.ctx.state.projection;

  for (const name of names) {
    const order = orderIn(names, name);
    const mounted = state.mounted.get(name);

    if (mounted === undefined) state.mounted.set(name, emptyMounted(owner, order, state.layers));
    else if (mounted.layers !== state.layers) placeMounted(pctx, mounted, order);
  }
}

/**
 * Reconciles freshly placed projections at once, direct, as a mount does. Nothing runs for an
 * empty list.
 *
 * @param pctx - Domain context of the projection module.
 * @param names - The projections that came.
 */
export function reconcileFresh(pctx: ProjectionCtx, names: readonly string[]): void {
  if (names.length === 0) return;

  reconcile(pctx, { names, direct: true, force: true, converge: false, settle: false });
}
