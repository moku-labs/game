/**
 * @file audio plugin — the gain graph and the only file that schedules on the context clock. A
 * fade runs here, never on `time`: a paused game must not freeze a fade-out, and a fade is not
 * game state.
 */
import type { AudioContextLike, Bus, BusState, State } from "./types";

/**
 * Schedules a value on one gain: the value it has now, then a linear ramp to the target. With
 * `seconds` at 0 the ramp lands at the same moment, which is how a volume change and a mute are
 * scheduled.
 *
 * @param gain - The gain node to schedule on.
 * @param to - The target value, 0..1.
 * @param seconds - How long the ramp takes, in seconds of the context clock.
 * @param now - The current time of the context clock.
 */
export function ramp(gain: GainNode, to: number, seconds: number, now: number): void {
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(to, now + seconds);
}

/**
 * The gain one bus should have: its volume, or silence while it is muted or the game is paused.
 *
 * @param bus - What the plugin keeps for that bus.
 * @param paused - Whether a lifecycle push is in force.
 * @returns The effective gain, 0..1.
 * @example
 * ```ts
 * effectiveGain({ gain: undefined, volume: 0.6, muted: true }, false); // 0
 * ```
 */
export function effectiveGain(bus: BusState, paused: boolean): number {
  return bus.muted || paused ? 0 : bus.volume;
}

/**
 * Builds the graph of one app: `master` into the destination, `music` and `sfx` into `master`.
 * The volumes and mutes the buses already carry are kept, so a value set before the context
 * existed is not lost.
 *
 * @param context - The audio context of this app.
 * @param buses - What the plugin keeps for the three buses.
 * @returns The same three buses, each with its gain node.
 */
export function buildGraph(
  context: AudioContextLike,
  buses: Record<Bus, BusState>
): Record<Bus, BusState> {
  const master = context.createGain();
  const music = context.createGain();
  const sfx = context.createGain();

  master.connect(context.destination);
  music.connect(master);
  sfx.connect(master);

  return {
    master: { ...buses.master, gain: master },
    music: { ...buses.music, gain: music },
    sfx: { ...buses.sfx, gain: sfx }
  };
}

/**
 * Schedules the effective gain of one bus. Headless, and before the graph exists, it does
 * nothing: the value is already stored and the next `buildGraph` carries it.
 *
 * @param state - The plugin state.
 * @param bus - The bus to apply.
 * @param seconds - How long the ramp takes. 0 for a volume change, a mute and a pause.
 */
export function applyGain(state: State, bus: Bus, seconds = 0): void {
  const context = state.context;
  const entry = state.buses[bus];

  if (context === undefined || entry.gain === undefined) return;

  ramp(entry.gain, effectiveGain(entry, state.paused), seconds, context.currentTime);
}

/**
 * Tells whether a name is one of the three buses. Every entry point that takes a bus from outside
 * the types — a descriptor of another plugin, the player state, a call from untyped code — asks
 * here first.
 *
 * @param state - The plugin state, which carries the three buses.
 * @param bus - The name to check.
 * @returns True when the plugin has that bus.
 */
export function isBus(state: State, bus: string): bus is Bus {
  return Object.hasOwn(state.buses, bus);
}

/**
 * Schedules the effective gain of all three buses. The unlock, a pause and a resume end here.
 *
 * @param state - The plugin state.
 */
export function applyAllGains(state: State): void {
  applyGain(state, "master");
  applyGain(state, "music");
  applyGain(state, "sfx");
}
