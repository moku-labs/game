/**
 * @file renderer plugin — the trail of the run (F175). iOS may end the page's WebContent process in the middle of play
 * (its memory limit) and the game starts again at the splash with nothing that says why. The renderer keeps one small
 * record of the run in `localStorage` under `moku-game:last-run`: where the game stood, the last flow paths, the
 * texture megabytes Pixi holds, the JS heap where the browser tells it, the drawn frames per second and the frames
 * that uploaded textures. It is written every 2 s by a timer, never by a frame, in a page task of its own after a new
 * rest path, at once when the page is hidden or shown and on `pagehide`, and when the renderer stops. A run that ends
 * cleanly leaves the state `"closed"`. The next start reads the record: a run that ended `"visible"` (killed in play)
 * is logged as a warning, one that ended `"hidden"` (reclaimed in the background) as an info line, and each is kept in
 * `moku-game:cut-runs` (the last ten). A plain module of the plugin root, as `loss.ts`.
 */

import { textureUsage } from "./host/readback";
import { BYTES_PER_MB, heapMb, MS_PER_S, pathOf, tenth, uptimeOf } from "./loss";
import { afterTask, pageNow } from "./monitor/clock";
import type { RendererCtx, RendererKind } from "./types";

/** The `localStorage` key of the trail of the run. */
export const TRAIL_KEY = "moku-game:last-run";

/** The `localStorage` key of the runs that ended without `pagehide`. */
export const CUT_KEY = "moku-game:cut-runs";

/** How often the timer writes the trail, ms. */
export const TRAIL_EVERY_MS = 2000;

/** How many cut runs are kept: the newest ones. */
const KEPT = 10;

/** How many flow paths the trail keeps: the newest ones. */
const PATHS = 8;

/** Where the page stood at the last write: shown, in the background, or left cleanly. */
export type TrailPageState = "visible" | "hidden" | "closed";

/** One change of the flow path, with the seconds since the page started. */
export type TrailPath = { path: string; atS: number };

/**
 * The trail of one run as it is kept. A record written by an older build may lack a field: the report logs what it
 * finds.
 */
export type TrailRecord = {
  /** The wall clock of the start, ms since the epoch. */
  startedAt: number;
  /** The wall clock of the last write, ms since the epoch. */
  at: number;
  /** Seconds since the page started, at the last write. */
  uptimeS: number;
  /** Where the page stood at the last write. */
  state: TrailPageState;
  /** The flow path at the last write. */
  path: string;
  /** The last rest paths, oldest first. */
  paths: TrailPath[];
  /** The backend that draws, `"none"` before the application is up. */
  kind: RendererKind;
  /** Megabytes of the textures Pixi manages. */
  textureMb: number;
  /** Megabytes of JS heap in use (Chromium); `undefined` on WebKit. */
  heapMb: number | undefined;
  /** Drawn frames per second since the write before, on the page clock. */
  fps: number;
  /** Drawn frames that uploaded textures since the write before. */
  uploadFrames: number;
  /** How many writes the run made. */
  writes: number;
};

/**
 * The trail's state on the renderer: the two counters the frame adds to, the page clock of the last write, the record
 * and the closures of a started trail.
 */
export type TrailState = {
  /** Drawn frames since the last write; the render callback adds one. */
  frames: number;
  /** Drawn frames that uploaded textures since the last write. */
  uploadFrames: number;
  /** The page clock of the last write, ms. */
  lastPageMs: number;
  /** True while a write waits for its page task. */
  pending: boolean;
  /** The record of the started trail; `undefined` before `startTrail`. */
  record: TrailRecord | undefined;
  /** Notes a rest path and writes the record when it is new; `undefined` while the trail is not started. */
  rest: ((path: string) => void) | undefined;
  /** Stops the trail: the record is written `"closed"`. */
  stop: (() => void) | undefined;
};

/**
 * Makes the trail state of a renderer that has not started.
 *
 * @returns The state, with no record.
 */
export function createTrailState(): TrailState {
  return {
    frames: 0,
    uploadFrames: 0,
    lastPageMs: 0,
    pending: false,
    record: undefined,
    rest: undefined,
    stop: undefined
  };
}

/**
 * Tells whether the page has a `localStorage` to keep the trail in. Reading it may throw (site data off).
 *
 * @returns True when `localStorage.setItem` is there.
 */
function hasStorage(): boolean {
  try {
    return typeof globalThis.localStorage?.setItem === "function";
  } catch {
    return false;
  }
}

/**
 * Tells whether the window can take and drop listeners. A headless test that stubs only `document`, or a worker,
 * cannot. The document's own listeners are not checked here: the host's visibility watch needs them before the trail.
 *
 * @returns True when `addEventListener` and `removeEventListener` are on `globalThis`.
 */
