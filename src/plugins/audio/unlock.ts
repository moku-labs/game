/**
 * @file audio plugin — the unlock: the only file that touches `window`. A browser starts an audio
 * context suspended and lets it run on a user gesture, so two listeners wait for the first one.
 * They sit on `window`, not on the canvas: the gesture may as well be a button of the game's
 * loading page, which `input` never sees. A shell that asks for no gesture, such as a native
 * webview with the requirement switched off, lets the context run at once. So the plugin also
 * asks once at start, and unlocks with no touch where the answer is yes.
 */
import { isMusicPlaying, playMusic, playRequest, trackMusic } from "./playback";
import type { AudioContextLike, AudioCtx, State } from "./types";

/** The two gestures that unlock a context. The first of them to arrive wins. */
const UNLOCK_EVENTS = ["pointerdown", "touchend"] as const;

/**
 * Reacts to a resume that went through, of a gesture or of the start attempt. The context is
 * unlocked only when it really runs; the sounds fired during the resume and the track a scene
 * declared while it was locked start here. A context that still does not run drops the sounds:
 * the next gesture is a new moment. A gesture and the start attempt that settle together both
 * come here, and the music still starts once: a track that is on its way or already plays is not
 * started again. A later gesture on an unlocked context tries a remembered track again.
 *
 * @param ctx - Domain context of the plugin.
 */
function onResumed(ctx: AudioCtx): void {
  const state = ctx.state;

  state.resuming = false;

  if (state.context?.state !== "running") {
    state.pendingSfx.clear();
    installUnlock(ctx);

    return;
  }

  state.unlocked = true;
  drainSfx(ctx);

  const remembered = state.music;

  if (remembered === undefined || isMusicPlaying(state)) return;

  trackMusic(ctx, playMusic(ctx, { key: remembered.key, fadeMs: ctx.config.musicFadeMs }));
}

/**
 * Plays every sound that waited for the resume, in the order they were first fired, and empties
 * the queue.
 *
 * @param ctx - Domain context of the plugin.
 */
function drainSfx(ctx: AudioCtx): void {
  const queued = [...ctx.state.pendingSfx.values()];

  ctx.state.pendingSfx.clear();

  for (const request of queued) void playRequest(ctx, request);
}

/**
 * Asks the context to run and marks it `resuming` until the answer comes. A browser that refuses
 * says so once in the log, drops the sounds that waited and gets the listeners back, so the next
 * gesture tries again.
 *
 * @param ctx - Domain context of the plugin.
 */
function resumeContext(ctx: AudioCtx): void {
  const context = ctx.state.context;

  if (context === undefined) return;

  ctx.state.resuming = true;
  context.resume().then(
    () => {
      onResumed(ctx);
    },
    () => {
      ctx.state.resuming = false;
      ctx.state.pendingSfx.clear();
      ctx.log.warn("audio: the context did not resume");
      installUnlock(ctx);
    }
  );
}

/**
 * Reacts to the start attempt that fulfilled. Nothing happens when the app stopped meanwhile, when
 * a gesture already unlocked the context, or when the context still does not run: the listeners
 * are there for that. Otherwise the listeners go and the context is unlocked the way a gesture
 * unlocks it.
 *
 * @param ctx - Domain context of the plugin.
 * @param context - The context the attempt was made on.
 */
function onStartResumed(ctx: AudioCtx, context: AudioContextLike): void {
  const state = ctx.state;

  if (state.context !== context || state.unlocked || context.state !== "running") return;

  removeUnlock(state);
  onResumed(ctx);
}

/**
 * Leaves a refused start attempt alone. Nobody asked for sound yet, so there is nothing to report,
 * and the listeners are installed: the first gesture asks again.
 */
function ignoreRefusal(): void {
  // Deliberately empty: the unlock listeners are the answer to a refused start attempt.
}

/**
 * Unlocks the context in `onStart` where the shell lets audio play, and waits for a gesture where
 * it does not. A context that already runs is unlocked at once, with no listener. Any other gets
 * the two listeners and one `resume()`. `resuming` is not set for it: a browser that wants a
 * gesture leaves that promise pending, and a sound must not queue behind a promise that may never
 * settle. The attempt needs no `window`, so it also serves a context given through
 * `config.context` in a runtime without a DOM.
 *
 * @param ctx - Domain context of the plugin.
 */
export function startUnlock(ctx: AudioCtx): void {
  const context = ctx.state.context;

  if (context === undefined) return;

  if (context.state === "running") {
    onResumed(ctx);

    return;
  }

  installUnlock(ctx);
  context.resume().then(() => {
    onStartResumed(ctx, context);
  }, ignoreRefusal);
}

/**
 * Installs the two unlock listeners on `window`. Without a DOM there is nothing to listen on:
 * the context stays locked unless the start attempt of `startUnlock` runs it.
 *
 * @param ctx - Domain context of the plugin.
 */
export function installUnlock(ctx: AudioCtx): void {
  if (typeof globalThis.window === "undefined") return;

  const state = ctx.state;
  const target = globalThis.window;

  removeUnlock(state);

  /**
   * Takes both listeners off and resumes the context. Whichever gesture arrives first runs it.
   */
  const onGesture = (): void => {
    removeUnlock(state);
    resumeContext(ctx);
  };

  for (const type of UNLOCK_EVENTS) {
    target.addEventListener(type, onGesture, { once: true, passive: true });
  }

  state.unlock = (): void => {
    for (const type of UNLOCK_EVENTS) target.removeEventListener(type, onGesture);
  };
}

/**
 * Takes the unlock listeners off. It is what the first gesture, a second install and `onStop`
 * all call, so the plugin never leaves a listener behind.
 *
 * @param state - The plugin state.
 */
export function removeUnlock(state: State): void {
  state.unlock?.();
  state.unlock = undefined;
}
