/**
 * @file effects — the switches of a debug build: filter kinds turned off and on by hand. The filter sync leaves an
 * off kind out of the slots it hands the renderer; its instances stay and stay written.
 */
import { rendererPlugin } from "../renderer";
import type { EffectsDiagnostics, KernelSlice } from "./types";

/**
 * Turns one kind off or on. An unknown kind warns once per id and answers false; a kind already in the asked state
 * answers true and logs nothing. Otherwise the off list is rebuilt in registration order, the switch is logged and
 * written into the performance log as a `switch` event.
 *
 * @param ctx - Kernel context of the effects plugin.
 * @param kind - The kind id.
 * @param on - True to turn it on, false to turn it off.
 * @returns True when the kind is known and now in the asked state.
 */
function switchKind(ctx: KernelSlice, kind: string, on: boolean): boolean {
  const { state } = ctx;
  const { diagnostics } = state;

  if (!state.kinds.has(kind)) {
    const key = `diagnostics:${kind}`;

    if (!state.warned.has(key)) {
      state.warned.add(key);
      ctx.log.warn("effects:diagnostics-unknown", { kind });
    }

    return false;
  }

  // Already off when asked off, or on when asked on: nothing changes, the list stays the same array.
  if (diagnostics.off.has(kind) !== on) return true;

  if (on) diagnostics.off.delete(kind);
  else diagnostics.off.add(kind);

  diagnostics.offList = Object.freeze(diagnostics.kinds.filter(id => diagnostics.off.has(id)));
  // A kind's slots come and go on every view that carries it: the next filter sync looks at every view.
  state.filterSync.all = true;
  ctx.log.info("effects:diagnostics", { kind, on });
  ctx.require(rendererPlugin).monitor.event("switch", { kind, on });

  return true;
}

/**
 * Builds `app.effects.diagnostics`. `disable` and `enable` switch only inside the inline dev-or-agent guard, written
 * positive, so a release build folds the branch and drops `switchKind` and its log events with it.
 *
 * @param ctx - Kernel context of the effects plugin.
 * @returns The switches.
 */
export function createDiagnostics(ctx: KernelSlice): EffectsDiagnostics {
  const { diagnostics } = ctx.state;

  return {
    kinds: () => diagnostics.kinds,
    disable: kind => {
      if (
        (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
        (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)
      ) {
        return switchKind(ctx, kind, false);
      }

      return false;
    },
    enable: kind => {
      if (
        (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
        (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)
      ) {
        return switchKind(ctx, kind, true);
      }

      return false;
    },
    disabled: () => diagnostics.offList
  };
}
