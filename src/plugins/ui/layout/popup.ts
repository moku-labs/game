/**
 * @file ui/layout — the handler of the `popup` effect: a root of its own above every other root
 * in the `ui` layer, mounted by the next reconcile. When the handler's signal aborts (the gate
 * answered, or the node was aborted) the root stays until the flow rests on a node that shows no
 * popup of its component; a popup of the same component that comes first takes the root back.
 */
import type { FxHandler } from "../../flow/fx/types";
import { Layer, Order, Tree } from "../../world/ecs/define";
import type { Entity } from "../../world/types";
import { UI_OWNER } from "../components";
import type { JsxModule, PopupLink } from "../jsx/types";
import type { UiCtx } from "../types";
import type { LayoutState } from "./types";

/** The layer every scene appends, and the one a popup root is drawn in. */
const UI_LAYER = "ui";

/**
 * Reads the component name, the props and the popup kept beneath out of the descriptor the node
 * awaited. `over` is the option of `popup()`, not the `over` flag of a flow node.
 *
 * @param payload - What `popup()` put in the descriptor.
 * @returns The name, the props, and `over` when the payload names one.
 * @example
 * ```ts
 * readPayload({ component: "Confirm", props: {}, over: "Settings" }).over; // "Settings"
 * ```
 */
export function readPayload(payload: unknown): { component: string; props: object; over?: string } {
  if (typeof payload !== "object" || payload === null) return { component: "", props: {} };

  const record = payload as { component?: unknown; props?: unknown; over?: unknown };
  const props = typeof record.props === "object" && record.props !== null ? record.props : {};
  const component = typeof record.component === "string" ? record.component : "";

  return typeof record.over === "string"
    ? { component, props, over: record.over }
    : { component, props };
}

/**
 * Spawns the root entity of a new popup, above every root spawned before it.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state, which counts the draw order of the popup roots.
 * @param component - The component the popup shows.
 * @param props - What its view is called with.
 * @returns The root entity.
 */
function spawnRoot(ctx: UiCtx, state: LayoutState, component: string, props: object): Entity {
  state.order += 1;

  const entity = ctx.deps.world.ecs.spawn(UI_OWNER, [
    Tree({ node: { type: component, props, children: [] } }),
    Layer({ name: UI_LAYER }),
    Order({ value: state.order })
  ]);

  ctx.deps.time.wake();

  return entity;
}

/**
 * Builds the `popup` handler. Its promise resolves when the root is gone or another handler took
 * it back. The node never waits for it: the runner resolves a descriptor with `answers` with the
 * gate answer, so the node goes on while the root still stands and plays its exit.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state, which counts the draw order of the popup roots.
 * @param jsx - The jsx module, which owns the roots.
 * @returns The handler `flow.fx.handle("popup", ...)` takes.
 */
export function createPopupHandler(ctx: UiCtx, state: LayoutState, jsx: JsxModule): FxHandler {
  return (descriptor, { signal, mode }) => {
    const { component, props, over } = readPayload(descriptor.payload);

    if (!ctx.state.jsx.components.has(component)) {
      throw new Error(
        `[game] Popup "${component}" is not registered.\n  Add it to the ui key of a feature.`
      );
    }

    if (mode === "fast") return;

    return new Promise<void>(resolve => {
      const link: PopupLink = { close: resolve };

      // A node that ended before its popup was shown gets a root that leaves at once.
      if (signal.aborted) {
        const entity = spawnRoot(ctx, state, component, props);

        jsx.mountRoot(entity, component, UI_LAYER, link);
        jsx.unmountRoot(entity);

        return;
      }

      const entity =
        jsx.reclaimPopup(component, props, link) ?? spawnRoot(ctx, state, component, props);

      jsx.mountRoot(entity, component, UI_LAYER, link);

      if (over !== undefined) jsx.coverPopup(over, entity);

      signal.addEventListener("abort", () => jsx.releasePopup(entity, link), { once: true });
    });
  };
}
