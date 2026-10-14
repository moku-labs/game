/**
 * @file i18n plugin — the strings that live with a bundle: the companion `assets` calls when a bundle loads and
 * unloads, and the queue every strings load runs on.
 */
import type { I18nCtx, State } from "./types";

/**
 * Registers the strings companion with `assets` in `onInit`, only when `assets` is composed (R2): no `depends` edge.
 *
 * @param _ctx - Domain context of the i18n plugin.
 */
export function connectI18n(_ctx: I18nCtx): void {
  throw new Error("not implemented");
}

/**
 * The bundle a key waits for: its first segment while that sub-feature's strings are coupled and not loaded.
 *
 * @param _state - The i18n state.
 * @param _key - A string key.
 */
export function bundleOfKey(_state: State, _key: string): string | undefined {
  throw new Error("not implemented");
}
