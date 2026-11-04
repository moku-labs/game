/**
 * @file audio plugin — lifecycle: the dependency resolution, the start that puts the context of
 * `context.ts` in with its graph and its unlock, and the teardown that frees exactly what was opened.
 */
import { assetsPlugin } from "../assets";
import { flowPlugin } from "../flow";
import { modelPlugin } from "../model";
import { timePlugin } from "../time";
import { cancelRenewal, createContext, ignoreFailure } from "./context";
import { applyAllGains, buildGraph } from "./graph";
import { stopAllNamed } from "./named";
import { musicOf, playMusic, playSfx, stopMusic, stopNamedSfx } from "./playback";
import { applySession, resetSession } from "./session";
import { disposeStream } from "./stream";
import type { AudioCtx, Deps, KernelSlice, State } from "./types";
import { removeUnlock, startUnlock } from "./unlock";

/**
 * Resolves the dependency APIs `flow`, `assets`, `model` and `time` with `ctx.require`.
 * `lifecycle` and `scenes` are dependencies too, but only for their typed hooks: the plugin calls
 * neither.
 *
 * @param ctx - Kernel context of the audio plugin.
 * @returns The four dependency APIs.
 */
export function resolveDeps(ctx: KernelSlice): Deps {
  return {
    flow: ctx.require(flowPlugin),
    assets: ctx.require(assetsPlugin),
    model: ctx.require(modelPlugin),
    time: ctx.require(timePlugin)
  };
}

/**
 * Builds the domain context the handlers, the playback and the unlock share.
 *
 * @param ctx - Kernel context of the audio plugin.
 * @returns The domain context of the audio plugin.
 */
export function withDeps(ctx: KernelSlice): AudioCtx {
  return { ...ctx, deps: resolveDeps(ctx) };
}

/**
 * Starts the plugin in `onStart`: the audio session first, before any sound exists, then the
 * three effect handlers, then the context with its graph and its unlock. The unlock asks the
 * context to run at once: a shell that lets audio play is unlocked with no touch, and a browser
 * that wants a gesture gets the two listeners. The handlers are registered even headless, so a node that
 * awaits a sound resolves in plain Bun exactly as it does in a browser.
 *
 * @param ctx - Kernel context of the audio plugin.
 */
export function startAudio(ctx: KernelSlice): void {
  applySession(ctx);

  const audio = withDeps(ctx);
  const state = audio.state;
  const fx = audio.deps.flow.fx;

  state.removers.push(
    fx.handle("sfx", descriptor => playSfx(audio, descriptor), { runInFast: false }),
    fx.handle("stopSfx", descriptor => stopNamedSfx(audio, descriptor), { runInFast: false }),
    fx.handle(
      "music",
      descriptor => playMusic(audio, musicOf(descriptor, ctx.config.musicFadeMs)),
      {
        runInFast: false
      }
    )
  );

  const context = createContext(ctx.config);

  if (context === undefined) return;

  state.context = context;
  state.buses = buildGraph(context, state.buses);
  applyAllGains(state);
  startUnlock(audio);
}

/**
 * Frees everything `onStart` opened: the three handler registrations, the two window listeners,
 * a renewal that waits or runs, the music track, every named sound, every streamed track still
 * fading with its timer, the journal, the audio session and the context itself. The tracks are
 * freed before the close, while their nodes can still disconnect. A browser caps how many
 * contexts a page may hold, so the close is the point of this teardown.
 *
 * @param state - The plugin state, all a teardown context carries.
 * @returns A promise that resolves when the context is closed.
 */
export async function stopAudio(state: State): Promise<void> {
  for (const remove of state.removers.splice(0)) remove();

  cancelRenewal(state);
  state.renewing = undefined;
  removeUnlock(state);
  stopMusic(state);
  stopAllNamed(state);

  for (const entry of state.retiring) disposeStream(state, entry.stream);

  state.decoded.clear();
  state.journal = Object.freeze([]);
  state.unlocked = false;
  resetSession(state);

  const context = state.context;

  state.context = undefined;

  await context?.close().catch(ignoreFailure);
}
