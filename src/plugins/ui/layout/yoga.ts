/**
 * @file ui/layout — the one place Yoga is loaded. The wasm module arrives through a dynamic
 * import, so a game without `ui` never carries it (lint L2).
 */
import type { Yoga } from "yoga-layout/load";

/**
 * Loads the Yoga wasm module. About 8 ms cold in Bun, under 1 ms once the module is cached.
 *
 * @returns The module, with the node factory and the enums.
 * @example
 * ```ts
 * const yoga = await loadYogaModule();
 * yoga.Node.create().getChildCount(); // 0
 * ```
 */
export async function loadYogaModule(): Promise<Yoga> {
  const module = await import("yoga-layout/load");

  return module.loadYoga();
}
