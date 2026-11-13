/**
 * @file input plugin — the fixtures of the perf tests. Not a test file. Each fixture builds a minimal input context
 * over plain functions, outside any measured window, and hands back one call of the code a tap runs, in a dev build
 * (`__MOKU_GAME_DEV__` true), so the dev log of a lost tap (F122) is measured where it is on. The fixtures of
 * the scroll lock (F177) run the hand-off, the catch and the drop of a press over a locked strip.
 */
import { alloc } from "../../../../../tests/perf/alloc";
import type { Answer } from "../../../flow/types";
import { Parent } from "../../../renderer/components";
import { submit, tapAnswer } from "../../answers";
import { Pressed, Scrollable, type ScrollableValue, Tappable } from "../../components";
import { dropLockedPress, handOff } from "../../gestures";
import { movingScrollOf } from "../../hit";
import { lostPress } from "../../lost";
import { createInputState } from "../../state";
import type { Config, InputCtx } from "../../types";

/** Calls before a window: the call reaches its optimized tier first, as on a phone after a few seconds. */
const WARM_CALLS = 30_000;

/** Calls of a window, ten times `alloc`'s default. */
const CALLS = 100_000;

/** The pressed view. */
const BUTTON = 7;

/** The last answer `plainTap` built: kept here, so V8 cannot drop the object the window measures. */
let kept: Answer | undefined;

/**
 * The heap bytes one call keeps: the call run until V8 optimized it, outside the window, then `alloc` over a window
 * of `CALLS`.
 *
 * @param fn - The call.
 * @returns Bytes per call.
 */
export function bytesPerCall(fn: () => void): number {
  for (let call = 0; call < WARM_CALLS; call += 1) fn();

  return alloc(fn, CALLS);
}

/**
 * Throws: a line the fixture should not write, or a gate read a taken answer should not make.
 *
 * @throws {Error} Always.
 */
function fail(): never {
  throw new Error("input perf: a line was logged, or the gate was read");
}

/**
 * A minimal input context: a gate that takes every answer, a world where the button carries `Tappable` when
 * `tappable` says so, a log that throws, so a line the fixture should not write fails the test.
 *
 * @param tappable - Whether the button carries `Tappable`.
 * @returns The context.
 */
function inputCtx(tappable: boolean): InputCtx {
  return {
    config: {} as Config,
    state: createInputState({ config: {} as Config }),
    log: { warn: fail, debug: fail, error: fail, info: fail },
    deps: {
      flow: { gate: { answer: (_answer: Answer): boolean => true, state: fail } },
      world: {
        ecs: {
          has: (_entity: number, component: unknown): boolean => tappable && component === Tappable
        },
        projection: { keyOf: (): undefined => undefined }
      }
    }
  } as unknown as InputCtx;
}

/**
 * The answer half of a good tap: `submit` of a tap answer the gate takes.
 *
 * @returns One call.
 */
export function takenAnswer(): () => void {
  const ctx = inputCtx(true);
  const answer = tapAnswer({ intent: "play", payload: {} });

  return () => {
    submit(ctx, BUTTON, answer);
  };
}

/**
 * The lost-press check of a paused frame with no press: what `pauseGestures` runs every paused frame.
 *
 * @returns One call.
 */
export function idleCheck(): () => void {
  const ctx = inputCtx(true);

  return () => {
    lostPress(ctx, "paused");
  };
}

/**
 * The lost-press check of a press on a view that answers no tap, taken away by a cancel.
 *
 * @returns One call.
 */
export function untappedCheck(): () => void {
  const ctx = inputCtx(false);

  ctx.state.entity = BUTTON;

  return () => {
    lostPress(ctx, "cancelled");
  };
}

/**
 * The tap answer of a view whose `Tappable` does not ask for the press point, built with a point in hand: what
 * `answerRelease` and `app.input.tap` build for every view that never opted in (F139). The answer is kept.
 *
 * @returns One call.
 */
export function plainTap(): () => void {
  const value = Tappable({ intent: "found", payload: { id: "lamp" } }).value;
  const point = { x: 10, y: 60 };

  return () => {
    kept = tapAnswer(value, point);
  };
}

/**
 * The answer `plainTap` built last, so a test sees the window built the answer it means.
 *
 * @returns The answer, or `undefined` before the first call.
 */
