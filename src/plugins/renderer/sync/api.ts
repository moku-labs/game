/**
 * @file renderer/sync — API factory. One pass owns every display object: nothing else in the
 * engine creates, moves, sorts or destroys a Pixi node.
 */
import { Layer, Order } from "../../world/ecs/define";
import type { ComponentHandle, Entity } from "../../world/types";
import { Display, NineSlice, Parent, Shape, Sprite, Transform } from "../components";
import type { Unseen } from "../demand/types";
import type { PixiContainer, PixiTexture, RendererCtx, SyncModule } from "../types";
import { provideDisplay, updateAdapterView } from "./adapters";
import { boundsOf, hitBoxOf, layerOf } from "./bounds";
import { forgetLeft, renderPassesOf, setFilters } from "./filters";
import { installFont, isFontInstalled } from "./fonts";
import { clearHidden } from "./hidden";
import { hitAll, hitTest } from "./hit-test";
import { clearLayers, layerContainer, resort, syncLayers } from "./layers";
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
import type {
  CreateTextureOptions,
  DebugSwitches,
  DisplayAdapter,
  FilterSlot,
  HitBox,
  OverlayEventSink,
  OverlayReport,
  SliceFrame,
  SyncCounts,
  SyncCtx,
  SyncDeps,
  TextureProvider,
  View
} from "./types";
import {
  applyNineSlice,
  applyShape,
  applySprite,
  applyTransform,
  attach,
  createView,
  dropView,
  writeVisual
} from "./views";

