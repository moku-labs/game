/**
 * @file platform plugin — the fake provider of the unit and integration tests. Not a test file:
 * the projects only collect `*.test.ts`. Six `vi.fn`s; the three `on*` keep the callback they got
 * so a test can play the press, and hand back a remover spy.
 */
import { vi } from "vitest";
import type { HapticKind } from "../types";

/** What a test drives the fake with and reads back from it. */
export type FakeProvider = ReturnType<typeof createFakeProvider>;

/**
 * Creates the fake provider.
 *
 * @returns The provider, the callbacks it was given and the removers it handed out.
 */
export function createFakeProvider() {
  const listeners: {
    pause: (() => void) | undefined;
    resume: (() => void) | undefined;
    back: (() => boolean) | undefined;
  } = { pause: undefined, resume: undefined, back: undefined };
  const removers = { pause: vi.fn(), resume: vi.fn(), back: vi.fn() };
  const provider = {
    onPause: vi.fn((fn: () => void) => {
      listeners.pause = fn;

      return removers.pause;
    }),
    onResume: vi.fn((fn: () => void) => {
      listeners.resume = fn;

      return removers.resume;
    }),
    onBack: vi.fn((fn: () => boolean) => {
      listeners.back = fn;

      return removers.back;
    }),
    haptic: vi.fn((_kind: HapticKind): void => undefined),
    keepAwake: vi.fn((_on: boolean): void => undefined),
    exit: vi.fn((): void => undefined)
  };

  return {
    provider,
    listeners,
    removers,
    /** Plays the system pausing the app. */
    pause: (): void => listeners.pause?.(),
    /** Plays the system resuming the app. */
    resume: (): void => listeners.resume?.(),
    /** Plays one press of the system Back button; what the engine answered the provider. */
    press: (): boolean | undefined => listeners.back?.()
  };
}
