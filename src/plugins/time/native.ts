/* eslint-disable unicorn/no-null -- the thermal reading and the shell's fields are JSON-shaped: a field the shell left out is `null` (spec 11 T2.4, native's contract v1). */
/**
 * @file time — the one reader of the native shell (`__MOKU_NATIVE__`) in the engine: the frame-rate requests, the one
 * thermal listener, and the shell's readiness. The renderer's performance header reads the shell through
 * `nativeShell()` too; no other file names the global, and the engine declares no global of the native package. Only
 * the talk to the shell lives here: what the adaptive rate makes of an answer or a reading is `rate.ts`'s.
 */
import type { State, ThermalReading, TimeCtx } from "./types";

/**
 * The native shell as the engine reads it: contract v1, with the names of LEAD-FIXES-2 "Native's answer" (O10). The
 * field types are checked against native's built API in the first build step of block 2b.
 */
export type NativeShell = {
  readonly version: 1;
  readonly display: { setFrameRate(fps: number | null): unknown; readonly maxHz: number | null };
  readonly thermal: { read(): unknown } | undefined;
  readonly device: {
    readonly model: unknown;
    readonly manufacturer: unknown;
    readonly sdk: unknown;
  } | null;
  readonly ready: Promise<void> | undefined;
};

/** The window event the shell sends a thermal reading with. */
const THERMAL_EVENT = "moku-native:thermal";

/** What the shell's `ready` resolves to for the engine: nothing. */
const nothing = (): void => {};

/**
 * A number of the shell, or `null` when it sent something else.
 *
 * @param value - What the shell sent.
 * @returns The number, or `null`.
 * @example
 * ```ts
 * numberOr(0.71); // 0.71
 * ```
 */
function numberOr(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * A thermal status of the shell: Android's `THERMAL_STATUS_*` number or its name; `null` otherwise.
 *
 * @param value - What the shell sent.
 * @returns The status, or `null`.
 * @example
 * ```ts
 * statusOr("severe"); // "severe"
 * ```
 */
function statusOr(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

/**
 * Reads one field of an object the shell sent.
 *
 * @param value - The object, or anything else.
 * @param key - The field.
 * @returns The field's value; `undefined` when `value` is no object or lacks it.
 */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/**
 * Normalizes a thermal detail of the shell. Exported: the renderer's header builder reads it too (11-I4).
 *
 * @param detail - The event detail or the answer of `thermal.read()`.
 * @returns The reading; a field the shell left out is `null`.
 * @example
 * ```ts
 * readingOf({ status: 2 }); // { status: 2, headroom: null, at: null, android: null }
 * ```
 */
export function readingOf(detail: unknown): ThermalReading {
  const android = field(detail, "android");

  return {
    status: statusOr(field(detail, "status")),
    headroom: numberOr(field(detail, "headroom")),
    at: numberOr(field(detail, "at")),
    android:
      typeof android === "object" && android !== null
        ? {
            status: statusOr(field(android, "status")),
            headroom: numberOr(field(android, "headroom")),
            forecastSeconds: numberOr(field(android, "forecastSeconds"))
          }
        : null
  };
}

/**
 * Finds the native shell: `__MOKU_NATIVE__` of version 1 with `display.setFrameRate`; `undefined` without one. The
 * answer is a fresh view of the global, read now: `maxHz` and `device` fill in once the shell answered at page start.
 *
 * @returns The shell, or `undefined` on a browser page and on a shell of another version.
 */
export function nativeShell(): NativeShell | undefined {
  const raw: unknown = Reflect.get(globalThis, "__MOKU_NATIVE__");
  const display = field(raw, "display");
  const setFrameRate = field(display, "setFrameRate");

  if (field(raw, "version") !== 1 || typeof setFrameRate !== "function") return undefined;

  const thermal = field(raw, "thermal");
  const read = field(thermal, "read");
  const device = field(raw, "device");
  const ready = field(raw, "ready");

  return {
    version: 1,
    display: {
      setFrameRate: (fps: number | null): unknown => Reflect.apply(setFrameRate, display, [fps]),
      maxHz: numberOr(field(display, "maxHz"))
    },
    thermal:
      typeof read === "function"
        ? { read: (): unknown => Reflect.apply(read, thermal, []) }
        : undefined,
    device:
      typeof device === "object" && device !== null
        ? {
            model: field(device, "model"),
            manufacturer: field(device, "manufacturer"),
            sdk: field(device, "sdk")
          }
        : null,
    ready: ready instanceof Promise ? ready.then(nothing) : undefined
  };
}

/**
 * Settles once the shell answered at page start (`ready`), or after `timeoutMs`, whichever comes first. A shell
 * without `ready`, and a `ready` that rejects, settle at once: the values stay `null`.
 *
 * @param shell - The shell.
 * @param timeoutMs - How long to wait at most.
 * @returns Resolves, never rejects.
 */
export function whenShellReady(shell: NativeShell, timeoutMs: number): Promise<void> {
  const { ready } = shell;

  if (ready === undefined) return Promise.resolve();

  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    const settle = (): void => {
      clearTimeout(timer);
      resolve();
    };

    ready.then(settle, settle);
  });
}

