/**
 * @file renderer/sync — API factory. One pass owns every display object: nothing else in the
 * engine creates, moves, sorts or destroys a Pixi node.
 */
import { Layer, Order } from "../../world/ecs/define";
import type { ComponentHandle, Entity } from "../../world/types";
import { Display, NineSlice, Parent, Shape, Sprite, Transform } from "../components";
import type { Unseen } from "../demand/types";
import type { PixiContainer, PixiFilter, PixiTexture, RendererCtx, SyncModule } from "../types";
import { provideDisplay, updateAdapterView } from "./adapters";
import { boundsOf, hitBoxOf, layerOf } from "./bounds";
import { eachEntity, isEmptyList } from "./each";
import { forgetLeft, renderPassesOf, setArea, setFilters } from "./filters";
import { installFont, isFontInstalled } from "./fonts";
import { clearHidden } from "./hidden";
import { hitAll, hitTest } from "./hit-test";
import { clearLayers, layerContainer, resort, syncLayers } from "./layers";
import { drawOverdraw } from "./overdraw";
import {
  drainOverlayEvents,
  loopsHeld,
  overlayReports,
  stepOverlays,
  watchOverlays
} from "./overlay";
import { forgetOverlays } from "./overlay-state";
import { destroyPools, detach, dropPooled } from "./pools";
import { parentOf } from "./pose";
import { createSyncSystem } from "./system";
import { clearFrames, createTexture, destroyTexture, sliceTexture } from "./textures";
import { checkTree } from "./tree-check";
import type {
  CreateTextureOptions,
  DebugSwitches,
  DisplayAdapter,
  DisplayEntry,
  FilterSlot,
  HitBox,
  OverlayEventSink,
  OverlayReport,
  SliceFrame,
  SyncCounts,
  SyncCtx,
  SyncDeps,
  TextureProvider,
  View,
  WarmListener
} from "./types";
import {
  applyNineSlice,
  applyShape,
  applySprite,
  applyTransform,
  attach,
  createView,
  dropView,
  wrapForPicture,
  writeVisual
} from "./views";
import { startWarm, warmFilter, warmStep } from "./warm";

/** Label of the container the viewport transform is written on. */
const ROOT_LABEL = "renderer.root";

/** The change steps of a pass that write an entity's view: what `runStep` does for each changed component. */
const STEP = {
  transform: 0,
  sprite: 1,
  nineSlice: 2,
  shape: 3,
  order: 4,
  layer: 5,
  parent: 6,
  adapter: 7
} as const;

/**
 * The mark of the quiet context: a write the kept cache makes for its picture changes no pixel and marks nothing.
 */
function noMark(): void {
  // Nothing to judge: the frame draws the same pixels.
}

/**
 * Copies a change set, so a pass can clear it and still know what it took. It lives in its own
 * non-exported function because lint rule L5 refuses a collection built inside an exported
 * declaration.
 *
 * @param entities - The change set of the frame.
 * @returns A copy of it.
 */
function copyOf(entities: ReadonlySet<Entity>): Set<Entity> {
  return new Set(entities);
}

/**
 * A fresh entity set, made in a function so the module-scope rule sees no collection literal.
 *
 * @returns An empty set.
 */
function emptyEntitySet(): Set<Entity> {
  return new Set();
}

/**
 * Where the walk of `shown` stopped for an entity's view, walked once between two sync passes: an entity with several
 * endless loops asks once a frame (spec 26 R1.7.3). Nothing is allocated once the map has grown.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity a loop is about to write.
 * @returns Where the walk stopped; `"other"` while inert and for an entity without a view.
 */
function unseenOf(sctx: SyncCtx, entity: Entity): Unseen {
  const state = sctx.ctx.state.sync;

  if (state.root === undefined || !state.views.has(entity)) return "other";

  const known = state.held.get(entity);

  if (known !== undefined) return known;

  const answer = sctx.deps.demand.unseenBy(entity);

  state.held.set(entity, answer);

  return answer;
}

