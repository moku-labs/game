/**
 * @file ui/jsx — the module factory: the three public readers, the frame half the lifecycle
 * registers and the keyboard focus. Built last, with `styles` and `layout` injected.
 */
import type { KeyInput } from "../../input/types";
import type { Entity, LayerSpec } from "../../world/types";
import type { UiCtx } from "../types";
import { createFocus } from "./focus";
import { releaseHosted } from "./hosts";
import { runLint } from "./lint";
import { coverPopup, reclaimPopup, releasePopup } from "./popups";
import { createReconciler, type JsxModules } from "./reconcile";
import { applyTap } from "./tap";
import { readTree, sortedRoots } from "./tree";
import type { AnyComponentDefinition, Finding, JsxModule, PopupLink, UiNode } from "./types";

/**
 * The layer names of the scene in draw order, mapped again only when the scene set a new layer
 * list: `projection.layers()` answers the same frozen array until then.
 *
 * @param ctx - Domain context of the ui plugin.
 * @returns The reader `tree`, `find` and the focus share.
 */
function layerNamesOf(ctx: UiCtx): () => readonly string[] {
  let seen: readonly LayerSpec[] | undefined;
  let names: readonly string[] = [];

  return (): readonly string[] => {
    const layers = ctx.deps.world.projection.layers();

    if (layers !== seen) {
      seen = layers;
      names = layers.map(layer => layer.name);
    }

    return names;
  };
}

/**
 * Builds the jsx module.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param modules - The styles and layout modules, injected in that order.
 * @returns The module: `tree`, `find` and `lint` reach the game, the rest the frame.
 */
export function createJsxApi(ctx: UiCtx, modules: JsxModules): JsxModule {
  const state = ctx.state.jsx;
  const frame = createReconciler(ctx, modules);
  const layerNames = layerNamesOf(ctx);
  const focus = createFocus(ctx, frame.markPointer, layerNames);

  return {
    tree: (): UiNode => readTree(state, layerNames()),

    find: (key: string): Entity | undefined => {
      for (const root of sortedRoots(state, layerNames())) {
        const entity = state.byKey.get(root.entity)?.get(key);

        if (entity !== undefined && !state.exiting.has(entity)) return entity;
      }

      return undefined;
    },

    lint: (): readonly Finding[] => runLint(ctx),

    reconcile: frame.reconcile,

    // The focus follows the solved rects, and drops when its element or its root left.
    solve: (): void => {
      frame.solve();
      focus.refresh();
    },

    register: (definition: AnyComponentDefinition): void => {
      if (state.components.has(definition.name)) {
        throw new Error(
          `[game] Component "${definition.name}" is defined twice.\n` +
            "  Use one defineComponent() call and import it."
        );
      }

      state.components.set(definition.name, definition);
    },

    mountRoot: frame.mountRoot,

    unmountRoot: frame.unmountRoot,

    reclaimPopup: (component: string, props: object, link: PopupLink): Entity | undefined =>
      reclaimPopup(ctx, state, component, props, link),

    coverPopup: (over: string, coverer: Entity): void => coverPopup(ctx, state, over, coverer),

    releasePopup: (entity: Entity, link: PopupLink): void => releasePopup(ctx, state, entity, link),

    releaseHosted: (): void => releaseHosted(ctx, state),

    applyTap: (entity: Entity): void => applyTap(ctx, entity),

    markPointer: frame.markPointer,

    playEnter: frame.playEnter,

    key: (input: KeyInput): boolean => focus.key(input),

    blur: focus.blur
  };
}
