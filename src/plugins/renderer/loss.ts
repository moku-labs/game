/**
 * @file renderer plugin — what a lost GPU device leaves behind (F189). The textures whose decoded image was freed
 * after their upload (`sync/release.ts`) cannot be uploaded again, so a loss with freed textures reloads the page;
 * the save is flushed on `pagehide`. Every loss, with or without a reload, is logged and kept in `localStorage`
 * under `moku-game:gpu-losses` (the last ten), and the next start logs each one it has not reported yet, so a loss
 * on a phone is read after the reload: in the log the editor shows, or in the page's storage. A plain module of the
 * plugin root, as `sources.ts`.
 */
import type { LossInfo } from "./host/types";
import type { RendererCtx } from "./types";

/** The `localStorage` key of the kept records. */
export const LOSS_KEY = "moku-game:gpu-losses";

/** How many records are kept: the newest ones. */
const KEPT = 10;

/** Bytes in a megabyte. */
export const BYTES_PER_MB = 1_048_576;

/** Milliseconds in a second. */
export const MS_PER_S = 1000;

/**
 * Rounds to one decimal.
 *
 * @param value - A number.
 * @returns The number to one decimal.
 * @example
 * ```ts
 * tenth(12.345); // 12.3
 * ```
 */
export function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Seconds since the page started: the wall clock against the page's time origin.
 *
 * @param now - The wall clock in milliseconds.
 * @returns The seconds, to one decimal; 0 where the page has no time origin.
 */
export function uptimeOf(now: number): number {
  const origin = globalThis.performance?.timeOrigin;

  return origin === undefined ? 0 : tenth((now - origin) / MS_PER_S);
}

/**
 * One lost device as it is kept: when (wall clock and seconds since the page started), what was lost, where the
 * game stood, the texture megabytes the lost application held, the JS heap where the browser tells it (Chromium),
 * how many textures had their decoded image freed, whether the page reloaded, and whether a start reported it.
 */
export type LossRecord = {
  /** The wall clock of the loss, in milliseconds since the epoch. */
  at: number;
  uptimeS: number;
  kind: "webgpu" | "webgl";
  reason: string;
  path: string;
  textureMb: number;
  heapMb: number | undefined;
  freed: number;
  reloaded: boolean;
  reported: boolean;
};

/** `performance` where the browser adds `memory` (Chromium). */
type PerformanceWithMemory = Performance & { memory?: { usedJSHeapSize?: unknown } };

/**
 * The JS heap in use, in megabytes, where the browser tells it: `performance.memory` of Chromium. WebKit has none.
 *
 * @returns The megabytes, or `undefined`: the record is kept without it.
 */
export function heapMb(): number | undefined {
  const performanceWithMemory: PerformanceWithMemory | undefined = globalThis.performance;
  const memory = performanceWithMemory?.memory;
  const used = memory?.usedJSHeapSize;

  return typeof used === "number" ? tenth(used / BYTES_PER_MB) : undefined;
}

/**
 * The flow path the game stands on, or `""` before the graph runs.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @returns The path.
 */
export function pathOf(ctx: RendererCtx): string {
  try {
    return ctx.deps.flow.state().path;
  } catch {
    return "";
  }
}

/**
 * Tells whether a parsed value has the fields of a kept record.
 *
 * @param value - A parsed element.
 * @returns True for an object with the fields the log reads.
 */
function isLossRecord(value: unknown): value is LossRecord {
  if (typeof value !== "object" || value === null) return false;

  const record = value as Record<string, unknown>;

  return (
    typeof record.at === "number" &&
    typeof record.kind === "string" &&
    typeof record.reason === "string" &&
    typeof record.path === "string" &&
    typeof record.freed === "number" &&
    typeof record.reloaded === "boolean"
  );
}

/**
 * Reads the kept records. Anything that is not a list, and a storage that throws, reads as none.
 *
 * @returns The records, oldest first.
 */
export function readLosses(): LossRecord[] {
  try {
    const text = globalThis.localStorage?.getItem(LOSS_KEY);
    const parsed: unknown = text === null || text === undefined ? [] : JSON.parse(text);

    return Array.isArray(parsed)
      ? parsed.filter((value): value is LossRecord => isLossRecord(value))
      : [];
  } catch {
    return [];
  }
}

/**
 * Keeps the newest records. A storage that refuses the write (private mode, full) keeps nothing: the log still has
 * the loss.
 *
 * @param records - The records, oldest first.
 */
function writeLosses(records: readonly LossRecord[]): void {
  try {
    globalThis.localStorage?.setItem(LOSS_KEY, JSON.stringify(records.slice(-KEPT)));
  } catch {
    // The log line of the loss stays the record.
  }
}

/**
 * Reloads the page. Headless and in a test there is no page, so nothing happens.
 */
function reloadPage(): void {
  globalThis.location?.reload();
}

/**
 * Records a lost device and decides whether the page leaves: it reloads when textures had their decoded image freed,
 * since they cannot be uploaded to a new device; without any, the renderer restores as before. The `decideLoss`
 * callback of the plugin root.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param info - What was lost and the texture bytes the lost application held.
 * @param freed - How many textures hold the stand-in instead of their decoded image.
 * @param reload - Reloads the page; a test passes a spy.
 * @returns True when the page reloads.
 */
export function leaveAfterLoss(
  ctx: RendererCtx,
  info: LossInfo,
  freed: number,
  reload: () => void = reloadPage
): boolean {
  const reloaded = freed > 0;
  const now = ctx.deps.clock.now();
  const record: LossRecord = {
    at: now,
    uptimeS: uptimeOf(now),
    kind: info.kind,
    reason: info.reason,
    path: pathOf(ctx),
    textureMb: tenth(info.textureBytes / BYTES_PER_MB),
    heapMb: heapMb(),
    freed,
    reloaded,
    reported: false
  };

  ctx.log.error("renderer:gpu-lost", record);
  writeLosses([...readLosses(), record]);

  if (reloaded) reload();

  return reloaded;
}

/**
 * Logs every kept loss no start has reported yet, once: the line a phone shows after the reload a loss caused. Called
 * when the renderer starts.
 *
 * @param ctx - Domain context of the renderer plugin.
 */
export function reportLosses(ctx: RendererCtx): void {
  const records = readLosses();
  const unreported = records.filter(record => record.reported !== true);

  if (unreported.length === 0) return;

  for (const record of unreported) ctx.log.warn("renderer:gpu-lost-before", record);

  writeLosses(records.map(record => ({ ...record, reported: true })));
}