/**
 * The unseen cases of `loopsHeld` (spec 26 R1.7.1), asked after the overlay cases answered false: a view under a view
 * at alpha 0 always holds; the view's own alpha 0 holds unless the loop writes its alpha; a leaf off the screen holds
 * unless the loop writes its place. Every other stop holds nothing: an empty shape's own loop may be what fills it,
 * and a kept view is still shown through its quad.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity a loop is about to write.
 * @param reveals - What the loop writes that could show the view again.
 * @returns True when the write would change nothing the player can see.
 */
function unseenHolds(
  sctx: SyncCtx,
  entity: Entity,
  reveals: "alpha" | "place" | "both" | undefined
): boolean {
  const unseen = unseenOf(sctx, entity);

  if (unseen === "alpha-above") return true;
  if (unseen === "alpha-own") return reveals !== "alpha" && reveals !== "both";
  if (unseen === "off-screen") return reveals !== "place" && reveals !== "both";

  return false;
}

/**
 * Creates the sync module: the world hooks, the one system, the texture registry and the hit
 * test.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The injected `host`, `viewport` and `demand` modules.
 * @returns The sync API and its internal half.
 */
export function createSyncApi(ctx: RendererCtx, deps: SyncDeps): SyncModule {
  const sctx: SyncCtx = { ctx, deps };
  // The kept cache's own writes draw the same pixels, so they mark nothing (spec 23 D4, as OQ23-7 for "kept").
  const quiet: SyncCtx = {
    ctx,
    deps: { ...deps, demand: { ...deps.demand, mark: noMark, markMoved: noMark } }
  };
  const state = ctx.state.sync;
  // What a pass with nothing to build hands its change steps: made once, so a still frame builds no set.
  const nothingBuilt: ReadonlySet<Entity> = emptyEntitySet();

  /** The entities the running pass built: its change steps skip them. Set by every pass that does work. */
  let built: ReadonlySet<Entity> = nothingBuilt;
  /** The adapter registration whose component the adapter step walks now. */
  let adapterEntry: DisplayEntry | undefined;

  /**
   * Logs the throw of one entity's work: it costs that entity, never the frame.
   *
   * @param entity - The entity being worked on.
   * @param error - What it threw.
   */
  const report = (entity: Entity, error: unknown): void => {
    ctx.log.error("renderer: sync failed for an entity", {
      entity,
      label: state.views.get(entity)?.object.label,
      error
    });
  };

  /**
   * Runs one piece of work for one entity. A throw costs that entity, never the frame.
   *
   * @param entity - The entity being worked on.
   * @param work - What to do.
   */
  const guard = (entity: Entity, work: () => void): void => {
    try {
      work();
    } catch (error) {
      report(entity, error);
    }
  };

  /**
   * Runs work on the view of an entity, when it has one.
   *
   * @param entity - The entity.
   * @param work - What to do with its view.
   */
  const withView = (entity: Entity, work: (view: View) => void): void => {
    const view = state.views.get(entity);

    if (view === undefined) return;

    guard(entity, () => work(view));
  };

  /**
   * Marks an entity whose view has to be built in the next pass. Nothing is collected while the
   * renderer draws nothing, so an inert run keeps its change sets empty.
   *
   * @param entity - The entity a watched component appeared on.
   */
  const markAdded = (entity: Entity): void => {
    if (state.root === undefined) return;

    state.added.add(entity);
  };

  /**
   * Marks an entity whose view has to go in the next pass.
   *
   * @param entity - The entity a watched component left.
   */
  const markRemoved = (entity: Entity): void => {
    if (state.root === undefined) return;

    state.removed.add(entity);
  };

  /**
   * Marks an entity whose `Parent` was removed. `world` records no change for a removed
   * component, so without this the view would stay in the old parent's wrapper.
   *
   * @param entity - The entity that lost its parent.
   */
  const markReparented = (entity: Entity): void => {
    if (state.root === undefined) return;

    state.reparented.add(entity);
  };

  /**
   * Hangs a view again where it belongs now, under its parent or in its layer, at its own pose, sorted by the rule
   * of the place it hangs in.
   *
   * @param entity - The entity.
   * @param view - Its view.
   */
  const rehang = (entity: Entity, view: View): void => {
    attach(sctx, entity, view);
    applyTransform(sctx, entity, view);
    resort(sctx, entity, view);
  };

  /**
   * Writes what one changed component asks of an entity's view (step 4).
   *
   * @param step - The change step, a `STEP` value.
   * @param entity - The entity.
   * @param view - Its view.
   */
  const runStep = (step: number, entity: Entity, view: View): void => {
    switch (step) {
      case STEP.transform: {
        // Placement: a moved entity gets a new transform and may sort differently.
        applyTransform(sctx, entity, view);
        resort(sctx, entity, view);
        break;
      }
      case STEP.sprite: {
        // Look: a new size or fit changes the stretch the transform folds into the scale.
        if (applySprite(sctx, entity, view)) applyTransform(sctx, entity, view);
        break;
      }
      case STEP.nineSlice: {
        applyNineSlice(sctx, entity, view);
        break;
      }
      case STEP.shape: {
        applyShape(sctx, entity, view);
        break;
      }
      case STEP.order: {
        // Draw order: only the position among the siblings changed.
        resort(sctx, entity, view);
        break;
      }
      case STEP.layer: {
        // Tree position: the view moves to another layer and is sorted there.
        attach(sctx, entity, view);
        resort(sctx, entity, view);
        break;
      }
      case STEP.parent: {
        rehang(entity, view);
        break;
      }
      default: {
        if (view.display === adapterEntry) updateAdapterView(sctx, entity, view);
      }
    }
  };

  /**
   * Runs one change step on one entity's view, its throw costing that entity only: the try is here, once, not in the
   * walk of the change list.
   *
   * @param step - The change step, a `STEP` value.
   * @param entity - The entity.
   * @param view - Its view.
   */
  const guardedStep = (step: number, entity: Entity, view: View): void => {
    try {
      runStep(step, entity, view);
    } catch (error) {
      report(entity, error);
    }
  };

  /**
   * Runs one change step on an entity's view, unless the entity has none or this pass built it a moment ago.
   *
   * @param step - The change step, a `STEP` value.
   * @param entity - The entity.
   */
  const stepOn = (step: number, entity: Entity): void => {
    if (built.has(entity)) return;

    const view = state.views.get(entity);

    if (view !== undefined) guardedStep(step, entity, view);
  };

  // The visitors of the change lists, made once: a pass walks the lists with them and makes no closure.
  const onTransform = (entity: Entity): void => stepOn(STEP.transform, entity);
  const onSprite = (entity: Entity): void => stepOn(STEP.sprite, entity);
  const onNineSlice = (entity: Entity): void => stepOn(STEP.nineSlice, entity);
  const onShape = (entity: Entity): void => stepOn(STEP.shape, entity);
  const onOrder = (entity: Entity): void => stepOn(STEP.order, entity);
  const onLayer = (entity: Entity): void => stepOn(STEP.layer, entity);
  const onParent = (entity: Entity): void => stepOn(STEP.parent, entity);
  const onAdapter = (entity: Entity): void => stepOn(STEP.adapter, entity);

  /**
   * A new `Display` object of the game replaces the old view outright, unless this pass built it.
   *
   * @param entity - The entity.
   */
  const onDisplay = (entity: Entity): void => {
    if (built.has(entity)) return;

    guard(entity, () => {
      dropView(sctx, entity);
      createView(sctx, entity);
    });
  };

  /**
   * Step 4 for the views whose `Parent` was removed: back to the layer the entity names, at its
   * own pose, sorted by that layer's rule. An entity that left has no view and is skipped, and one
   * this pass built hangs in the right place already.
   */
  const applyReparented = (): void => {
    if (state.reparented.size === 0) return;

    const entities = copyOf(state.reparented);

    state.reparented.clear();
    eachEntity(entities, onParent);
  };

  /**
   * Step 4 for the orphans (spec 16 U2.4): every view that waits for its parent's view is hung once the parent has one,
   * placed and sorted there, in the pass that built the parent. A view that lost its `Parent` meanwhile goes to its
   * layer. One whose parent still has no view is left alone: nothing is written, so no frame is asked for.
   *
   * @param touched - The entities the tree check reads, in a dev or agent build: the hung ones join it.
   */
  const attachOrphans = (touched: Set<Entity> | undefined): void => {
    if (state.orphans.size === 0) return;

    const ecs = ctx.deps.world.ecs;

    for (const entity of copyOf(state.orphans)) {
      const parent = parentOf(ecs, entity);

      if (!state.views.has(entity)) state.orphans.delete(entity);
      else if (parent === 0 || state.views.has(parent)) {
        withView(entity, view => rehang(entity, view));
        touched?.add(entity);
      }
    }
  };

  /**
   * The entities the tree check of this pass reads: the ones it built and the ones it hangs again (a new `Parent` or
   * `Layer`, a `Parent` that left, an orphan whose parent came). Read before the change steps clear the set of the views
   * that lost their `Parent`.
   *
   * @returns A new set, which the orphan step adds to; `undefined` when none of them changed, and no set is made.
   */
  const touchedBy = (): Set<Entity> | undefined => {
    const ecs = ctx.deps.world.ecs;
    const parents = ecs.changed(Parent);
    const layers = ecs.changed(Layer);

    if (
      built.size === 0 &&
      state.reparented.size === 0 &&
      state.orphans.size === 0 &&
      isEmptyList(parents) &&
      isEmptyList(layers)
    ) {
      return undefined;
    }

    const touched = copyOf(built);

    for (const entity of parents) touched.add(entity);
    for (const entity of layers) touched.add(entity);
    for (const entity of state.reparented) touched.add(entity);

    return touched;
  };

  /**
   * Step 4 for the components a plugin above draws its own way: one `update` per changed value, an entity this pass
   * built left out (its adapter wrote it already).
   */
  const applyAdapterChanges = (): void => {
    const ecs = ctx.deps.world.ecs;

    for (let index = 0; index < state.adapters.length; index += 1) {
      adapterEntry = state.adapters[index];

      if (adapterEntry !== undefined) eachEntity(ecs.changed(adapterEntry.component), onAdapter);
    }

    adapterEntry = undefined;
  };

  /**
   * Step 4: only the entities the frame really changed, each list walked once with its visitor. An entity this pass
   * built carries every value already and is left out.
   */
  const applyChanges = (): void => {
    const ecs = ctx.deps.world.ecs;

    eachEntity(ecs.changed(Transform), onTransform);
    eachEntity(ecs.changed(Sprite), onSprite);
    eachEntity(ecs.changed(NineSlice), onNineSlice);
    eachEntity(ecs.changed(Shape), onShape);
    eachEntity(ecs.changed(Order), onOrder);
    eachEntity(ecs.changed(Layer), onLayer);
    eachEntity(ecs.changed(Parent), onParent);
    eachEntity(ecs.changed(Display), onDisplay);
  };

  /**
   * Tells whether the pass has nothing to do: nothing waits to be built, dropped, hung or resolved again, the layer list
   * is the one built, and no watched component of any entity changed. A still frame returns on this, before any work.
   *
   * @returns True when the pass would change nothing.
   */
  const still = (): boolean => {
    if (
      state.removed.size > 0 ||
      state.added.size > 0 ||
      state.reparented.size > 0 ||
      state.orphans.size > 0 ||
      state.invalidated.size > 0 ||
      state.viewlessEntries ||
      state.outlinesStale ||
      ctx.deps.world.projection.layers() !== state.layerList
    ) {
      return false;
    }

    const ecs = ctx.deps.world.ecs;

    if (
      !isEmptyList(ecs.changed(Transform)) ||
      !isEmptyList(ecs.changed(Sprite)) ||
      !isEmptyList(ecs.changed(NineSlice)) ||
      !isEmptyList(ecs.changed(Shape)) ||
      !isEmptyList(ecs.changed(Order)) ||
      !isEmptyList(ecs.changed(Layer)) ||
      !isEmptyList(ecs.changed(Parent)) ||
      !isEmptyList(ecs.changed(Display))
    ) {
      return false;
    }

    for (let index = 0; index < state.adapters.length; index += 1) {
      const entry = state.adapters[index];

      if (entry !== undefined && !isEmptyList(ecs.changed(entry.component))) return false;
    }

    return true;
  };

  /**
   * Step 5: the keys `textures.invalidate` marked resolve again, once.
   */
  const applyInvalidated = (): void => {
    if (state.invalidated.size === 0) return;

    const keys = [...state.invalidated];

    state.invalidated.clear();

    for (const key of keys) {
      state.warned.delete(key);

      for (const entity of state.byKey.get(key) ?? []) {
        withView(entity, view => {
          // Structural: the key resolved again, a bundle came or went, or a hot swap.
          deps.demand.mark(entity);
          writeVisual(sctx, entity, view);
          applyTransform(sctx, entity, view);
        });
      }
    }
  };

  /**
   * The nine-slice switch moved: every nine-slice is written again, so its outline follows.
   */
  const applyOutlines = (): void => {
    if (!state.outlinesStale) return;

    state.outlinesStale = false;
    deps.demand.whole("debug");

    for (const [entity, view] of state.views) {
      if (view.kind === "NineSlice") guard(entity, () => applyNineSlice(sctx, entity, view));
    }
  };

  /**
   * Takes the entities that are waiting to be built out of the change set. Called only when one waits.
   *
   * @returns The entities of this pass, so the change step skips what the build just wrote.
   */
  const takeAdded = (): Set<Entity> => {
    const built = copyOf(state.added);

    state.added.clear();

    return built;
  };

  /**
   * Builds the views of a waiting set, each parent before its child when the parent waits in the
   * same set (spec 16 U2.3): a child built first finds no parent view and is detached for good.
   * An entity leaves the set before its parent is built, so a cycle of parents ends.
   *
   * @param waiting - The entities to build; emptied as they are built.
   * @returns The entities a view was built for now.
   */
  const buildParentFirst = (waiting: Set<Entity>): ReadonlySet<Entity> => {
    const built = emptyEntitySet();
    const ecs = ctx.deps.world.ecs;

    /**
     * Builds one waiting entity, its waiting parent first.
     *
     * @param entity - The entity.
     */
    const build = (entity: Entity): void => {
      if (!waiting.delete(entity)) return;

      const parent = parentOf(ecs, entity);

      if (parent !== 0 && waiting.has(parent)) build(parent);

      guard(entity, () => {
        if (createView(sctx, entity)) built.add(entity);
      });
    };

    for (const entity of copyOf(waiting)) build(entity);

    return built;
  };

  /**
   * Forgets the filter and area entries of the entities without a view that despawned: a visual that left in an earlier
   * pass, or entries set before any view. Such an entity has no view to remove any more, so no despawned entity keeps
   * an entry.
   *
   * @returns True while a live entity without a view still holds an entry: the next pass looks again.
   */
  const forgetDespawned = (): boolean => {
    const ecs = ctx.deps.world.ecs;
    let viewless = false;

    for (const entity of state.filters.keys()) {
      if (state.views.has(entity)) continue;

      forgetLeft(state, ecs, entity);
      viewless ||= state.filters.has(entity);
    }

    for (const entity of state.areas.keys()) {
      if (state.views.has(entity)) continue;

      forgetLeft(state, ecs, entity);
      viewless ||= state.areas.has(entity);
    }

    return viewless;
  };

  /**
   * One pass: removed, layers, added, changed, orphans, invalidated. A despawned entity takes its filter
   * slots with it, also when its view left in an earlier pass; a live one keeps them for its next
   * view. A still frame (nothing changed, nothing waits) returns before any work and makes nothing.
   */
  const pass = (): void => {
    // The pass may change the tree: the unseen walks of the loops are taken again in the next frame. Cleared only when
    // it holds something: V8 gives an empty map a new table at every `clear()`, and the pass runs every frame.
    if (state.held.size > 0) state.held.clear();

    // per frame: a still frame stops here, with no set, no closure and no iterator made.
    if (still()) return;

    // A pass that works may hang, wrap or drop views: the render passes are counted again (Q2).
    state.passesVersion += 1;

    if (state.removed.size > 0) {
      for (const entity of state.removed) {
        guard(entity, () => dropView(sctx, entity));
        forgetLeft(state, ctx.deps.world.ecs, entity);
      }

      state.removed.clear();
    }

    if (state.viewlessEntries) state.viewlessEntries = forgetDespawned();

    // A new layer list is the renderer's own signal of a scene switch: the frame is drawn, the pool trimmed later.
    if (syncLayers(sctx)) {
      deps.demand.whole("layers");
      deps.host.sceneChanged();
    }

    built = state.added.size === 0 ? nothingBuilt : buildParentFirst(takeAdded());
    // The tree check runs in a dev or an agent build only; the guard is inline so a release build drops it (U2.5).
    const touched =
      (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
      (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)
        ? touchedBy()
        : undefined;

    applyChanges();
    applyReparented();
    attachOrphans(touched);
    applyAdapterChanges();
    applyInvalidated();
    applyOutlines();
    // The built set goes with the pass.
    built = nothingBuilt;

    if (touched !== undefined) checkTree(sctx, touched);
  };

  /**
   * Forgets every view, layer and pooled object without touching Pixi. Used before a rebuild,
   * where the old application and everything in it are already gone.
   */
  const forgetTree = (): void => {
    // Every picture goes first: its textures belong to the application that goes (P15).
    deps.kept.reset();
    // The dims and the range go with the tree; the overlays are found again in the new one (spec 22 O5.6).
    forgetOverlays(state);
    state.held.clear();

    for (const view of state.views.values()) {
      state.viewOfTop.delete(view.wrapper ?? view.object);
      if (view.kind === "Display") detach(view.object);
      view.wrapper = undefined;
      view.outline = undefined;
      // A game's object outlives the application: it goes back drawn, for the view the rebuild gives it.
      if (view.kind === "Display") clearHidden(view);
    }

    state.views.clear();
    // The entries stay for the views the rebuild gives back; the pass looks for the ones it does not.
    if (state.filters.size > 0 || state.areas.size > 0) state.viewlessEntries = true;
    state.entityOf.clear();
    state.byKey.clear();
    // The rebuild hangs every view again, parent first: nothing waits for a parent of the old tree.
    state.orphans.clear();
    state.mismatched.clear();
    // The views that showed the crops are gone; the rebuild cuts them again for its own views.
    clearFrames(state);
    destroyPools(state);
    clearLayers(state);
    state.root = undefined;
    state.passesVersion += 1;
  };

  /**
   * Builds the root, the layers and a view for every entity that names a layer, then starts the
   * warm-up of the device (F4).
   */
  const rebuildAll = (): void => {
    forgetTree();

    const stage = deps.host.stage();
    const pixi = deps.host.pixi();

    if (stage === undefined || pixi === undefined) return;

    const root = new pixi.Container();

    root.label = ROOT_LABEL;
    stage.addChild(root);
    state.root = root;
    deps.viewport.apply(root);
    syncLayers(sctx);

    const waiting = emptyEntitySet();

    for (const [entity] of ctx.deps.world.ecs.query(Layer)) waiting.add(entity);
    buildParentFirst(waiting);

    state.added.clear();
    state.removed.clear();
    state.reparented.clear();
    // Every view was just written with the switch as it is now.
    state.outlinesStale = false;
    startWarm(sctx);
  };

  return {
    hitTest: (x: number, y: number, accept: (entity: Entity) => boolean): Entity | undefined =>
      hitTest(sctx, x, y, accept),

    hitAll: (x: number, y: number): readonly Entity[] => hitAll(sctx, x, y),

    boundsOf: (entity: Entity): HitBox | undefined => boundsOf(sctx, entity),

    hitBoxOf: (entity: Entity): HitBox | undefined => hitBoxOf(state, entity),

    displayOf: (entity: Entity): unknown | undefined => state.views.get(entity)?.object,

    wrapForPicture: (entity: Entity): PixiContainer | undefined => wrapForPicture(quiet, entity),

    textures: {
      provide: (fn: TextureProvider): (() => void) => {
        state.providers.push(fn);

        let removed = false;

        return (): void => {
          if (removed) return;

          removed = true;

          const at = state.providers.indexOf(fn);

          if (at !== -1) state.providers.splice(at, 1);
        };
      },

      create: (
        image: ImageBitmap | HTMLImageElement,
        options?: CreateTextureOptions
      ): PixiTexture => createTexture(sctx, image, options),

      slice: (page: PixiTexture, frame: SliceFrame, options?: CreateTextureOptions): PixiTexture =>
        sliceTexture(sctx, page, frame, options),

      destroy: (texture: PixiTexture): void => destroyTexture(state, texture),

      invalidate: (keys: readonly string[]): void => {
        if (state.root === undefined) return;

        for (const key of keys) state.invalidated.add(key);
        dropPooled(state, keys);
      }
    },

    displays: {
      provide: <Value extends object>(
        component: ComponentHandle<Value>,
        adapter: DisplayAdapter<Value>
      ): (() => void) =>
        provideDisplay(sctx, component, adapter, { added: markAdded, removed: markRemoved })
    },

    fonts: {
      install: (key: string, fnt: string, texture: PixiTexture): void =>
        installFont(sctx, key, fnt, texture),

      installed: (key: string): boolean => isFontInstalled(state, key)
    },

    debug: {
      nineSlice: (on: boolean): void => {
        if (state.debug.nineSlice === on) return;

        state.debug.nineSlice = on;
        state.outlinesStale = true;
      },

      verifyFrames: (on: boolean): void => deps.demand.verifyFrames(on),

      kept: (on: boolean): void => deps.kept.enabled(on),

      overdraw: (on: boolean): void => {
        // Inline and positive: a production `define` folds the guard, and the switch stays off.
        const next =
          on &&
          ((typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
            (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__));

        if (state.debug.overdraw === next) return;

        state.debug.overdraw = next;
        // Nothing in the tree changes: a frame is asked for, so the next one draws the map or the game again.
        deps.demand.request();

        if (
          (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
          (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)
        ) {
          ctx.log.info("renderer:overdraw", { on: next });

          for (const listener of state.overdraw.listeners) listener(next);
        }
      },

      overlays: (): readonly OverlayReport[] => overlayReports(sctx),

      state: (): DebugSwitches => ({
        ...state.debug,
        verifyFrames: deps.demand.verifying(),
        kept: deps.kept.isOn()
      })
    },

    filters: {
      set: (entity: Entity, slots: readonly FilterSlot[]): void =>
        setFilters(state, entity, slots, deps.demand.mark, deps.kept),

      area: (entity: Entity, area: readonly [number, number, number, number] | undefined): void =>
        setArea(sctx, entity, area),

      warm: (filter: PixiFilter): Promise<boolean> => warmFilter(sctx, filter)
    },

    renderPasses: (): number => renderPassesOf(state, ctx.state.kept),

    root: (): PixiContainer | undefined => state.root,

    layerContainer: (name: string): PixiContainer | undefined => layerContainer(state, name),

    layerOf: (entity: Entity): string | undefined => layerOf(sctx, entity),

    stepOverlays: (): void => stepOverlays(sctx),

    drainOverlayEvents: (monitor: OverlayEventSink): void => drainOverlayEvents(sctx, monitor),

    warmStep: (): boolean => warmStep(sctx),

    onWarm: (fn: WarmListener): void => {
      state.warm.listeners.push(fn);
    },

    overdrawing: (): boolean => state.debug.overdraw,

    drawOverdraw: (render: () => boolean): boolean => {
      // Inline and positive: a production `define` folds the guard, and `overdraw.ts` leaves the bundle.
      if (
        (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
        (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)
      ) {
        return drawOverdraw(sctx, render);
      }

      return render();
    },

    onOverdraw: (fn: (on: boolean) => void): void => {
      state.overdraw.listeners.push(fn);
    },

    loopsHeld: (entity: Entity, reveals?: "alpha" | "place" | "both"): boolean =>
      loopsHeld(sctx, entity) || unseenHolds(sctx, entity, reveals),

    takeRedraws: (): number => {
      const redraws = state.redraws;

      state.redraws = 0;

      return redraws;
    },

    counts: (): SyncCounts => ({
      views: state.views.size,
      pooled: state.pooled
    }),

    rebuildAll,

    pass,

    forget: forgetTree,

    start: (): void => {
      if (deps.host.stage() === undefined) return;

      const ecs = ctx.deps.world.ecs;

      state.cleanups.push(
        ecs.onAdded(Sprite, markAdded),
        ecs.onAdded(NineSlice, markAdded),
        ecs.onAdded(Shape, markAdded),
        ecs.onAdded(Display, markAdded),
        ecs.onRemoved(Sprite, markRemoved),
        ecs.onRemoved(NineSlice, markRemoved),
        ecs.onRemoved(Shape, markRemoved),
        ecs.onRemoved(Display, markRemoved),
        ecs.onRemoved(Parent, markReparented),
        ...watchOverlays(sctx),
        ecs.system(createSyncSystem(pass))
      );

      rebuildAll();
    }
  };
}
