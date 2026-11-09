/**
 * @file world/projection — the mute tables: the fields another writer owns on one entity. `mute()`
 * hands fields over for a while. A projection's `initialOnly` hands them over for the whole life of
 * each view it covers: a pair with a `when` covers only the views whose item answered true at their
 * birth. The answers of a birth make a mask, and the views with the same mask share one frozen
 * table, built the first time a view is born with it and kept in the spec's seed book. So a birth
 * makes no set and the driver's ask on every frame finds the fields as for a mute. A view keeps the
 * seed it was born with. A view a listener of its spawn muted already (`anim` in its
 * `onAdded(Frames)`) keeps that table, and the seed joins it in place, so the remover of that mute
 * still finds what it wrote.
 */
import type { Entity } from "../ecs/types";
import { forgetJoined } from "./driver";
import type {
  AnyInitialOnlyPair,
  AnyProjectionSpec,
  MuteTable,
  ProjectionCtx,
  ProjectionState,
  SeedBook,
  View
} from "./types";

/** The most pairs with a `when` one spec may list: one bit each of a 32-bit mask. */
const MOST_WHENS = 32;

/**
 * Tells a table `mute()` made apart from a shared `initialOnly` seed, which is frozen.
 *
 * @param table - A table of `state.mutes`.
 * @returns True when the table may be written.
 */
function isOwnTable(table: MuteTable): table is Map<string, ReadonlySet<string>> {
  return !Object.isFrozen(table);
}

/**
 * Tells a field set `mute()` made apart from a set of a shared `initialOnly` seed, which is frozen.
 *
 * @param fields - A field set of one table.
 * @returns True when the set may be written.
 */
function isOwnFields(fields: ReadonlySet<string>): fields is Set<string> {
  return !Object.isFrozen(fields);
}

/**
 * The table a mute may write: the entity's own one, a copy of the seed it was born with, or a new one.
 *
 * @param stored - The table the entity has now, if any.
 * @returns A writable table.
 */
function ownTable(stored: MuteTable | undefined): Map<string, ReadonlySet<string>> {
  if (stored === undefined) return new Map();

  return isOwnTable(stored) ? stored : new Map(stored);
}

/**
 * The field set a mute may write: the component's own one, a copy of its seed set, or a new one.
 *
 * @param stored - The field set the component has now, if any.
 * @returns A writable set.
 */
function ownFields(stored: ReadonlySet<string> | undefined): Set<string> {
  if (stored === undefined) return new Set();

  return isOwnFields(stored) ? stored : new Set(stored);
}

/**
 * The `initialOnly` fields of one component of a view, from the seed the view was born with.
 *
 * @param state - The projection branch of the plugin state.
 * @param entity - The entity of the view.
 * @param name - The component name.
 * @returns The seed set, or `undefined` for an entity that is no view, or one no pair covers.
 */
function initialFieldsOf(
  state: ProjectionState,
  entity: Entity,
  name: string
): ReadonlySet<string> | undefined {
  return state.byEntity.get(entity)?.seed?.get(name);
}

/**
 * Deletes a released field set once it is empty, and the entity's table once no component is
 * left. Only the table and the set this mute filled are touched, so a remover that runs after a
 * clear or a new birth on the same id never drops a newer mute.
 *
 * @param mutes - The mute tables of every entity.
 * @param entity - The muted entity.
 * @param table - The table the mute wrote.
 * @param name - The muted component's name.
 * @param owned - The field set the remover released from.
 */
function dropEmptyMute(
  mutes: Map<Entity, MuteTable>,
  entity: Entity,
  table: Map<string, ReadonlySet<string>>,
  name: string,
  owned: Set<string>
): void {
  if (owned.size > 0 || mutes.get(entity) !== table || table.get(name) !== owned) return;

  table.delete(name);
  if (table.size === 0) mutes.delete(entity);
}

/**
 * Hands fields of one component of one entity to another writer, until the remover runs. A view
 * born with an `initialOnly` seed gets its own copy first. The remover keeps the fields of the
 * view's seed, asked when it runs: a mute made inside the spawn came before the view was known.
 *
 * @param state - The projection branch of the plugin state.
 * @param entity - The entity.
 * @param name - The component name.
 * @param fields - The field names the caller owns.
 * @returns The remover; a no-op when called twice.
 */