function hasWindowListeners(): boolean {
  return (
    typeof globalThis.addEventListener === "function" &&
    typeof globalThis.removeEventListener === "function"
  );
}

/**
 * Reads a `localStorage` key as JSON. A storage that throws, and text that does not parse, read as `undefined`.
 *
 * @param key - The key.
 * @returns The parsed value, or `undefined`.
 */
function readJson(key: string): unknown {
  try {
    const text = globalThis.localStorage?.getItem(key);

    return text === null || text === undefined ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

/**
 * Writes a value as JSON. A storage that refuses the write (private mode, full) keeps nothing.
 *
 * @param key - The key.
 * @param value - The value.
 */
function writeJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing is kept; the run goes on.
  }
}

/**
 * Tells whether a value is one of the three page states.
 *
 * @param value - A parsed field.
 * @returns True for `"visible"`, `"hidden"` or `"closed"`.
 * @example
 * ```ts
 * isPageState("hidden"); // true
 * ```
 */
function isPageState(value: unknown): value is TrailPageState {
  return value === "visible" || value === "hidden" || value === "closed";
}

/**
 * Tells whether a parsed value has the fields of a kept trail the report reads.
 *
 * @param value - A parsed value.
 * @returns True for an object with a start, a last write, a path and a page state.
 */
function isTrailRecord(value: unknown): value is TrailRecord {
  if (typeof value !== "object" || value === null) return false;

  const record = value as Record<string, unknown>;
  const timed = typeof record.at === "number" && typeof record.startedAt === "number";

  return timed && typeof record.path === "string" && isPageState(record.state);
}

/**
 * The state of a page that is not left: hidden or shown.
 *
 * @param document - The page's document.
 * @returns `"hidden"` or `"visible"`.
 */
function pageStateOf(document: Document): TrailPageState {
  return document.hidden ? "hidden" : "visible";
}

/**
 * Reads the kept cut runs. Anything that is not a list reads as none.
 *
 * @returns The records, oldest first.
 */
export function readCutRuns(): TrailRecord[] {
  const parsed = readJson(CUT_KEY);

  return Array.isArray(parsed)
    ? parsed.filter((value): value is TrailRecord => isTrailRecord(value))
    : [];
}

/**
 * Reports the run before this one when it ended without `pagehide`: killed in play (`"visible"`) is a warning, ended
 * in the background (`"hidden"`) an info line, both `renderer:run-cut-short` with the record, and the record is kept
 * among the cut runs. A run that closed cleanly, and no record, report nothing.
 *
 * @param ctx - Domain context of the renderer plugin.
 */
function reportLastRun(ctx: RendererCtx): void {
  const last = readJson(TRAIL_KEY);

  if (!isTrailRecord(last) || last.state === "closed") return;

  if (last.state === "visible") ctx.log.warn("renderer:run-cut-short", last);
  else ctx.log.info("renderer:run-cut-short", last);

  writeJson(CUT_KEY, [...readCutRuns(), last].slice(-KEPT));
}

/**
 * Fills the record from the renderer and the counters, resets the counters and keeps the record. The frames per second
 * are the drawn frames over the page-clock time since the write before; `at` is the wall clock.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param trail - The trail state, with its record.
 * @param record - The record of the run.
 */
function writeTrail(ctx: RendererCtx, trail: TrailState, record: TrailRecord): void {
  // The two clocks: the wall clock for the moment, the page clock for the span of the counters.
  const now = ctx.deps.clock.now();
  const pageMs = pageNow();
  const spanMs = pageMs - trail.lastPageMs;
  const host = ctx.state.host;

  // Where the game stands and what it holds.
  record.at = now;
  record.uptimeS = uptimeOf(now);
  record.path = pathOf(ctx);
  record.kind = host.kind;
  record.textureMb =
    host.app === undefined ? 0 : tenth(textureUsage(host.app, host).bytes / BYTES_PER_MB);
  record.heapMb = heapMb();
  record.fps = spanMs > 0 ? tenth((trail.frames * MS_PER_S) / spanMs) : 0;
  record.uploadFrames = trail.uploadFrames;
  record.writes += 1;

  // The next window counts from here.
  trail.frames = 0;
  trail.uploadFrames = 0;
  trail.lastPageMs = pageMs;
  writeJson(TRAIL_KEY, record);
}

/**
 * Counts one drawn frame, and one that uploaded textures, for the next write. Called by the render callback of every
 * drawn frame: two small-integer adds, nothing allocated.
 *
 * @param trail - The trail state.
 * @param uploaded - True when the frame uploaded textures.
 */
