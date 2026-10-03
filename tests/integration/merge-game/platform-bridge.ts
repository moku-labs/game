/**
 * @file The bridge from the shell to the engine: four plugins of `@moku-labs/system` become the
 * `PlatformProvider` that `platformPlugin` reads. The application layer owns it, because the
 * engine never imports a native package (lint rule L13). The same bridge runs on the web page and
 * in the native app: the system app picks the Tauri providers in the shell and the web providers
 * in a browser, which answer honestly what a browser cannot do.
 */
import type { HapticKind, PlatformProvider } from "@moku-labs/game";
import type { Back, Haptics, KeepAwake, Lifecycle, SystemResult } from "@moku-labs/system";

/**
 * What the bridge reads of the system app: the four capabilities. A system app composed of
 * `lifecyclePlugin`, `backPlugin`, `hapticsPlugin` and `keepAwakePlugin` has all of them.
 */
export type SystemSlice = {
  readonly lifecycle: Lifecycle.LifecycleApi;
  readonly back: Back.BackApi;
  readonly haptics: Haptics.HapticsApi;
  readonly keepAwake: KeepAwake.KeepAwakeApi;
};

/**
 * Plays one tick of the engine with the capability of its kind: the three impacts, the three
 * outcome patterns, and the selection tick.
 *
 * @param haptics - The haptics capability of the system app.
 * @param kind - One of the seven kinds of `HAPTIC_KINDS`.
 * @returns What the shell answered.
 */
function play(haptics: Haptics.HapticsApi, kind: HapticKind): Promise<SystemResult<void>> {
  switch (kind) {
    case "light":
    case "medium":
    case "heavy": {
      return haptics.impact(kind);
    }
    case "success":
    case "warning":
    case "error": {
      return haptics.notify(kind);
    }
    case "selection": {
      return haptics.selection();
    }
  }
}

/**
 * Asks the shell without waiting for the answer. A capability answers with a `SystemResult`, never
 * a throw, and the provider of the engine returns nothing: a tick the shell cannot play (iOS
 * Safari, a desktop) is an honest `unsupported`, not an error of the game.
 *
 * @param ask - The capability call.
 */
function send(ask: () => Promise<SystemResult<void>>): void {
  void ask();
}

/**
 * Builds the engine's provider over the system app. On iOS `exit` answers `unsupported`, so Leave
 * lands back on Home there, as on the web page.
 *
 * @param system - The system app with lifecycle, back, haptics and keepAwake.
 * @returns The provider to pass as `pluginConfigs.platform.provider`.
 * @example
 * ```ts
 * const system = createSystem({ plugins: [lifecyclePlugin, backPlugin, hapticsPlugin, keepAwakePlugin] });
 * fromSystem(system).haptic("success"); // the shell plays system.haptics.notify("success")
 * ```
 */
export function fromSystem(system: SystemSlice): PlatformProvider {
  return {
    onPause: fn => system.lifecycle.onPause(fn),
    onResume: fn => system.lifecycle.onResume(fn),
    onBack: fn => system.back.onPress(fn),
    haptic: kind => send(() => play(system.haptics, kind)),
    keepAwake: on => send(() => system.keepAwake.set(on)),
    exit: () => send(() => system.back.exit())
  };
}