export function lastAnswer(): Answer | undefined {
  return kept;
}

/** The locked x strip of the F177 fixtures. */
const STRIP = 3;

/** The y page the strip hangs in, unlocked and still. */
const PAGE = 2;

/** Where the finger went down on the card in the strip. */
const LOCK_START = { x: 60, y: 50 };

/** Where the finger is once it left the tap slop along x. */
const PAST_SLOP = { x: 80, y: 50 };

/** The scroll `downOnMovingLocked` found last: kept here, so V8 cannot drop the walk the window measures. */
let foundScroll: number | undefined;

/**
 * A minimal input context over a card (the button) in the locked x strip, which hangs in the y
 * page (F177): `Scrollable` and `Parent` read from fixed records, `Pressed` kept per entity in a
 * typed array, so the fixture itself keeps nothing. The log throws.
 *
 * @param moving - Whether the strip moves now.
 * @returns The context and the `Pressed` tags, 1 for a pressed entity.
 */
function lockCtx(moving: boolean): { ctx: InputCtx; pressed: Uint8Array } {
  const pressed = new Uint8Array(8);
  const strip: ScrollableValue = { axis: "x", moving, locked: true };
  const page: ScrollableValue = { axis: "y", moving: false };
  const cardParent = { entity: STRIP };
  const stripParent = { entity: PAGE };
  const state = createInputState({ config: {} as Config });

  state.start = LOCK_START;

  const ctx = {
    config: { tapSlopPx: 12 } as Config,
    state,
    log: { warn: fail, debug: fail, error: fail, info: fail },
    deps: {
      world: {
        ecs: {
          has: (entity: number, component: unknown): boolean =>
            component === Pressed && pressed[entity] === 1,
          get: (entity: number, component: unknown): object | undefined => {
            if (component === Scrollable) {
              if (entity === STRIP) return strip;

              return entity === PAGE ? page : undefined;
            }
            if (component !== Parent) return undefined;
            if (entity === BUTTON) return cardParent;

            return entity === STRIP ? stripParent : undefined;
          },
          tag: (entity: number): void => {
            pressed[entity] = 1;
          },
          untag: (entity: number): void => {
            pressed[entity] = 0;
          }
        },
        projection: { keyOf: fail }
      }
    }
  } as unknown as InputCtx;

  return { ctx, pressed };
}

/**
 * A move past the tap slop along x on the card in the locked strip: the hand-off is refused, the
 * card loses `Pressed`, and the press is dropped. The press on the card is set again before every
 * call.
 *
 * @returns One call, and the context it runs on.
 */
export function handOffLocked(): { call: () => void; ctx: InputCtx; pressed: Uint8Array } {
  const { ctx, pressed } = lockCtx(false);

  return {
    ctx,
    pressed,
    call: () => {
      ctx.state.phase = "pressed";
      ctx.state.caught = false;
      ctx.state.entity = BUTTON;
      pressed[BUTTON] = 1;
      handOff(ctx, PAST_SLOP);
    }
  };
}

/**
 * The catch of a down on the card in the moving locked strip: `movingScrollOf` passes over the
 * strip and over the still page, and finds no scroll.
 *
 * @returns One call.
 */
export function downOnMovingLocked(): () => void {
  const { ctx } = lockCtx(true);

  return () => {
    foundScroll = movingScrollOf(ctx, BUTTON);
  };
}

/**
 * The scroll `downOnMovingLocked` found last, so a test sees the window walked past the strip.
 *
 * @returns The scroll, or `undefined` when none moves.
 */
export function lastFoundScroll(): number | undefined {
  return foundScroll;
}

/**
 * The per-step drop of a press held on the locked strip: `Pressed` leaves the strip, the press is
 * caught and belongs to no view. The press on the strip is set again before every call.
 *
 * @returns One call, and the context it runs on.
 */
export function dropLocked(): { call: () => void; ctx: InputCtx; pressed: Uint8Array } {
  const { ctx, pressed } = lockCtx(false);

  return {
    ctx,
    pressed,
    call: () => {
      ctx.state.phase = "pressed";
      ctx.state.caught = false;
      ctx.state.entity = STRIP;
      pressed[STRIP] = 1;
      dropLockedPress(ctx);
    }
  };
}
