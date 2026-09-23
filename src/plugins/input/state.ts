/**
 * @file input plugin — state factory.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial input state: an empty sample queue, no active pointer and no gesture. Every
 * duration starts at zero; the plugin never reads a device clock.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @returns A fresh state, owned by one app.
 */
export function createInputState(_ctx: { readonly config: Readonly<Config> }): State {
  return {
    samples: [],
    phase: "idle",
    pointerId: undefined,
    entity: undefined,
    key: undefined,
    start: { x: 0, y: 0 },
    grabOffset: { x: 0, y: 0 },
    pressedMs: 0,
    hovered: undefined,
    pointerOver: undefined,
    parent: undefined,
    restScale: undefined,
    unmute: undefined,
    canvas: undefined,
    offFrame: undefined,
    detach: undefined,
    tapListeners: [],
    wake: undefined,
    cursor: undefined,
    controls: []
  };
}
