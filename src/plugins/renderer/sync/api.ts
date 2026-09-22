/**
 * @file renderer/sync — API factory. One pass owns every display object: nothing else in the
 * engine creates, moves, sorts or destroys a Pixi node.
 */
import { Layer, Order } from "../../world/ecs/define";
import type { Entity } from "../../world/ecs/types";
import { Display, NineSlice, Parent, Sprite, Transform } from "../components";
import type { PixiContainer, PixiTexture, RendererCtx, SyncModule } from "../types";
import { hitTest } from "./hit-test";
import { clearLayers, resort, syncLayers } from "./layers";
import { destroyPools, detach, dropPooled } from "./pools";
import { createSyncSystem } from "./system";
import { createTexture, destroyTexture } from "./textures";
import type { CreateTextureOptions, SyncCtx, SyncDeps, TextureProvider, View } from "./types";
import {
  applyNineSlice,
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
   * Step 4: only the entities the frame really changed.
   */
  const applyChanges = (): void => {
    const ecs = ctx.deps.world.ecs;

    for (const entity of ecs.changed(Transform)) {
      withView(entity, view => {
        applyTransform(sctx, entity, view);
        resort(sctx, entity, view);
      });
    }

    for (const entity of ecs.changed(Sprite)) {
      withView(entity, view => applySprite(sctx, entity, view));
    }

    for (const entity of ecs.changed(NineSlice)) {
      withView(entity, view => applyNineSlice(sctx, entity, view));
    }

    for (const entity of ecs.changed(Order)) withView(entity, view => resort(sctx, entity, view));

    for (const entity of ecs.changed(Layer)) {
      withView(entity, view => {
        attach(sctx, entity, view);
        resort(sctx, entity, view);
      });
    }

    for (const entity of ecs.changed(Parent)) {
      withView(entity, view => {
        attach(sctx, entity, view);
        applyTransform(sctx, entity, view);
      });
    }

    for (const entity of ecs.changed(Display)) {
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
   * One pass: removed, layers, added, changed, invalidated.
   */
  const pass = (): void => {
    for (const entity of state.removed) guard(entity, () => dropView(sctx, entity));
    state.removed.clear();

    syncLayers(sctx);

    for (const entity of state.added) guard(entity, () => createView(sctx, entity));
    state.added.clear();

    applyChanges();
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

      destroy: (texture: PixiTexture): void => destroyTexture(texture),

      invalidate: (keys: readonly string[]): void => {
        if (state.root === undefined) return;

        for (const key of keys) state.invalidated.add(key);
        dropPooled(state, keys);
      }
    },

    root: (): PixiContainer | undefined => state.root,

    rebuildAll,

    pass,

    forget: forgetTree,

    start: (): void => {
      if (deps.host.stage() === undefined) return;

      const ecs = ctx.deps.world.ecs;
      const markAdded = (entity: Entity): void => {
        state.added.add(entity);
      };
      const markRemoved = (entity: Entity): void => {
        state.removed.add(entity);
      };

      state.cleanups.push(
        ecs.onAdded(Sprite, markAdded),
        ecs.onAdded(NineSlice, markAdded),
        ecs.onAdded(Display, markAdded),
        ecs.onRemoved(Sprite, markRemoved),
        ecs.onRemoved(NineSlice, markRemoved),
        ecs.onRemoved(Display, markRemoved),
        ecs.system(createSyncSystem(pass))
      );

      rebuildAll();
    }
  };
}