/** Label of the container the viewport transform is written on. */
const ROOT_LABEL = "renderer.root";

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
  const state = ctx.state.sync;

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
      ctx.log.error("renderer: sync failed for an entity", {
        entity,
        label: state.views.get(entity)?.object.label,
        error
      });
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
   * Step 4 for the views whose `Parent` was removed: back to the layer the entity names, at its
   * own pose, sorted by that layer's rule. An entity that left has no view and is skipped.
   *
   * @param built - The entities this pass has just built, which hang in the right place already.
   */
  const applyReparented = (built: ReadonlySet<Entity>): void => {
    if (state.reparented.size === 0) return;

    const entities = copyOf(state.reparented);

    state.reparented.clear();

    for (const entity of entities) {
      if (built.has(entity)) continue;

      withView(entity, view => {
        attach(sctx, entity, view);
        applyTransform(sctx, entity, view);
        resort(sctx, entity, view);
      });
    }
  };

  /**
   * Step 4 for the components a plugin above draws its own way: one `update` per changed value.
   *
   * @param built - The entities this pass has just built, whose adapter wrote them already.
   */
  const applyAdapterChanges = (built: ReadonlySet<Entity>): void => {
    const ecs = ctx.deps.world.ecs;

    for (const entry of state.adapters) {
      for (const entity of ecs.changed(entry.component)) {
        if (built.has(entity)) continue;

        withView(entity, view => {
          if (view.display === entry) updateAdapterView(sctx, entity, view);
        });
      }
    }
  };

  /**
   * Step 4: only the entities the frame really changed.
   *
   * @param built - The entities this pass has just built, which carry every value already.
   */
  const applyChanges = (built: ReadonlySet<Entity>): void => {
    const ecs = ctx.deps.world.ecs;

    /**
     * Runs work on the view of an entity, unless this pass built it a moment ago.
     *
     * @param entity - The entity.
     * @param work - What to do with its view.
     */
    const write = (entity: Entity, work: (view: View) => void): void => {
      if (built.has(entity)) return;

      withView(entity, work);
    };

    // Placement: a moved entity gets a new transform and may sort differently.
    for (const entity of ecs.changed(Transform)) {
      write(entity, view => {
        applyTransform(sctx, entity, view);
        resort(sctx, entity, view);
      });
    }

    // Look: the drawn content of the view changed.
    for (const entity of ecs.changed(Sprite)) {
      write(entity, view => {
        applySprite(sctx, entity, view);
        // A new size or fit changes the stretch the transform folds into the scale.
        applyTransform(sctx, entity, view);
      });
    }

    for (const entity of ecs.changed(NineSlice)) {
      write(entity, view => applyNineSlice(sctx, entity, view));
    }

    for (const entity of ecs.changed(Shape)) {
      write(entity, view => applyShape(sctx, entity, view));
    }

    // Draw order: only the position among the siblings changed.
    for (const entity of ecs.changed(Order)) write(entity, view => resort(sctx, entity, view));

    // Tree position: the view moves to another layer or parent, and is placed and sorted there.
    for (const entity of ecs.changed(Layer)) {
      write(entity, view => {
        attach(sctx, entity, view);
        resort(sctx, entity, view);
      });
    }

    for (const entity of ecs.changed(Parent)) {
      write(entity, view => {
        attach(sctx, entity, view);
        applyTransform(sctx, entity, view);
        resort(sctx, entity, view);
      });
    }

    // A new `Display` object of the game replaces the old view outright.
    for (const entity of ecs.changed(Display)) {
      if (built.has(entity)) continue;

      guard(entity, () => {
        dropView(sctx, entity);
        createView(sctx, entity);
      });
    }
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
   * Takes the entities that are waiting to be built out of the change set.
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
   * One pass: removed, layers, added, changed, invalidated. A despawned entity takes its filter
   * slots with it, also when its view left in an earlier pass; a live one keeps them for its next
   * view.
   */
  const pass = (): void => {
    // The pass may change the tree: the unseen walks of the loops are taken again in the next frame.
    state.held.clear();

    for (const entity of state.removed) {
      guard(entity, () => dropView(sctx, entity));
      forgetLeft(state, ctx.deps.world.ecs, entity);
    }

    state.removed.clear();

    // An entity whose visual left in an earlier pass and that despawned since has no view to
    // remove any more; its entry goes here, so no despawned entity keeps one.
    for (const entity of state.filters.keys()) {
      if (!state.views.has(entity)) forgetLeft(state, ctx.deps.world.ecs, entity);
    }

    // A new layer list is the renderer's own signal of a scene switch: the frame is drawn, the pool trimmed later.
    if (syncLayers(sctx)) {
      deps.demand.whole("layers");
      deps.host.sceneChanged();
    }

    const built = buildParentFirst(takeAdded());

    applyChanges(built);
    applyReparented(built);
    applyAdapterChanges(built);
    applyInvalidated();
    applyOutlines();
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
    state.entityOf.clear();
    state.byKey.clear();
    // The views that showed the crops are gone; the rebuild cuts them again for its own views.
    clearFrames(state);
    destroyPools(state);
    clearLayers(state);
    state.root = undefined;
  };

  /**
   * Builds the root, the layers and a view for every entity that names a layer.
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
  };

  return {
    hitTest: (x: number, y: number, accept: (entity: Entity) => boolean): Entity | undefined =>
      hitTest(sctx, x, y, accept),

    hitAll: (x: number, y: number): readonly Entity[] => hitAll(sctx, x, y),

    boundsOf: (entity: Entity): HitBox | undefined => boundsOf(sctx, entity),

    hitBoxOf: (entity: Entity): HitBox | undefined => hitBoxOf(state, entity),

    displayOf: (entity: Entity): unknown | undefined => state.views.get(entity)?.object,

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

      overlays: (): readonly OverlayReport[] => overlayReports(sctx),

      state: (): DebugSwitches => ({
        ...state.debug,
        verifyFrames: deps.demand.verifying(),
        kept: deps.kept.isOn()
      })
    },

    filters: {
      set: (entity: Entity, slots: readonly FilterSlot[]): void =>
        setFilters(state, entity, slots, deps.demand.mark, deps.kept)
    },

    renderPasses: (): number => renderPassesOf(state, ctx.state.kept),

    root: (): PixiContainer | undefined => state.root,

    layerContainer: (name: string): PixiContainer | undefined => layerContainer(state, name),

    layerOf: (entity: Entity): string | undefined => layerOf(sctx, entity),

    stepOverlays: (): void => stepOverlays(sctx),

    drainOverlayEvents: (monitor: OverlayEventSink): void => drainOverlayEvents(sctx, monitor),

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
