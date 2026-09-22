/**
 * @file ui plugin — lifecycle: the dependency resolution, the Yoga load, the component registry
 * read out of the feature descriptions, the registrations `onStart` opens and the teardown that
 * closes exactly those.
 */
import { flowPlugin } from "../flow";
import { i18nPlugin } from "../i18n";
import { inputPlugin } from "../input";
import { Pressed } from "../input/components";
import { rendererPlugin } from "../renderer";
import { textPlugin } from "../text";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { Layer, system, Tree } from "../world/ecs/define";
import { createModules } from "./api";
import { UI_OWNER } from "./components";
import { asTagHandle } from "./errors";
import type { AnyComponentDefinition, JsxModule } from "./jsx/types";
import type { LayoutModule } from "./layout/types";
import type { Deps, KernelSlice, State, UiCtx } from "./types";

/**
 * Resolves the seven dependency APIs with `ctx.require`. `anim` is required for the edge only:
 * its work reaches `ui` through the tween driver behind every handle.
 *
 * @param ctx - Kernel context of the ui plugin.
 * @returns The seven dependency APIs.
 */
function resolveDeps(ctx: KernelSlice): Deps {
  return {
    time: ctx.require(timePlugin),
    flow: ctx.require(flowPlugin),
    world: ctx.require(worldPlugin),
    renderer: ctx.require(rendererPlugin),
    input: ctx.require(inputPlugin),
    i18n: ctx.require(i18nPlugin),
    text: ctx.require(textPlugin)
  };
}

/**
 * Builds the domain context the three modules share.
 *
 * @param ctx - Kernel context of the ui plugin.
 * @returns The domain context of the ui plugin.
 */
export function withDeps(ctx: KernelSlice): UiCtx {
  return { ...ctx, deps: resolveDeps(ctx) };
}

/**
 * Tells whether a feature entry is a component `defineComponent` built.
 *
 * @param entry - What the feature put under its `ui` key.
 * @returns True when `ui` can register it.
 */
function isComponent(entry: unknown): entry is AnyComponentDefinition {
  return typeof entry === "function" && (entry as { isUiComponent?: true }).isUiComponent === true;
}

/**
 * Fills the component registry from the `ui` key of every feature, in feature order.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param jsx - The jsx module, which owns the registry.
 * @throws {Error} When two features define the same component name.
 */
function registerComponents(ctx: UiCtx, jsx: JsxModule): void {
  for (const feature of ctx.deps.flow.features.all()) {
    for (const entry of feature.description.ui ?? []) {
      if (isComponent(entry)) jsx.register(entry);
    }
  }
}

/**
 * Opens the two systems of phase `layout`, the four world hooks of `Tree` and `Pressed`, the two
 * effect handlers and the tap listener. Every remover goes into the state, so the teardown closes exactly these.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param jsx - The jsx module.
 * @param layout - The layout module.
 */
function openRegistrations(ctx: UiCtx, jsx: JsxModule, layout: LayoutModule): void {
  const ecs = ctx.deps.world.ecs;
  const projection = ctx.deps.world.projection;

  ctx.state.layout.cleanups.push(
    ecs.system(system({ name: "ui.reconcile", phase: "layout", query: [], run: jsx.reconcile })),
    ecs.system(system({ name: "ui.solve", phase: "layout", query: [], run: jsx.solve })),
    ecs.onAdded(Tree, entity => {
      const place = projection.keyOf(entity);

      jsx.mountRoot(entity, place?.projection ?? "ui", ecs.get(entity, Layer)?.name ?? "ui");
    }),
    ecs.onRemoved(Tree, entity => jsx.unmountRoot(entity)),
    ecs.onAdded(asTagHandle(Pressed), entity => jsx.markPressed(entity, true)),
    ecs.onRemoved(asTagHandle(Pressed), entity => jsx.markPressed(entity, false)),
    ctx.deps.flow.fx.handle("popup", layout.popupHandler(jsx)),
    ctx.deps.flow.fx.handle("guide", layout.guideHandler()),
    ctx.deps.input.onTap(jsx.applyTap),
    () => ecs.despawnOwnedBy(UI_OWNER)
  );
}

/**
 * Loads Yoga, reads the components of every feature and opens the registrations. Nothing solves
 * before the wasm module resolved; a tree seen earlier waits and is reconciled on the next frame.
 *
 * @param ctx - Kernel context of the ui plugin.
 * @throws {Error} When two features define the same component name.
 */
export async function startUi(ctx: KernelSlice): Promise<void> {
  const uctx = withDeps(ctx);
  const { jsx, layout } = createModules(uctx);

  registerComponents(uctx, jsx);
  openRegistrations(uctx, jsx, layout);

  await layout.load();
}

/**
 * Closes what the plugin opened: the systems, the hooks, the handlers, the ui entities, and
 * every Yoga node, children first, because `free()` on an attached node throws.
 *
 * @param state - The plugin state, the only thing a teardown context carries.
 */
export function stopUi(state: State): void {
  for (const off of state.layout.cleanups) off();

  state.layout.cleanups.length = 0;

  for (const node of state.layout.byEntity.values()) {
    for (let index = node.getChildCount() - 1; index >= 0; index -= 1) {
      // eslint-disable-next-line unicorn/prefer-dom-node-remove -- a Yoga node is not a DOM node.
      node.removeChild(node.getChild(index));
    }
  }

  for (const node of state.layout.byEntity.values()) {
    // eslint-disable-next-line unicorn/no-null -- Yoga clears a measure function with null.
    node.setMeasureFunc(null);
    node.free();
  }

  state.layout.byEntity.clear();
  state.layout.nodes = 0;
  state.layout.yoga = undefined;
  state.layout.scrolling = undefined;
  state.jsx.components.clear();
  state.jsx.roots.clear();
  state.jsx.elements.clear();
  state.jsx.byIdentity.clear();
  state.jsx.byKey.clear();
  state.jsx.instances.clear();
  state.jsx.exiting.clear();
  state.jsx.removing.clear();
  state.styles.viewport = undefined;
}
