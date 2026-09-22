/**
 * @file ui/layout — the handler of the `popup` effect: a root of its own above every other root
 * in the `ui` layer, mounted by the next reconcile and unmounted when the handler's signal
 * aborts, which `flow` does as soon as the gate answered.
 */
import type { FxHandler } from "../../flow/fx/types";
import { Layer, Order, Tree } from "../../world/ecs/define";
import { UI_OWNER } from "../components";
import type { JsxModule } from "../jsx/types";
import type { UiCtx } from "../types";
import type { LayoutState } from "./types";

/** The layer every scene appends, and the one a popup root is drawn in. */
const UI_LAYER = "ui";

/**
 * Reads the component name and the props out of the descriptor the node awaited.
 *
 * @param payload - What `popup()` put in the descriptor.
 * @returns The name and the props.
 * @example
 * ```ts
 * readPayload({ component: "RewardPopup", props: { gold: 5 } }).component; // "RewardPopup"
 * ```
 */
export function readPayload(payload: unknown): { component: string; props: object } {
  if (typeof payload !== "object" || payload === null) return { component: "", props: {} };

  const record = payload as { component?: unknown; props?: unknown };
  const props = typeof record.props === "object" && record.props !== null ? record.props : {};

  return { component: typeof record.component === "string" ? record.component : "", props };
}

/**
 * Builds the `popup` handler. It resolves when the root is gone, so the node that awaited the
 * effect continues only after the exit motions played.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state, which counts the draw order of the popup roots.
 * @param jsx - The jsx module, which mounts and unmounts the root.
 * @returns The handler `flow.fx.handle("popup", ...)` takes.
 */
export function createPopupHandler(ctx: UiCtx, state: LayoutState, jsx: JsxModule): FxHandler {
  return (descriptor, { signal, mode }) => {
    const { component, props } = readPayload(descriptor.payload);

    if (!ctx.state.jsx.components.has(component)) {
      throw new Error(
        `[game] Popup "${component}" is not registered.\n  Add it to the ui key of a feature.`
      );
    }

    if (mode === "fast") return;

    state.order += 1;

    const entity = ctx.deps.world.ecs.spawn(UI_OWNER, [
      Tree({ node: { type: component, props, children: [] } }),
      Layer({ name: UI_LAYER }),
      Order({ value: state.order })
    ]);

    ctx.deps.time.wake();

    return new Promise<void>(resolve => {
      jsx.mountRoot(entity, component, UI_LAYER, { close: resolve });

      if (signal.aborted) jsx.unmountRoot(entity);
      else signal.addEventListener("abort", () => jsx.unmountRoot(entity), { once: true });
    });
  };
}
