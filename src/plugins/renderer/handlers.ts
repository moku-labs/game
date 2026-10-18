/**
 * @file renderer plugin — the hooks: a pause hands the captures still waiting for a drawn frame
 * their picture, since no frame comes while the clock is paused, and trims Pixi's texture pool; a change of the frame
 * rate brings the render scale the adaptive rule chose. In an agent build the performance monitor also hears the pause
 * stack, the flow path, the thermal readings, the changes of the frame rate and of the scale.
 */
import { flowPlugin } from "../flow";
import type { Events as FlowEvents } from "../flow/types";
import type { Events as LifecycleEvents } from "../lifecycle/types";
import { timePlugin } from "../time";
import type { RateChange, ThermalReading } from "../time/types";
import { createModules } from "./api";
import { trimOnPause } from "./host/pool";
import { followScale } from "./host/resolution";
import { withDeps } from "./lifecycle";
import { servePaused } from "./monitor/capture";
import type { KernelSlice, MonitorModule } from "./types";

/** Payload of the `lifecycle:changed` hook. */
type LifecycleChanged = LifecycleEvents["lifecycle:changed"];

/** Payload of the `flow:rest` hook. */
type FlowRest = FlowEvents["flow:rest"];

/**
 * Creates the hooks of the renderer. `time` is resolved when a hook fires, not while this factory
 * runs: the kernel registers hooks before it builds the plugin APIs. The monitor module of an
 * agent build is built on the first hook that needs it, for the same reason.
 *
 * @param ctx - Kernel context of the renderer plugin.
 * @returns The hooks of the plugin.
 */
export function createHandlers(ctx: KernelSlice): {
  "lifecycle:changed": (payload: LifecycleChanged) => void;
  "flow:edge": () => void;
  "flow:rest": (payload: FlowRest) => void;
  "time:thermal": (reading: ThermalReading) => void;
  "time:rate": (change: RateChange) => void;
} {
  let monitor: MonitorModule | undefined;

  /**
   * The monitor module, built once.
   *
   * @returns The monitor module.
   */
  const monitorOf = (): MonitorModule => {
    monitor ??= createModules(withDeps(ctx)).monitor;

    return monitor;
  };

  return {
    /**
     * Serves the captures still waiting for a drawn frame once the game pauses. Dev builds and
     * debug builds only. Every build gives back what grew in Pixi's texture pool on a pause. An
     * agent build also writes the pause or resume event and, on a pause, the partial second.
     *
     * @param payload - What changed on the pause stack.
     */
    "lifecycle:changed": (payload: LifecycleChanged): void => {
      // The dev or agent guard is inline and positive, not `isDev()`: Bun folds it under a
      // production `define` and drops the capture code with it, as the renderer README explains.
      // The pause is the one signal a paused clock gives: no frame comes to serve the queue.
      if (
        ((typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
          (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)) &&
        payload.paused
      ) {
        servePaused(ctx.state.monitor, ctx.require(timePlugin));
      }

      // Every build: a game in the background holds no render target it does not need (C14).
      if (payload.paused && ctx.config.poolTrim !== false) trimOnPause(withDeps(ctx));

      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
        monitorOf().pauses(payload.reasons, payload.paused, payload.resumed);
      }
    },

    /**
     * Notes the flow path the frames run on after an edge. Agent builds only.
     */
    "flow:edge": (): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
        monitorOf().path(ctx.require(flowPlugin).state().path, false);
      }
    },

    /**
     * Notes the rest path; a new one writes an auto mark. Agent builds only.
     *
     * @param payload - Where the flow came to rest.
     */
    "flow:rest": (payload: FlowRest): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
        monitorOf().path(payload.path, true);
      }
    },

    /**
     * Writes the native shell's thermal reading as a `thermal` line. Agent builds only; `time`
     * holds the engine's one `moku-native:thermal` listener.
     *
     * @param reading - The reading.
     */
    "time:thermal": (reading: ThermalReading): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
        monitorOf().thermal(reading);
      }
    },

    /**
     * Draws at the render scale the change carries from the next frame, in every build. An agent build writes the
     * change as a `rate` event line, the payload as its detail, and a move of the scale as a `scale` line.
     *
     * @param change - The change `time:rate` carried.
     */
    "time:rate": (change: RateChange): void => {
      const from = ctx.state.host.resolution.scale;

      followScale(ctx.state.host, change.scale);

      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
        monitorOf().event("rate", change);

        if (change.scale !== from) {
          monitorOf().event("scale", {
            from,
            to: change.scale,
            reason: change.reason,
            fps: change.to
          });
        }
      }
    }
  };
}
