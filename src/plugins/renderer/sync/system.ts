/**
 * @file renderer/sync — the one world system the renderer registers. It runs in phase `"sync"`,
 * which `world` runs in every mode, so a fast walk still sets the picture.
 */
import type { AnySystem } from "../../world/ecs/types";

/** The name the system is registered under; it shows up in a world error message. */
export const SYNC_SYSTEM_NAME = "renderer.sync";

/**
 * Wraps the pass in a world system definition. The system queries nothing: all the work is
 * driven by the change sets of the frame.
 *
 * @param pass - One pass over removed, layers, added, changed and invalidated.
 * @returns The system definition `world.ecs.system` takes.
 */
export function createSyncSystem(pass: () => void): AnySystem {
  return {
    name: SYNC_SYSTEM_NAME,
    phase: "sync",
    query: [],
    run: (): void => {
      pass();
    }
  };
}
