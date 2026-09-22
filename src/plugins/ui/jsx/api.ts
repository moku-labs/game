/**
 * @file ui/jsx — the module factory: the three public readers and the frame half the lifecycle
 * registers. Built last, with `styles` and `layout` injected.
 */
import type { Entity } from "../../world/types";
import type { UiCtx } from "../types";
import { runLint } from "./lint";
import { createReconciler, type JsxModules } from "./reconcile";
import { applyTap } from "./tap";
import { readTree, sortedRoots } from "./tree";
import type { AnyComponentDefinition, Finding, JsxModule, UiNode } from "./types";

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
  const layerNames = (): string[] => ctx.deps.world.projection.layers().map(layer => layer.name);

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

    solve: frame.solve,

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

    applyTap: (entity: Entity): void => applyTap(ctx, entity),

    markPressed: frame.markPressed,

    playEnter: frame.playEnter
  };
}