export function muteFields(
  state: ProjectionState,
  entity: Entity,
  name: string,
  fields: readonly string[]
): () => void {
  const table = ownTable(state.mutes.get(entity));
  const owned = ownFields(table.get(name));

  for (const field of fields) owned.add(field);
  forgetJoined(state, owned);
  table.set(name, owned);
  state.mutes.set(entity, table);

  let released = false;

  return (): void => {
    if (released) return;

    released = true;

    // The view's own `initialOnly` fields stay muted when this mute is released.
    const kept = initialFieldsOf(state, entity, name);

    for (const field of fields) {
      if (kept?.has(field) !== true) owned.delete(field);
    }

    forgetJoined(state, owned);
    dropEmptyMute(state.mutes, entity, table, name, owned);
  };
}

/**
 * Checks one pair of a spec's `initialOnly` list.
 *
 * @param spec - The projection spec.
 * @param pair - The pair.
 * @throws {Error} For a pair with no field, and for a third element that is no function.
 */
function checkPair(spec: AnyProjectionSpec, pair: AnyInitialOnlyPair): void {
  const [component, fields, when] = pair;
  const name = component.componentName;

  if (fields.length === 0) {
    throw new Error(
      `[game] Projection "${spec.name}" lists ${name} in initialOnly with no field.\n` +
        "  Name the fields only the birth of a view writes, or drop the pair."
    );
  }

  if (pair.length > 2 && typeof when !== "function") {
    throw new Error(
      `[game] Projection "${spec.name}" lists ${name} in initialOnly with a "when" that is no function.\n` +
        "  Give a function of the item, or drop the third element."
    );
  }
}

/**
 * The indices of the pairs with a `when`, in order.
 *
 * @param spec - The projection spec.
 * @param pairs - Its checked `initialOnly` list.
 * @returns The indices.
 * @throws {Error} For more pairs with a `when` than a mask holds.
 */
function asksOf(spec: AnyProjectionSpec, pairs: readonly AnyInitialOnlyPair[]): number[] {
  const asks: number[] = [];

  for (const [index, pair] of pairs.entries()) {
    if (pair[2] !== undefined) asks.push(index);
  }

  if (asks.length > MOST_WHENS) {
    throw new Error(
      `[game] Projection "${spec.name}" lists ${asks.length} initialOnly pairs with a "when".\n` +
        `  Join pairs that ask the same, to ${MOST_WHENS} at most.`
    );
  }

  return asks;
}

/**
 * Builds the frozen seed of one answer mask: component name to its fields, from the pairs without
 * a `when` and the pairs whose bit is set, a component named twice with both lists joined.
 *
 * @param book - The seed book of the spec.
 * @param mask - The answers, bit i for the i-th pair with a `when`.
 * @returns The seed, or `undefined` when the mask covers no pair.
 */
function buildSeed(book: SeedBook, mask: number): MuteTable | undefined {
  const seed = new Map<string, ReadonlySet<string>>();
  let bit = 0;

  for (const [component, fields, when] of book.pairs) {
    if (when !== undefined) {
      const covered = (mask & (1 << bit)) !== 0;

      bit += 1;

      if (!covered) continue;
    }

    const name = component.componentName;

    seed.set(name, Object.freeze(new Set([...(seed.get(name) ?? []), ...fields])));
  }

  return seed.size === 0 ? undefined : Object.freeze(seed);
}

/**
 * The seed of one answer mask, built the first time a view is born with it, then the same table.
 *
 * @param book - The seed book of the spec.
 * @param mask - The answers.
 * @returns The shared seed, or `undefined` for a mask that covers no pair.
 */
function seedFor(book: SeedBook, mask: number): MuteTable | undefined {
  if (book.seeds.has(mask)) return book.seeds.get(mask);

  const seed = buildSeed(book, mask);

  book.seeds.set(mask, seed);

  return seed;
}

/**
 * Creates the empty seed table of a book. It lives in its own non-exported function because lint
 * rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty table of mask to seed.
 */
function emptySeeds(): Map<number, MuteTable | undefined> {
  return new Map();
}

