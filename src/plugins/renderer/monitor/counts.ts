/**
 * @file renderer/monitor — the live object counts of an agent build (U3): the world's entities, the views of `sync`,
 * the clock's timers and listeners and the frame callbacks of `time`, read through the renderer's own dependencies,
 * and the counts of the plugins the renderer cannot depend on, pushed into a table of 16 with
 * `monitor.counts.register`. Read once a second, at the flush, and by `stats()`: never per frame.
 */
import type { PerfCounts } from "./log-types";
import { COUNT_SLOTS } from "./state";
import type { CountTable, PerfCtx } from "./types";

/** `PerfCounts` while it is filled in. */
type CountsDraft = { -readonly [Name in keyof PerfCounts]: PerfCounts[Name] };

/**
 * The error of a register when the table is full.
 *
 * @returns The error.
 */
function fullTable(): Error {
  return new Error(
    `[game] Monitor count table is full (${COUNT_SLOTS}).\n  Remove a registered count or raise the table size.`
  );
}

/**
 * Registers a count, or gives a registered name its new reader.
 *
 * @param table - The count table.
 * @param name - The count's name.
 * @param read - Answers the count now.
 * @returns The remover; a second call, or a call after the name got another reader, does nothing.
 * @throws {Error} When the table holds `COUNT_SLOTS` other counts.
 */
export function registerCount(table: CountTable, name: string, read: () => number): () => void {
  const at = table.names.indexOf(name);

  if (at !== -1) table.reads[at] = read;
  else if (table.names.length >= COUNT_SLOTS) throw fullTable();
  else {
    table.names.push(name);
    table.reads.push(read);
  }

  return (): void => {
    const index = table.names.indexOf(name);

    if (index === -1 || table.reads[index] !== read) return;

    table.names.splice(index, 1);
    table.reads.splice(index, 1);
  };
}

/**
 * Forgets every registered count: the renderer stopped.
 *
 * @param table - The count table.
 */
export function clearCounts(table: CountTable): void {
  table.names.length = 0;
  table.reads.length = 0;
  table.failed.clear();
}

/**
 * The live object counts now: the five the renderer reads itself, then each registered count by its name. A reader
 * that throws is left out and warned about once.
 *
 * @param pc - The perf context.
 * @returns A fresh object.
 */
export function readCounts(pc: PerfCtx): PerfCounts {
  const { world, clock, time } = pc.ctx.deps;
  const table = pc.perf.counts;
  const counts: CountsDraft = {
    entities: world.ecs.count(),
    views: pc.ctx.state.sync.views.size,
    timers: clock.pending(),
    frameListeners: time.frameListeners(),
    clockListeners: clock.listeners()
  };

  for (let index = 0; index < table.names.length; index += 1) {
    const name = table.names[index] ?? "";

    try {
      counts[name] = table.reads[index]?.() ?? 0;
    } catch (error) {
      if (!table.failed.has(name)) {
        table.failed.add(name);
        pc.ctx.log.warn("renderer: a monitor count failed", { name, error });
      }
    }
  }

  return counts;
}
