/**
 * @file audio plugin — API factory. Four members: three buses and the unlock flag. Nothing here
 * is persisted; a game keeps the player's choice in the player state and `config.volumes` applies
 * it on the next commit.
 */
import { applyGain, isBus } from "./graph";
import type { AudioApi, Bus, KernelSlice, State } from "./types";

/**
 * Brings a value into 0..1. `NaN`, which is what a slider divided by zero produces, becomes 0.
 *
 * @param value - The value a caller asked for.
 * @returns The value, clamped.
 * @example
 * ```ts
 * clamp(1.4); // 1
 * clamp(Number.NaN); // 0
 * ```
 */
function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;

  return Math.min(1, Math.max(0, value));
}

/**
 * Checks a bus name that came from outside the types: an untyped call, or the player state.
 *
 * @param state - The plugin state.
 * @param bus - The bus name to check.
 * @returns The bus.
 * @throws {Error} When the plugin has no such bus.
 */
function busOf(state: State, bus: string): Bus {
  if (!isBus(state, bus)) {
    throw new Error(`[game] Audio bus "${bus}" does not exist.\n  Use "master", "music" or "sfx".`);
  }

  return bus;
}

/**
 * Stores the volume of one bus and schedules it. `setVolume` and the `model:committed` hook both
 * go through here, so the player's saved choice is clamped exactly like a call from a dev tool.
 *
 * @param state - The plugin state.
 * @param bus - The bus to change.
 * @param value - The new volume; clamped to 0..1.
 */
export function setBusVolume(state: State, bus: Bus, value: number): void {
  state.buses[bus].volume = clamp(value);
  applyGain(state, bus);
}

/**
 * Creates the audio API: the three buses and the unlock flag.
 *
 * @param ctx - Kernel context of the audio plugin.
 * @returns The plugin API.
 */
export function createAudioApi(ctx: KernelSlice): AudioApi {
  const state = ctx.state;

  return {
    setVolume: (bus: Bus, value: number): void => setBusVolume(state, busOf(state, bus), value),
    volume: (bus: Bus): number => state.buses[busOf(state, bus)].volume,
    mute: (bus: Bus, on: boolean): void => {
      const checked = busOf(state, bus);

      state.buses[checked].muted = on;
      applyGain(state, checked);
    },
    unlocked: (): boolean => state.unlocked
  };
}
