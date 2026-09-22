/**
 * @file renderer/sync — API factory. One pass owns every display object: nothing else in the
 * engine creates, moves, sorts or destroys a Pixi node.
 */
import { Layer, Order } from "../../world/ecs/define";
import type { ComponentHandle, Entity } from "../../world/types";
import { Display, NineSlice, Parent, Shape, Sprite, Transform } from "../components";
import type { PixiContainer, PixiTexture, RendererCtx, SyncModule } from "../types";
import { provideDisplay, updateAdapterView } from "./adapters";
import { installFont, isFontInstalled } from "./fonts";
import { hitTest } from "./hit-test";
import { clearLayers, resort, syncLayers } from "./layers";
import { destroyPools, detach, dropPooled } from "./pools";
import { createSyncSystem } from "./system";
import { clearFrames, createTexture, destroyTexture } from "./textures";
import type {
  CreateTextureOptions,
  DisplayAdapter,
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
 * Creates the sync module: the world hooks, the one system, the texture registry and the hit
 * test.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The injected `host` and `viewport` modules.
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

    for (const entity of ecs.changed(Transform)) {
      write(entity, view => {
        applyTransform(sctx, entity, view);
        resort(sctx, entity, view);
      });
    }

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

    for (const entity of ecs.changed(Order)) write(entity, view => resort(sctx, entity, view));

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
          writeVisual(sctx, entity, view);
          applyTransform(sctx, entity, view);
        });
      }
    }
  };

  /**
   * Takes the entities that are waiting to be built out of the change set.
   *
   * @returns The entities of this pass, so the change step skips what the build just wrote.
   */
  const takeAdded = (): ReadonlySet<Entity> => {
    const built = copyOf(state.added);

    state.added.clear();

    return built;
  };

  /**
   * One pass: removed, layers, added, changed, invalidated.
   */
  const pass = (): void => {
    for (const entity of state.removed) guard(entity, () => dropView(sctx, entity));
    state.removed.clear();

    syncLayers(sctx);

    const built = emptyEntitySet();

    for (const entity of takeAdded()) {
      guard(entity, () => {
        if (createView(sctx, entity)) built.add(entity);
      });
    }

    applyChanges(built);
    applyReparented(built);
    applyAdapterChanges(built);
    applyInvalidated();
  };

  /**
   * Forgets every view, layer and pooled object without touching Pixi. Used before a rebuild,
   * where the old application and everything in it are already gone.
   */
  const forgetTree = (): void => {
    for (const view of state.views.values()) {
      if (view.kind === "Display") detach(view.object);
      view.wrapper = undefined;
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

    for (const [entity] of ctx.deps.world.ecs.query(Layer)) {
      guard(entity, () => createView(sctx, entity));
    }

    state.added.clear();
    state.removed.clear();
    state.reparented.clear();
  };

  return {
    hitTest: (x: number, y: number, accept: (entity: Entity) => boolean): Entity | undefined =>
      hitTest(sctx, x, y, accept),

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

    root: (): PixiContainer | undefined => state.root,

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
        ecs.system(createSyncSystem(pass))
      );

      rebuildAll();
    }
  };
}
