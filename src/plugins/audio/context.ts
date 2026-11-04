/**
 * @file audio plugin — the one context of the app: making it, and renewing it after a return from
 * the background on iOS (F149).
 *
 * With the `ambient` session, a short trip to the background leaves WebKit silent for good. iOS
 * deactivates the session, WebKit drops iOS's end of the interruption as spurious and keeps its
 * cached "active" flag, so it never asks iOS again. Only a closed last context resets the flag:
 * the renewal lifts the session override, closes the context, writes the session again and makes
 * a new context, which activates the session for real.
 *
 * The timing comes from the iPhone logs. `visibilitychange` fires about 0.3–0.7 s before iOS makes
 * the app active, and iOS refuses an activation before that, with no retry (build 9). So the
 * renewal waits a second after the return (build 10, proven on two iPhones), or runs at the first
 * touch that comes sooner: a touch reaches only an active app. On a healthy session the renewal
 * costs the sounds in flight and starts the music again.
 */
import { applyAllGains, buildGraph } from "./graph";
import { stopAllNamed } from "./named";
import { stopMusic } from "./playback";
import { hasTouch, writeSession } from "./session";
import { disposeStream } from "./stream";
import type { AudioContextLike, AudioCtx, Config, State } from "./types";
import { removeUnlock, startUnlock } from "./unlock";

/** How long the renewal waits after the return, in real milliseconds. */
const RENEW_DELAY_MS = 1000;

/** The gestures that renew at once: the app is active when a touch arrives. */
const RENEW_EVENTS = ["pointerdown", "touchend"] as const;

/**
 * Makes the one context of the app: the configured factory, the browser's own constructor, or
 * nothing at all, which is a headless run. A renewal calls it again.
 *
 * @param config - The resolved plugin config.
 * @returns The context, or `undefined` where the runtime has no WebAudio.
 */
export function createContext(config: Config): AudioContextLike | undefined {
  if (config.context !== undefined) return config.context();

  const browserContext = globalThis.AudioContext;

  return typeof browserContext === "function" ? new browserContext() : undefined;
}

/**
 * Tells whether a return from the background renews the context: a context exists, WebKit took
 * the session override, the session is not `"playback"` (iOS keeps that one active in the
 * background), and the screen takes touches, which leaves Safari on a Mac out.
 *
 * @param ctx - Domain context of the plugin.
 * @returns True on iOS and iPadOS with an `ambient` or `auto` session.
 */
function canRenew(ctx: AudioCtx): boolean {
  const state = ctx.state;

  return (
    state.context !== undefined &&
    state.session !== undefined &&
    ctx.config.session !== "playback" &&
    hasTouch()
  );
}

/**
 * Schedules the renewal after a return from the background: a second later, or at the first
 * touch before that. A second return replaces the renewal that waits.
 *
 * @param ctx - Domain context of the plugin.
 */
export function scheduleRenewal(ctx: AudioCtx): void {
  const state = ctx.state;

  if (!canRenew(ctx)) return;

  cancelRenewal(state);

  /**
   * Cancels what waits and renews. The timer and the first touch both come here; the first wins.
   */
  const renew = (): void => {
    cancelRenewal(state);
    void renewContext(ctx);
  };

  // A second after the return, or at the first touch before that.
  const timer = setTimeout(renew, RENEW_DELAY_MS);
  const target = typeof globalThis.window === "undefined" ? undefined : globalThis.window;

  if (target !== undefined) {
    for (const type of RENEW_EVENTS) {
      target.addEventListener(type, renew, { once: true, passive: true });
    }
  }

  // One remover for the timer and both listeners.
  state.renewal = (): void => {
    clearTimeout(timer);

    if (target === undefined) return;

    for (const type of RENEW_EVENTS) target.removeEventListener(type, renew);
  };
}

/**
 * Cancels the renewal that waits: the game went to the background again, or the app stops. A
 * renewal that already runs goes on.
 *
 * @param state - The plugin state.
 */
export function cancelRenewal(state: State): void {
  state.renewal?.();
  state.renewal = undefined;
}

/**
 * Drops every sound of the old context and keeps the music key: the track that plays, or the
 * switch on its way. A decode still running on the old context may reject when it closes; such a
 * key is forgotten, so its next play decodes again.
 *
 * @param state - The plugin state.
 */
function dropInFlight(state: State): void {
  const key = state.musicPending?.key ?? state.music?.key;

  stopMusic(state);
  stopAllNamed(state);

  for (const entry of state.retiring) disposeStream(state, entry.stream);

  state.pendingSfx.clear();

  if (key !== undefined) {
    state.music = { key, gain: undefined, source: undefined, stream: undefined };
  }

  for (const [decodedKey, pending] of state.decoded) {
    pending.catch(() => {
      if (state.decoded.get(decodedKey) === pending) state.decoded.delete(decodedKey);
    });
  }
}

/**
 * Renews the context: the old one goes with every sound in it, the session is written again, and
 * a new context gets the graph at the same volumes and the unlock. The decoded buffers stay, an
 * AudioBuffer is bound to no context. The unlock starts the remembered music once the new context
 * runs. While the old context closes the plugin is headless: a sound is dropped and a music switch
 * is remembered. A stop, or a newer renewal, during the close makes this one end there.
 *
 * @param ctx - Domain context of the plugin.
 */
async function renewContext(ctx: AudioCtx): Promise<void> {
  const state = ctx.state;
  const old = state.context;

  if (old === undefined) return;

  // The old context goes, with every sound in it; the plugin is headless until the new one.
  const token = {};

  state.renewing = token;
  removeUnlock(state);
  dropInFlight(state);
  state.context = undefined;
  state.unlocked = false;
  state.resuming = false;
  writeSession(state, "auto");

  // Only a closed last context makes WebKit deactivate the session for real.
  await old.close().catch(ignoreFailure);

  if (state.renewing !== token) return;

  // The session again, then a new context that activates it for real.
  state.renewing = undefined;
  writeSession(state, ctx.config.session);

  const fresh = createContext(ctx.config);

  if (fresh === undefined || fresh === old) {
    ctx.log.warn("audio: no new context after the return, the sound stays off");

    return;
  }

  state.context = fresh;
  state.buses = buildGraph(fresh, state.buses);
  applyAllGains(state);
  startUnlock(ctx);
}

/**
 * Swallows a close that failed. A context the browser already tore down is gone either way, and
 * neither a teardown nor a renewal has anybody to report it to.
 */
export function ignoreFailure(): void {
  // Deliberately empty: a context that does not close is dropped all the same.
}