/**
 * Checks the `initialOnly` list of a spec and makes its seed book, keeping nothing. A spec whose
 * pairs have no `when` gets the one seed of mask 0 now, as before.
 *
 * @param spec - The spec `register` or `replace` stores.
 * @returns The book, or `undefined` for a spec without the option or with an empty list.
 * @throws {Error} For a pair with no field, a `when` that is no function, or too many `when`s.
 */
function checkBook(spec: AnyProjectionSpec): SeedBook | undefined {
  const pairs = spec.initialOnly;

  if (pairs === undefined || pairs.length === 0) return undefined;

  for (const pair of pairs) checkPair(spec, pair);

  const book: SeedBook = { pairs, asks: asksOf(spec, pairs), seeds: emptySeeds() };

  if (book.asks.length === 0) seedFor(book, 0);

  return book;
}

/**
 * Checks the `initialOnly` list of a spec and keeps its seed book: once per spec, since a name is
 * registered once and `replace` brings a new spec.
 *
 * @param state - The projection branch of the plugin state.
 * @param spec - The spec `register` stores.
 * @throws {Error} For a pair with no field, a `when` that is no function, or too many `when`s;
 *   nothing is kept then.
 */
export function learnSeed(state: ProjectionState, spec: AnyProjectionSpec): void {
  const book = checkBook(spec);

  if (book !== undefined) state.initialOnly.set(spec, book);
}

/**
 * Asks the `when`s of a book on one item.
 *
 * @param book - The seed book of the spec.
 * @param item - The item.
 * @returns The answers, bit i set when the i-th `when` answers true.
 * @throws {Error} What a `when` throws.
 */
function maskOf(book: SeedBook, item: unknown): number {
  const { asks, pairs } = book;
  const count = asks.length;
  let mask = 0;

  // Per birth: an index loop, no iterator.
  for (let bit = 0; bit < count; bit += 1) {
    const when = pairs[asks[bit] ?? 0]?.[2];

    if (when?.(item) === true) mask |= 1 << bit;
  }

  return mask;
}

/**
 * The answers a view is born with: the `when`s of its projection asked on the item it is born
 * with. Asked before the spawn, so a `when` that throws spawns nothing, as a `view` that throws.
 *
 * @param state - The projection branch of the plugin state.
 * @param spec - The projection spec.
 * @param item - The item of the birth: the model item, or the warm item for a warm build.
 * @returns The mask; 0 for a spec without a `when`.
 * @throws {Error} What a `when` throws.
 */
export function birthMask(state: ProjectionState, spec: AnyProjectionSpec, item: unknown): number {
  if (spec.initialOnly === undefined) return 0;

  const book = state.initialOnly.get(spec);

  return book === undefined || book.asks.length === 0 ? 0 : maskOf(book, item);
}

/**
 * Joins a seed into a table of the entity's own, in place, so the remover of every mute that wrote
 * the table still holds its table and its sets: a component the table lacks gets the shared set
 * of the seed, the set a mute wrote gets the fields of the seed.
 *
 * @param state - The projection branch of the plugin state.
 * @param table - The entity's own table.
 * @param seed - The seed to join.
 */
function joinSeed(
  state: ProjectionState,
  table: Map<string, ReadonlySet<string>>,
  seed: MuteTable
): void {
  for (const [name, fields] of seed) {
    const stored = table.get(name);

    if (stored === undefined) {
      table.set(name, fields);

      continue;
    }

    const owned = ownFields(stored);

    for (const field of fields) owned.add(field);
    forgetJoined(state, owned);
    table.set(name, owned);
  }
}

/**
 * Gives a view that was just born the seed of its answers (`view.mask`), so from now on nothing of
 * the projection writes or compares those fields. The birth itself wrote them from `view`. The
 * view keeps the seed. A view a listener of its spawn muted already keeps its table, and the seed
 * joins it.
 *
 * @param state - The projection branch of the plugin state.
 * @param spec - The projection spec.
 * @param view - The new view, its mask set.
 */
export function seedMutes(state: ProjectionState, spec: AnyProjectionSpec, view: View): void {
  if (spec.initialOnly === undefined) return;

  const book = state.initialOnly.get(spec);
  const seed = book === undefined ? undefined : seedFor(book, view.mask);

  if (seed === undefined) return;

  view.seed = seed;

  const stored = state.mutes.get(view.entity);

  if (stored === undefined) {
    state.mutes.set(view.entity, seed);

    return;
  }

  const table = ownTable(stored);

  joinSeed(state, table, seed);
  state.mutes.set(view.entity, table);
}

