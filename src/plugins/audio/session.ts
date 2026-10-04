/**
 * @file audio plugin — the audio session: the only file that touches `navigator`. WebKit puts a
 * page in the Playback category the moment an audible element plays; `navigator.audioSession.type`
 * is the one lever that reaches page audio, in Safari and in Tauri iOS alike. Every other engine
 * has no such object, and then nothing here does anything.
 */
import type { AudioSessionLike, KernelSlice, State } from "./types";

/**
 * Tells whether a value is an audio session the plugin can write: an object with a string `type`.
 *
 * @param value - What `navigator.audioSession` answered.
 * @returns True when the value has a string `type`.
 * @example
 * ```ts
 * isSessionLike({ type: "auto" }); // true
 * ```
 */
function isSessionLike(value: unknown): value is AudioSessionLike {
  return (
    typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"
  );
}

/**
 * Reads `navigator.audioSession`. Plain Bun may have no `navigator`, and Chromium and Firefox have
 * one without `audioSession`.
 *
 * @returns The session, or `undefined` where the runtime has none.
 */
function readSession(): AudioSessionLike | undefined {
  if (typeof globalThis.navigator === "undefined") return undefined;
  if (!("audioSession" in globalThis.navigator)) return undefined;

  const session: unknown = globalThis.navigator.audioSession;

  return isSessionLike(session) ? session : undefined;
}

/**
 * Writes `config.session` on the audio session. `onStart` runs it first, before the context
 * exists and whether or not one is made. A setter that refuses the type is one warning; a runtime
 * without the API is silent.
 *
 * @param ctx - Kernel context of the audio plugin.
 */
export function applySession(ctx: KernelSlice): void {
  const session = readSession();

  if (session === undefined) return;

  const type = ctx.config.session;

  try {
    session.type = type;
  } catch {
    ctx.log.warn("audio: the audio session was refused", { type });

    return;
  }

  ctx.state.session = session;
}

/**
 * Writes `"auto"` back, which removes the override, and forgets the session. A setter that throws
 * now is ignored: a teardown has nobody left to report to.
 *
 * @param state - The plugin state, all a teardown context carries.
 */
export function resetSession(state: State): void {
  const session = state.session;

  if (session === undefined) return;

  state.session = undefined;

  try {
    session.type = "auto";
  } catch {
    // Deliberately empty: the page is going away and the session goes with it.
  }
}