export function trailFrame(trail: TrailState, uploaded: boolean): void {
  trail.frames += 1;
  trail.uploadFrames += uploaded ? 1 : 0;
}

/**
 * Notes a flow path the game came to rest on; a new one is written in a page task of its own, right after the emit:
 * the moment of a scene change is when memory climbs. A trail that has not started notes nothing.
 *
 * @param trail - The trail state.
 * @param path - Where the flow came to rest.
 */
export function trailRest(trail: TrailState, path: string): void {
  trail.rest?.(path);
}

/**
 * Keeps a new flow path among the last ones, with the seconds since the page started; the same path again is skipped.
 *
 * @param record - The record of the run.
 * @param path - Where the flow came to rest.
 * @param now - The wall clock, ms.
 * @returns True when the path was new.
 */
function notePath(record: TrailRecord, path: string, now: number): boolean {
  if (record.paths.at(-1)?.path === path) return false;

  record.paths.push({ path, atS: uptimeOf(now) });
  if (record.paths.length > PATHS) record.paths.shift();

  return true;
}

/**
 * The record of a run that starts now, over the one just reported.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param document - The page's document.
 * @returns The record, not written yet.
 */
function createRecord(ctx: RendererCtx, document: Document): TrailRecord {
  const now = ctx.deps.clock.now();

  return {
    startedAt: now,
    at: now,
    uptimeS: uptimeOf(now),
    state: pageStateOf(document),
    path: pathOf(ctx),
    paths: [],
    kind: ctx.state.host.kind,
    textureMb: 0,
    heapMb: undefined,
    fps: 0,
    uploadFrames: 0,
    writes: 0
  };
}

/**
 * Starts the trail of a page: reports the run before when it was cut short, starts a new record, writes it, writes it
 * again once the application is up, then every 2 s and at each change of the page (`visibilitychange`, `pagehide`,
 * a `pageshow` from the back/forward cache). Without a document or a mount (an inert renderer), a `localStorage` to
 * keep it in, or listeners on the window (a headless test, a worker), nothing starts.
 *
 * @param ctx - Domain context of the renderer plugin.
 */
export function startTrail(ctx: RendererCtx): void {
  const document = globalThis.document;
  const trail = ctx.state.trail;

  if (document === undefined || ctx.config.mount === undefined || !hasStorage()) return;
  if (!hasWindowListeners()) return;
  if (trail.stop !== undefined) return;

  reportLastRun(ctx);

  const record = createRecord(ctx, document);
  const write = (): void => writeTrail(ctx, trail, record);

  // The page changes state: the record says so at once.
  const onVisibility = (): void => {
    record.state = pageStateOf(document);
    write();
  };
  const onPageHide = (): void => {
    record.state = "closed";
    write();
  };
  const onPageShow = (event: PageTransitionEvent): void => {
    if (!event.persisted) return;

    record.state = pageStateOf(document);
    write();
  };

  // The page's own timer, as `monitor/clock.ts`: no game time, and never a frame.
  const timer = globalThis.setInterval(write, TRAIL_EVERY_MS);

  // Once the application is up: the backend and its textures are in the record from the first seconds.
  ctx.state.host.onReady.push(write);
  document.addEventListener("visibilitychange", onVisibility);
  globalThis.addEventListener("pagehide", onPageHide);
  globalThis.addEventListener("pageshow", onPageShow);

  // The closures the renderer calls: a new rest path is written after the emit, the stop closes the record with
  // nothing but its own state (the other plugins may be stopping).
  trail.lastPageMs = pageNow();
  trail.record = record;
  trail.rest = (path: string): void => {
    if (!notePath(record, path, ctx.deps.clock.now()) || trail.pending) return;

    trail.pending = true;
    afterTask(() => {
      trail.pending = false;
      if (trail.stop !== undefined) write();
    });
  };
  trail.stop = (): void => {
    globalThis.clearInterval(timer);
    // The host may have lost its listeners since the start (a test unstubs its globals first).
    document.removeEventListener("visibilitychange", onVisibility);
    if (hasWindowListeners()) {
      globalThis.removeEventListener("pagehide", onPageHide);
      globalThis.removeEventListener("pageshow", onPageShow);
    }
    record.state = "closed";
    record.writes += 1;
    writeJson(TRAIL_KEY, record);
    trail.rest = undefined;
    trail.stop = undefined;
  };

  write();
}

/**
 * Stops a started trail: the timer and the listeners go, and the record is written `"closed"`. A trail that never
 * started is left as it is.
 *
 * @param trail - The trail state.
 */
export function stopTrail(trail: TrailState): void {
  trail.stop?.();
}
