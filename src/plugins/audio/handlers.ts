/**
 * @file audio plugin — the five hooks. They are the whole of what drives this plugin: the player
 * sets the volumes, the graph sets the music, the OS sets the pause, and the budget and a dev hot
 * swap set what is still decoded.
 */
import { setBusVolume } from "./api";
import { applyAllGains, isBus } from "./graph";
import { withDeps } from "./lifecycle";
import { pauseMusic, playMusic, resumeMusic, trackMusic } from "./playback";
import type {
  AssetsReplaced,
  AudioCtx,
  BundleUnloaded,
  Bus,
  KernelSlice,
  LifecycleChanged,
  ModelCommitted,
  SceneChanged,
  State,
  Volumes
} from "./types";
import { installUnlock } from "./unlock";

/**
 * Applies the volumes of the committed player. A `volumes` that throws — a save without the
 * settings branch, a migration that has not run — is reported once and then left alone.
 *
 * @param ctx - Domain context of the plugin.
 */
function applyVolumes(ctx: AudioCtx): void {
  const volumes = ctx.config.volumes;

  if (volumes === undefined) return;

  const chosen = read(ctx, volumes);

  if (chosen === undefined) return;

  for (const [bus, value] of Object.entries(chosen)) {
    if (typeof value !== "number" || !isBus(ctx.state, bus)) continue;

    setBusVolume(ctx.state, bus, value);
  }
}

/**
 * Runs the `volumes` function of the game over the committed player.
 *
 * @param ctx - Domain context of the plugin.
 * @param volumes - The function the game configured.
 * @returns What it answered, or `undefined` when it threw.
 */
function read(ctx: AudioCtx, volumes: Volumes): Partial<Record<Bus, number>> | undefined {
  try {
    return volumes(ctx.deps.model.store.snapshot().player);
  } catch {
    if (!ctx.state.warnedVolumes) {
      ctx.state.warnedVolumes = true;
      ctx.log.warn("audio: the volumes function failed");
    }

    return;
  }
}

/**
 * Resumes a context the OS silenced while the game was away. Safari leaves it `"interrupted"`
 * after a call; a refused resume puts the unlock listeners back, so the next touch tries again.
 *
 * @param ctx - Domain context of the plugin.
 */
function resumeAfterPause(ctx: AudioCtx): void {
  const context = ctx.state.context;

  if (context === undefined || !ctx.state.unlocked) return;
  if (context.state !== "suspended" && context.state !== "interrupted") return;

  context.resume().catch(() => {
    installUnlock(ctx);
  });
}

/**
 * Forgets the decoded buffer and the one warning of every key named. A key that is no sound is in
 * neither, so it costs nothing. A source that is playing holds its own buffer and plays on.
 *
 * @param state - The plugin state.
 * @param keys - Asset keys whose bytes left or changed.
 */
function evict(state: State, keys: readonly string[]): void {
  for (const key of keys) {
    state.decoded.delete(key);
    state.warned.delete(key);
  }
}

/**
 * Creates the five hook handlers. Each one builds the domain context when it first fires, not
 * while this factory runs: the kernel registers hooks before it builds the plugin APIs, so
 * nothing is resolvable yet.
 *
 * @param ctx - Kernel context of the audio plugin.
 * @returns The five hooks of the plugin.
 */
export function createHandlers(ctx: KernelSlice): {
  "model:committed": (payload: ModelCommitted) => void;
  "scenes:changed": (payload: SceneChanged) => void;
  "lifecycle:changed": (payload: LifecycleChanged) => void;
  "assets:bundle-unloaded": (payload: BundleUnloaded) => void;
  "assets:replaced": (payload: AssetsReplaced) => void;
} {
  let audio: AudioCtx | undefined;

  /**
   * The domain context, built on the first hook that fires.
   *
   * @returns The domain context of the plugin.
   */
  const domain = (): AudioCtx => {
    audio ??= withDeps(ctx);

    return audio;
  };

  return {
    /**
     * Applies the volumes the player committed. A commit is not a hot loop: three schedules.
     *
     * @param _payload - What the commit touched. The values come from the snapshot.
     */
    "model:committed": (_payload: ModelCommitted): void => {
      applyVolumes(domain());
    },

    /**
     * Switches the music to the track the next scene declared. A scene that declares none keeps
     * the track that plays. The switch is tracked, never awaited: a hook is synchronous.
     *
     * @param payload - The scene that was entered and the music it declared.
     */
    "scenes:changed": (payload: SceneChanged): void => {
      const audioCtx = domain();
      // eslint-disable-next-line unicorn/no-null -- `null` is the seam: it stops the music.
      const key = payload.music ?? audioCtx.state.music?.key ?? null;

      trackMusic(audioCtx, playMusic(audioCtx, { key, fadeMs: audioCtx.config.musicFadeMs }));
    },

    /**
     * Holds every bus at zero while the game is paused and puts the volumes back when it is not.
     * The stored volumes and mutes are untouched, so nothing is lost over a pause. A streamed
     * track is paused once the gains are at zero and plays again when the pause ends.
     *
     * @param payload - What changed on the pause stack.
     */
    "lifecycle:changed": (payload: LifecycleChanged): void => {
      const audioCtx = domain();

      audioCtx.state.paused = payload.paused;
      applyAllGains(audioCtx.state);

      if (payload.paused) pauseMusic(audioCtx.state);

      if (payload.resumed) {
        resumeAfterPause(audioCtx);
        resumeMusic(audioCtx);
      }
    },

    /**
     * Drops the decoded sounds of a bundle that left. A source that is playing keeps its buffer
     * and a streamed track keeps its Blob, which copied the bytes; the next play of an evicted
     * key decodes again once the bundle is back.
     *
     * @param payload - The bundle that left and the keys it carried.
     */
    "assets:bundle-unloaded": (payload: BundleUnloaded): void => {
      evict(domain().state, payload.keys);
    },

    /**
     * Drops the decoded sounds a dev hot swap replaced: `assets.audio(key)` already answers the
     * new bytes, so the next play of a key decodes them. Nothing that is playing is stopped: a
     * source keeps the buffer it started with and a streamed track keeps its Blob.
     *
     * @param payload - The bundle whose files were replaced and the keys with new bytes.
     */
    "assets:replaced": (payload: AssetsReplaced): void => {
      evict(domain().state, payload.keys);
    }
  };
}