/**
 * The dev check after a view took a new item: when the `when`s of its projection answer otherwise
 * on it than at the birth, `world:initial-only-changed` is warned, once per view. Nothing changes
 * in the view. A release build asks nothing: the guard is inline, so a `define` of `false` folds
 * it. A `when` that throws here warns nothing: the reconcile of a dev build stops nowhere a release
 * build goes on.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param view - The view, its item the new one.
 */
export function checkDrift(pctx: ProjectionCtx, spec: AnyProjectionSpec, view: View): void {
  if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) return;
  if (view.maskWarned || spec.initialOnly === undefined) return;

  const book = pctx.ctx.state.projection.initialOnly.get(spec);

  if (book === undefined || book.asks.length === 0) return;

  let mask: number;

  try {
    mask = maskOf(book, view.item);
  } catch {
    return;
  }

  if (mask === view.mask) return;

  view.maskWarned = true;
  pctx.ctx.log.warn("world:initial-only-changed", { projection: spec.name, key: view.key });
}

/**
 * Moves a view with a table of its own from one seed to the next: a set of the old seed goes, the
 * new seed joins. A set a mute wrote keeps every field it holds, an old seed's field it copied too,
 * since the table does not say which mute named it. A table left empty goes.
 *
 * @param state - The projection branch of the plugin state.
 * @param entity - The entity of the view.
 * @param stored - The table the view has now, if any.
 * @param from - The seed the view held, if any.
 * @param to - The seed of the new spec, if any.
 */
function reseedOwn(
  state: ProjectionState,
  entity: Entity,
  stored: MuteTable | undefined,
  from: MuteTable | undefined,
  to: MuteTable | undefined
): void {
  const table = ownTable(stored);

  for (const [name, fields] of from ?? []) {
    if (table.get(name) === fields) table.delete(name);
  }

  if (to !== undefined) joinSeed(state, table, to);

  if (table.size === 0) state.mutes.delete(entity);
  else state.mutes.set(entity, table);
}

/**
 * Moves one view from the seed it holds to a new one. A view that holds its seed, or none, takes
 * the new seed. A view a `mute()` gave its own table keeps it: the sets of the old seed in it go,
 * the new seed joins it.
 *
 * @param state - The projection branch of the plugin state.
 * @param view - The view.
 * @param to - The new seed, if any.
 */
function reseedView(state: ProjectionState, view: View, to: MuteTable | undefined): void {
  const from = view.seed;

  view.seed = to;

  if (from === to) return;

  const stored = state.mutes.get(view.entity);

  if (stored !== from) reseedOwn(state, view.entity, stored, from, to);
  else if (to === undefined) state.mutes.delete(view.entity);
  else state.mutes.set(view.entity, to);
}

/**
 * The views of one projection, in the order of `byEntity`.
 *
 * @param state - The projection branch of the plugin state.
 * @param name - The projection name.
 * @returns A new list.
 */
function viewsOf(state: ProjectionState, name: string): View[] {
  const views: View[] = [];

  for (const view of state.byEntity.values()) {
    if (view.projection === name) views.push(view);
  }

  return views;
}

/**
 * Replaces the `initialOnly` of a registered projection: checks the new spec, asks its `when`s on
 * the item every view of the projection shows now, then keeps its seed book and moves each view
 * from the seed it holds to the seed of its new answers. Every mask is asked before anything
 * moves, so a `when` that throws leaves the state as it was.
 *
 * @param state - The projection branch of the plugin state.
 * @param spec - The new spec, not yet stored.
 * @throws {Error} For a spec `learnSeed` refuses, and what a `when` throws; nothing moves then.
 */
export function replaceSeed(state: ProjectionState, spec: AnyProjectionSpec): void {
  const book = checkBook(spec);
  const views = viewsOf(state, spec.name);
  const masks = views.map(view =>
    book === undefined || book.asks.length === 0 ? 0 : maskOf(book, view.item)
  );

  if (book !== undefined) state.initialOnly.set(spec, book);

  for (const [index, view] of views.entries()) {
    const mask = masks[index] ?? 0;

    view.mask = mask;
    reseedView(state, view, book === undefined ? undefined : seedFor(book, mask));
  }
}
