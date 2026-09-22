/**
 * @file audio plugin — lifecycle: the dependency resolution, the one context of the app with its
 * graph and its unlock, and the teardown that frees exactly what was opened.
 */
import { assetsPlugin } from "../assets";
import { flowPlugin } from "../flow";
import { modelPlugin } from "../model";
import { applyAllGains, buildGraph } from "./graph";
import { musicOf, playMusic, playSfx, stopMusic } from "./playback";
import type { AudioContextLike, AudioCtx, Config, Deps, KernelSlice, State } from "./types";
import { installUnlock, removeUnlock } from "./unlock";

/**
 * Resolves the dependency APIs `flow`, `assets` and `model` with `ctx.require`. `lifecycle` and
 * `scenes` are dependencies too, but only for their typed hooks: the plugin calls neither.
 *
 * @param ctx - Kernel context of the audio plugin.
 * @returns The three dependency APIs.
 */
export function resolveDeps(ctx: KernelSlice): Deps {
  return {
    flow: ctx.require(flowPlugin),
    assets: ctx.require(assetsPlugin),
    model: ctx.require(modelPlugin)
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
 * Swallows a close that failed. A context the browser already tore down is gone either way, and
 * a teardown has nobody left to report to.
 */
function ignoreFailure(): void {
  // Deliberately empty: there is no caller left to hand the failure to.
}

/**
 * Makes the one context of the app: the configured factory, the browser's own constructor, or
 * nothing at all, which is a headless run.
 *
 * @param config - The resolved plugin config.
 * @returns The context, or `undefined` where the runtime has no WebAudio.
 */
function createContext(config: Config): AudioContextLike | undefined {
  if (config.context !== undefined) return config.context();

  const browserContext = globalThis.AudioContext;

  return typeof browserContext === "function" ? new browserContext() : undefined;
}

/**
 * Starts the plugin in `onStart`: both effect handlers, then the context with its graph and its
 * unlock. The handlers are registered even headless, so a node that awaits a sound resolves in
 * plain Bun exactly as it does in a browser.
 *
 * @param ctx - Kernel context of the audio plugin.
 */
export function startAudio(ctx: KernelSlice): void {
  const audio = withDeps(ctx);
  const state = audio.state;
  const fx = audio.deps.flow.fx;

  state.removers.push(
    fx.handle("sfx", descriptor => playSfx(audio, descriptor), { runInFast: false }),
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
  installUnlock(audio);
}

/**
 * Frees everything `onStart` opened: the two handler registrations, the two window listeners, the
 * music source and the context itself. A browser caps how many contexts a page may hold, so the
 * close is the point of this teardown.
 *
 * @param state - The plugin state, all a teardown context carries.
 * @returns A promise that resolves when the context is closed.
 */
export async function stopAudio(state: State): Promise<void> {
  for (const remove of state.removers.splice(0)) remove();

  removeUnlock(state);
  stopMusic(state);
  state.decoded.clear();
  state.unlocked = false;

  const context = state.context;

  state.context = undefined;

  await context?.close().catch(ignoreFailure);
}
