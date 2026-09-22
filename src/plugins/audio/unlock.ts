/**
 * @file audio plugin — the unlock: the only file that touches `window`. A browser starts every
 * audio context suspended and resumes it on a user gesture, so two listeners wait for the first
 * one. They sit on `window`, not on the canvas: the gesture may as well be a button of the
 * game's loading page, which `input` never sees.
 */
import { playMusic, trackMusic } from "./playback";
import type { AudioCtx, State } from "./types";

/** The two gestures that unlock a context. The first of them to arrive wins. */
const UNLOCK_EVENTS = ["pointerdown", "touchend"] as const;

/**
 * Reacts to a resume that went through. The context is unlocked only when it really runs; the
 * track a scene declared while it was locked starts here.
 *
 * @param ctx - Domain context of the plugin.
 */
function onResumed(ctx: AudioCtx): void {
  const state = ctx.state;

  if (state.context?.state !== "running") {
    installUnlock(ctx);

    return;
  }

  state.unlocked = true;

  const remembered = state.music;

  if (remembered === undefined || remembered.source !== undefined) return;

  trackMusic(ctx, playMusic(ctx, { key: remembered.key, fadeMs: ctx.config.musicFadeMs }));
}

/**
 * Asks the context to run. A browser that refuses says so once in the log and gets the listeners
 * back, so the next gesture tries again.
 *
 * @param ctx - Domain context of the plugin.
 */
function resumeContext(ctx: AudioCtx): void {
  const context = ctx.state.context;

  if (context === undefined) return;

  context.resume().then(
    () => {
      onResumed(ctx);
    },
    () => {
      ctx.log.warn("audio: the context did not resume");
      installUnlock(ctx);
    }
  );
}

/**
 * Installs the two unlock listeners on `window`. Without a DOM there is nothing to listen on and
 * the context stays locked for the whole run, which is what a headless game wants.
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