/**
 * Warns once per app that the shell refused a frame rate. The app runs on: the panel keeps its own rate.
 *
 * @param ctx - Domain context of the time plugin.
 * @param error - What the shell threw or rejected with.
 */
function warnRate(ctx: TimeCtx, error: unknown): void {
  if (ctx.state.shell.warned) return;

  ctx.state.shell.warned = true;
  ctx.log.warn("time: the native frame rate failed", { error });
}

/**
 * What the shell answers to `setFrameRate`: the rate the panel was set to and the panel's highest rate.
 */
export type RateAnswer = { panelHz: number | null; maxHz: number | null };

/**
 * A refresh rate the shell sent: a finite number above 0.
 *
 * @param value - What the shell sent.
 * @returns The rate, or `null`.
 * @example
 * ```ts
 * hertzOf(120); // 120
 * ```
 */
export function hertzOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Reads the answer of `setFrameRate` (contract v1: `{ panelHz, maxHz }`).
 *
 * @param answer - What the request resolved to.
 * @returns Both rates; a field the shell left out or sent wrong is `null`.
 * @example
 * ```ts
 * answerOf({ panelHz: 60, maxHz: 120 }); // { panelHz: 60, maxHz: 120 }
 * ```
 */
function answerOf(answer: unknown): RateAnswer {
  return { panelHz: hertzOf(field(answer, "panelHz")), maxHz: hertzOf(field(answer, "maxHz")) };
}

/**
 * Asks the shell found at start for the loop's rate now, so the panel follows it: at start and on every change. A
 * throw and a rejected answer are warned about once; the app runs on.
 *
 * @param ctx - Domain context of the time plugin.
 * @param onAnswer - Gets the answer of this request.
 */
export function followNativeRate(ctx: TimeCtx, onAnswer: (answer: RateAnswer) => void): void {
  const shell = ctx.state.rate.native;

  if (shell === undefined) return;

  try {
    Promise.resolve(shell.display.setFrameRate(ctx.state.rate.fps)).then(
      answer => onAnswer(answerOf(answer)),
      (error: unknown) => warnRate(ctx, error)
    );
  } catch (error) {
    warnRate(ctx, error);
  }
}

/**
 * Hands the frame rate back to the shell at stop (`setFrameRate(null)`). A throw and a rejection are dropped: no log
 * exists at stop.
 *
 * @param shell - The shell found at start.
 */
export function handBackRate(shell: NativeShell): void {
  try {
    const answer = shell.display.setFrameRate(null);

    if (answer instanceof Promise) answer.catch(nothing);
  } catch {
    // The panel keeps whatever rate it has: the app is stopping.
  }
}

/**
 * Reads the `detail` of a window event.
 *
 * @param event - The event.
 * @returns Its detail; `undefined` for a plain event.
 */
function detailOf(event: Event): unknown {
  return "detail" in event ? event.detail : undefined;
}

/**
 * Listens once to the window event `moku-native:thermal` and emits `time:thermal` with the normalized reading, after
 * handing it to `onReading` (the adaptive rate) when there is one. The engine's one listener of that event: the
 * renderer logs it through the hook. It is added on the shell, in an agent build or for the adaptive rate; without a
 * shell, without a window, or with neither, nothing is added.
 *
 * @param ctx - Domain context of the time plugin.
 * @param onReading - The adaptive rate's input; left out without `adaptive`.
 */
export function watchThermal(ctx: TimeCtx, onReading?: (reading: ThermalReading) => void): void {
  const { shell } = ctx.state;

  if (shell.removeThermal !== undefined || ctx.state.rate.native === undefined) return;
  if (typeof globalThis.addEventListener !== "function") return;

  // Inline and positive: Bun folds the agent guard under a production `define`; the adaptive rate keeps it.
  if (
    (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) ||
    onReading !== undefined
  ) {
    const onThermal = (event: Event): void => {
      const reading = readingOf(detailOf(event));

      onReading?.(reading);
      ctx.emit("time:thermal", reading);
    };

    globalThis.addEventListener(THERMAL_EVENT, onThermal);
    shell.removeThermal = (): void => globalThis.removeEventListener(THERMAL_EVENT, onThermal);
  }
}

/**
 * Removes the thermal listener. Works on the state alone, because `onStop` has no context.
 *
 * @param state - State of the time plugin.
 */
export function stopShell(state: State): void {
  const { removeThermal } = state.shell;

  state.shell.removeThermal = undefined;
  removeThermal?.();
}
