/**
 * @file renderer/monitor — the switchable sections of the monitor of an agent build (spec 11 R14): the frozen answer
 * of `monitor.sections()`, the bits the commit and the counting classes test inline, and the lists the header and a
 * `sections` event carry. A switch is rare and allocates; a read answers the one frozen object. The switch itself is in
 * `perf.ts`, beside the other writes of the log.
 */
import { MONITOR_SECTIONS, type MonitorSections } from "./log-types";
import type { MonitorSinks } from "./types";

/** Every section on: what a monitor starts with unless its config switches one off. */
export const ALL_SECTIONS: Readonly<MonitorSections> = Object.freeze({
  gpu: true,
  passes: true,
  shaders: true,
  problems: true,
  memory: true,
  systems: true,
  nodes: true,
  longFrames: true
});

/**
 * The sections after a switch: each section `next` names with a boolean takes it, the rest keep theirs. Anything else
 * a caller passes (a name the monitor has not, a value that is no boolean) is left out.
 *
 * @param base - The sections now.
 * @param next - The switches asked for; `undefined` for none.
 * @returns The sections, frozen; `base` itself when nothing differs.
 */
export function switched(
  base: Readonly<MonitorSections>,
  next: Partial<MonitorSections> | undefined
): Readonly<MonitorSections> {
  if (next === undefined) return base;

  const sections: MonitorSections = { ...base };
  let changed = false;

  for (const section of MONITOR_SECTIONS) {
    const value: unknown = next[section];

    if (typeof value === "boolean" && value !== base[section]) {
      sections[section] = value;
      changed = true;
    }
  }

  return changed ? Object.freeze(sections) : base;
}

/**
 * The bits of the sections that are on: `1 << index` for `MONITOR_SECTIONS[index]`, as `SECTION` names them.
 *
 * @param sections - The sections.
 * @returns The bits.
 * @example
 * ```ts
 * bitsOf({ ...ALL_SECTIONS, passes: false }); // 253
 * ```
 */
export function bitsOf(sections: Readonly<MonitorSections>): number {
  let bits = 0;

  for (const [index, section] of MONITOR_SECTIONS.entries()) {
    if (sections[section]) bits |= 1 << index;
  }

  return bits;
}

/**
 * The sections on and off, in the order of `MONITOR_SECTIONS`: the header's `sections` and a `sections` event's detail.
 *
 * @param sections - The sections.
 * @returns Two fresh lists.
 * @example
 * ```ts
 * listsOf({ ...ALL_SECTIONS, memory: false }).off; // ["memory"]
 * ```
 */
export function listsOf(sections: Readonly<MonitorSections>): {
  on: (keyof MonitorSections)[];
  off: (keyof MonitorSections)[];
} {
  return {
    on: MONITOR_SECTIONS.filter(section => sections[section]),
    off: MONITOR_SECTIONS.filter(section => !sections[section])
  };
}

/**
 * Tells whether a section runs in the frame now: its bit of the sinks' sections.
 *
 * @param sinks - The sinks.
 * @param section - The section's `SECTION` bit.
 * @returns True while it is on.
 */
export function sectionOn(sinks: MonitorSinks, section: number): boolean {
  return (sinks.sections & section) !== 0;
}
