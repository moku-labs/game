/**
 * @file Merge kit — time catch-up. The moment arrives as an input, never from the device.
 */
import type { EnergyRule, GeneratorTable, MergeState, Tables } from "./types";

/**
 * Catches one energy bar up to `now`. One point is earned per `regenMs`; the bar never rises
 * above its own `max`, and `countedAt` advances by whole periods only, so the leftover part of a
 * period is carried over instead of being lost. A full bar collects nothing and simply moves its
 * moment to `now`. A `now` earlier than `countedAt` is the device clock moving back: zero elapsed,
 * nothing changes. The cap is the bar's own `max`, the player's cap; `rule.max` is the cap a new
 * player starts with.
 *
 * @param energy - The energy branch of the rule state; it is not mutated.
 * @param now - The current moment in integer milliseconds.
 * @param rule - The energy rule; only its period is read here.
 * @returns The energy branch as of `now`.
 * @example
 * ```ts
 * const energy = applyEnergyRegen(state.energy, now, tables.energy);
 * ```
 */
export function applyEnergyRegen(
  energy: MergeState["energy"],
  now: number,
  rule: EnergyRule
): MergeState["energy"] {
  const elapsed = now - energy.countedAt;

  // No time passed, or the device clock moved back: nothing is owed.
  if (elapsed <= 0) return energy;

  // A full bar collects nothing; the next point starts counting from now.
  if (energy.value >= energy.max) return { ...energy, countedAt: now };

  // A rule without a positive period never regenerates, but time still moves on.
  if (rule.regenMs <= 0) return { ...energy, countedAt: now };

  const gained = Math.floor(elapsed / rule.regenMs);
  if (gained === 0) return energy;

  const value = Math.min(energy.max, energy.value + gained);

  // Keep the remainder unless the bar filled up, so no fraction of a point is ever lost.
  const moment = value >= energy.max ? now : energy.countedAt + gained * rule.regenMs;

  return { ...energy, value, countedAt: moment };
}

/**
 * Catches one generator up to `now`. A generator refills only after it ran out: with no charge
 * left and its cooldown ended it goes back to `maxCharges`. A generator the table does not know
 * is left exactly as the save holds it.
 *
 * @param generator - The saved charges and wake-up moment of one generator.
 * @param now - The current moment in integer milliseconds.
 * @param maxCharges - The charges the generator refills to, or `undefined` when it has no table entry.
 * @returns The generator as of `now`.
 * @example
 * ```ts
 * const sawmill = rechargeGenerator(state.generators.sawmill, now, 5);
 * ```
 */
function rechargeGenerator(
  generator: MergeState["generators"][string],
  now: number,
  maxCharges: number | undefined
): MergeState["generators"][string] {
  const spent = generator.charges === 0;
  const cooled = now >= generator.readyAt;

  if (!spent || !cooled || maxCharges === undefined) return generator;

  return { ...generator, charges: maxCharges };
}

/**
 * Catches every saved generator up to `now`.
 *
 * @param generators - The generator branch of the rule state; it is not mutated.
 * @param now - The current moment in integer milliseconds.
 * @param table - The generator table; it gives the charges each generator refills to.
 * @returns A new generator branch as of `now`.
 * @example
 * ```ts
 * const generators = rechargeGenerators(state.generators, now, tables.generators);
 * ```
 */
function rechargeGenerators(
  generators: MergeState["generators"],
  now: number,
  table: GeneratorTable
): MergeState["generators"] {
  const next: MergeState["generators"] = {};

  for (const [id, generator] of Object.entries(generators)) {
    next[id] = rechargeGenerator(generator, now, table[id]?.maxCharges);
  }

  return next;
}

/**
 * Catches the whole rule state up to `now`: energy regeneration and generator recharge, read
 * from the moments the save holds. It is the one place where stored time turns into state, so a
 * game that was closed for a day and one that ran all day end up equal.
 *
 * @param state - The rule state; it is not mutated.
 * @param now - The current moment in integer milliseconds.
 * @param tables - The content tables; they give the energy rule and the generator charges.
 * @returns A new state as of `now`.
 * @example
 * ```ts
 * const caughtUp = elapse(player.merge, now, tables);
 * ```
 */
export function elapse(state: MergeState, now: number, tables: Tables): MergeState {
  return {
    ...state,
    energy: applyEnergyRegen(state.energy, now, tables.energy),
    generators: rechargeGenerators(state.generators, now, tables.generators)
  };
}

/**
 * Returns the nearest moment at which `elapse` changes the state, or `undefined` when nothing is
 * pending. Two timer kinds feed it, and every kind `elapse` handles appears here: the next energy
 * point, counted only while the bar has room and the rule has a period, and the wake-up moment of
 * every generator that has no charge left. The moments come from the save, so a moment that has
 * already passed means `elapse` has work to do right now.
 *
 * @param state - The rule state to read.
 * @param tables - The content tables; they give the energy period.
 * @returns The nearest pending moment in integer milliseconds, or `undefined`.
 * @example
 * ```ts
 * const due = nextDue(player.merge, tables);
 * if (due !== undefined) wakeAt(due);
 * ```
 */
export function nextDue(state: MergeState, tables: Tables): number | undefined {
  const moments: number[] = [];

  // Timer kind 1: the energy bar ticks while it has room.
  if (state.energy.value < state.energy.max && tables.energy.regenMs > 0) {
    moments.push(state.energy.countedAt + tables.energy.regenMs);
  }

  // Timer kind 2: a generator that ran out wakes up at its own moment. Only a generator `elapse`
  // can recharge counts: a due moment that changes nothing would wake the clock in a loop.
  for (const [id, generator] of Object.entries(state.generators)) {
    const maxCharges = tables.generators[id]?.maxCharges ?? 0;
    if (generator.charges === 0 && maxCharges > 0) moments.push(generator.readyAt);
  }

  return moments.length === 0 ? undefined : Math.min(...moments);
}
