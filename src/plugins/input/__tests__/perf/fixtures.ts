/**
 * @file input plugin — the fixtures of the perf tests. Not a test file. Each fixture builds a minimal input context
 * over plain functions, outside any measured window, and hands back one call of the code a tap runs, in a dev build
 * (`__MOKU_GAME_DEV__` true), so the dev log of a lost tap (F122) is measured where it is on.
 */
import { alloc } from "../../../../../tests/perf/alloc";
import type { Answer } from "../../../flow/types";
import { submit, tapAnswer } from "../../answers";
import { Tappable } from "../../components";
import { lostPress } from "../../lost";
import { createInputState } from "../../state";
import type { Config, InputCtx } from "../../types";

/** Calls before a window: the call reaches its optimized tier first, as on a phone after a few seconds. */
const WARM_CALLS = 30_000;

/** Calls of a window, ten times `alloc`'s default. */
const CALLS = 100_000;

/** The pressed view. */
const BUTTON = 7;

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
