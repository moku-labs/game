/**
 * @file debug plugin — the overlay call: the agent's channel, else the 0.10 editor overlay, else false; folded out of a
 * release build.
 */
import type { Log } from "@moku-labs/common/browser";
import type { OverlayApi, OverlayMode } from "./types";

/** The channel the editor's page agent sets on `globalThis.__MOKU_GAME_OVERLAY__`. */
type Channel = NonNullable<typeof globalThis.__MOKU_GAME_OVERLAY__>;

/** The overlay of the released editor 0.10, `globalThis.editor.overlay`: no pill and no toggle. */
type LegacyOverlay = { open(): void; close(): void; isOpen(): boolean };

/** The member of the overlay call a failure names. */
type OverlayCall = "open" | "close" | "toggle" | "isOpen";

/**
 * Tells whether a value is an object carrying a function under every name.
 *
 * @param value - The value read from the page.
 * @param names - The member names.
 * @returns True when every member is a function.
 */
function hasFunctions(value: unknown, names: readonly string[]): value is object {
  if (typeof value !== "object" || value === null) return false;

  return names.every(name => typeof Reflect.get(value, name) === "function");
}

/**
 * Tells whether a value is the agent's channel: an object with the four functions.
 *
 * @param value - `globalThis.__MOKU_GAME_OVERLAY__`, read at call time.
 * @returns True for a usable channel.
 */
function isChannel(value: unknown): value is Channel {
  return hasFunctions(value, ["open", "close", "toggle", "isOpen"]);
}

/**
 * Tells whether a value is the overlay of the editor 0.10: `open`, `close` and `isOpen`.
 *
 * @param value - `globalThis.editor.overlay`, read at call time.
 * @returns True for a usable overlay.
 */
function isLegacy(value: unknown): value is LegacyOverlay {
  return hasFunctions(value, ["open", "close", "isOpen"]);
}

/**
 * Reads the overlay of the released editor 0.10, kept as a fallback for this release.
 *
 * @returns The overlay, or `undefined` when the page has none.
 */
function legacyOverlay(): LegacyOverlay | undefined {
  const editor: unknown = Reflect.get(globalThis, "editor");

  if (typeof editor !== "object" || editor === null) return undefined;

  const overlay: unknown = Reflect.get(editor, "overlay");

  return isLegacy(overlay) ? overlay : undefined;
}

/**
 * Runs one member against the channel, else the 0.10 overlay. Both are read now: the agent sets the channel after
 * the app started. A member that throws is logged and answers false.
 *
 * @param log - The plugin's log.
 * @param call - The member.
 * @param mode - The mode `open` passes on.
 * @returns What the overlay answered: true when one took the call, `isOpen()` for `isOpen`.
 */
function callOverlay(log: Log.LogApi, call: OverlayCall, mode: OverlayMode): boolean {
  try {
    const channel: unknown = globalThis.__MOKU_GAME_OVERLAY__;

    if (isChannel(channel)) {
      if (call === "isOpen") return channel.isOpen();

      if (call === "open") channel.open({ mode });
      else channel[call]();

      return true;
    }

    const legacy = legacyOverlay();

    if (legacy === undefined) return false;

    if (call === "isOpen") return legacy.isOpen();

    // The 0.10 overlay has no pill and no toggle: the mode is dropped, a toggle asks first.
    const opens = call === "open" || (call === "toggle" && !legacy.isOpen());

    if (opens) legacy.open();
    else legacy.close();

    return true;
  } catch (error) {
    log.error(
      "debug:overlay-failed",
      { call },
      error instanceof Error ? error : new Error(String(error))
    );

    return false;
  }
}

/**
 * Builds the overlay call. Every member calls the overlay only inside the inline agent guard, written positive: a
 * release build defines the flag false, folds the branch and drops `callOverlay` with it (a refusal form followed by
 * a call keeps the helper in a Bun bundle). On an agent page a member goes to the channel, else to the 0.10 editor
 * overlay, else answers false.
 *
 * @param ctx - The plugin context; its log takes a failing channel call.
 * @param ctx.log - The plugin's log.
 * @returns The overlay API.
 */
export function createOverlay(ctx: { readonly log: Log.LogApi }): OverlayApi {
  return {
    open: options => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
        return callOverlay(ctx.log, "open", options?.mode ?? "card");
      }

      return false;
    },
    close: () => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
        return callOverlay(ctx.log, "close", "card");
      }

      return false;
    },
    toggle: () => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
        return callOverlay(ctx.log, "toggle", "card");
      }

      return false;
    },
    isOpen: () => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
        return callOverlay(ctx.log, "isOpen", "card");
      }

      return false;
    }
  };
}
